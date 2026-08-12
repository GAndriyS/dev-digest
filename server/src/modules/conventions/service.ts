import { realpath } from 'node:fs/promises';
import type {
  ConventionCandidate,
  ConventionExtractResult,
  ConventionStatus,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, ConfigError, NotFoundError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/index.js';
import { readInsideClone } from '../_shared/clone-fs.js';
import { ConventionsRepository, type InsertConvention } from './repository.js';
import {
  CONFIG_FILES,
  EXTRACTION_SCHEMA_NAME,
  EXTRACTION_SYSTEM_PROMPT,
  MAX_CANDIDATES,
  MAX_FILE_BYTES,
  NO_PROVIDER_KEY_CODE,
  NO_SAMPLES_CODE,
  REPO_NOT_CLONED_CODE,
  SAMPLE_COUNT,
} from './constants.js';
import {
  ConventionExtraction,
  buildExtractionMessages,
  normalizeCategory,
  toConventionDto,
  verifyCandidates,
  type SampleFile,
} from './helpers.js';

/**
 * L03 — conventions extractor service.
 *
 * The pipeline is deliberately lopsided: sampling and verification are ordinary
 * code, and the model is used for the one step code cannot do — noticing that a
 * pattern repeats. Everything it claims is then checked against the file it
 * named. A convention whose evidence cannot be found is never stored, so the
 * list the user triages contains no invented rules.
 */

/** 409, not 500 — "no key configured yet" is a UI state, not a server fault. */
export class NoProviderKeyError extends AppError {
  constructor(provider: string) {
    super(
      NO_PROVIDER_KEY_CODE,
      `No API key configured for provider "${provider}" — add one in Settings to extract conventions.`,
      409,
      { provider },
    );
  }
}

export class RepoNotClonedError extends AppError {
  constructor() {
    super(
      REPO_NOT_CLONED_CODE,
      'This repository has not finished cloning yet — wait for the clone to complete, then scan.',
      409,
    );
  }
}

export class NoSamplesError extends AppError {
  constructor() {
    super(
      NO_SAMPLES_CODE,
      'Could not read any files to sample. Index the repository, then scan again.',
      409,
    );
  }
}

export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const repo = await this.repo.repoBasics(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return rows.map(toConventionDto);
  }

  async patch(
    workspaceId: string,
    id: string,
    patch: { rule?: string; status?: ConventionStatus },
  ): Promise<ConventionCandidate> {
    const existing = await this.repo.getById(workspaceId, id);
    if (!existing) throw new NotFoundError('Convention not found');
    // An empty patch is a no-op, not an error: `update` with no SET is invalid SQL.
    if (patch.rule === undefined && patch.status === undefined) return toConventionDto(existing);
    const row = await this.repo.update(workspaceId, id, patch);
    if (!row) throw new NotFoundError('Convention not found');
    return toConventionDto(row);
  }

  /**
   * Scan the repo and replace its pending candidates.
   *
   * Synchronous — one model call over a bounded sample takes seconds, and a job
   * would buy polling, a status column and a stuck-run story for no benefit the
   * user can feel.
   */
  async extract(workspaceId: string, repoId: string): Promise<ConventionExtractResult> {
    const repo = await this.repo.repoBasics(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');
    if (!repo.clonePath) throw new RepoNotClonedError();

    const files = await this.sample(repoId, repo.clonePath);
    if (files.length === 0) throw new NoSamplesError();

    const { provider, model } = await resolveFeatureModel(
      this.container,
      workspaceId,
      'conventions',
    );
    const llm = await this.container.llm(provider).catch((e) => {
      // Translate the container's "key missing" into the 409 the UI renders.
      if (e instanceof ConfigError) throw new NoProviderKeyError(provider);
      throw e;
    });

    const result = await llm.completeStructured({
      model,
      schema: ConventionExtraction,
      schemaName: EXTRACTION_SCHEMA_NAME,
      messages: buildExtractionMessages(files, EXTRACTION_SYSTEM_PROMPT),
      temperature: 0,
      maxRetries: 2,
    });

    const existing = await this.repo.existingRules(workspaceId, repoId);
    // The prompt asks for at most MAX_CANDIDATES, but a prompt is a request and
    // the sampled files are attacker-influenced (any public repo can be
    // imported). Enforce the bound in code before any of it reaches the DB.
    const proposed = result.data.conventions.slice(0, MAX_CANDIDATES);
    const { kept, droppedNoEvidence } = verifyCandidates(proposed, files, existing);

    const inserts: InsertConvention[] = kept.map((c) => ({
      workspaceId,
      repoId,
      category: normalizeCategory(c.category),
      rule: c.rule,
      evidencePath: c.evidence_path,
      evidenceSnippet: c.evidence_snippet,
      evidenceLine: c.evidence_line,
      confidence: c.confidence,
    }));
    // One transaction: a failed insert after a committed delete would leave the
    // user with an emptied triage list and no way back except another paid
    // model call. It also serializes a double-clicked Re-scan.
    await this.repo.replacePending(workspaceId, repoId, inserts);

    // Return the whole list, not just the new rows: the client renders one list
    // and previously accepted rules are still part of it.
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return {
      candidates: rows.map(toConventionDto),
      sampled_files: files.map((f) => f.path),
      // Only the evidence failures. Duplicates are counted separately and are
      // not evidence of fabrication — see `verifyCandidates`.
      dropped_no_evidence: droppedNoEvidence,
    };
  }

  /**
   * Pick and read the sample — entirely in code, no model involved.
   *
   * Two sources: the config files that state rules outright, and the top-ranked
   * source files from repo-intel (which already drops tests, configs and
   * migrations). repo-intel degrades to `[]` on an unindexed repo rather than
   * throwing, so a repo that is cloned but not yet indexed still yields its
   * configs instead of an error.
   */
  private async sample(repoId: string, clonePath: string): Promise<SampleFile[]> {
    const ranked = await this.container.repoIntel.getConventionSamples(repoId, SAMPLE_COUNT);
    const paths = [...CONFIG_FILES, ...ranked];

    // Resolve the clone root once, through symlinks, so every candidate path can
    // be compared against its real location rather than its spelling.
    const root = await realpath(clonePath).catch(() => null);
    if (root === null) return [];

    // The containment check inside `readInsideClone` is not paranoia about
    // `..`: git tree entries cannot contain it and `CONFIG_FILES` is a static
    // list, so the reachable attack is a SYMLINK. Any public repo can be
    // imported, and a repo committing `tsconfig.json -> ~/.devdigest/secrets.json`
    // would otherwise have this read the secrets file, ship it to a
    // third-party model, and — since anything the model quotes back does
    // locate in "the file" — store it as evidence and render it in the UI.
    // `realpath` collapses the link first, so the escape is visible before
    // the file is opened. See `modules/_shared/clone-fs.ts`.
    const read = await Promise.all(
      paths.map(async (path) => {
        const content = await readInsideClone(root, path, MAX_FILE_BYTES);
        return content === null ? null : { path, content };
      }),
    );
    return read.filter((f): f is SampleFile => f !== null && f.content.trim().length > 0);
  }
}
