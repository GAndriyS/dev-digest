import { readdir, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ContextListing, ContextPaths, SpecFile } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { isInsideRoot, readInsideClone } from '../_shared/clone-fs.js';
import { ContextRepository } from './repository.js';
import { MAX_CONTEXT_BLOCK_CHARS, MAX_CONTEXT_DOC_BYTES, MAX_CONTEXT_FILES, REPO_NOT_CLONED_CODE, SKIP_DIR_NAMES } from './constants.js';
import { badgeFor, dedupeKeepFirst, estimateTokens, nameBadgeFor, packDocs } from './helpers.js';
import type { ProjectContext, ResolvedContextDocs, SkippedContextDoc } from './types.js';

/**
 * L05 — Project Context service.
 *
 * The walk (`walkContextFiles`) and the single-document guarded read
 * (`classifyAndRead`) are the only I/O in this module; both are exported
 * top-level functions (not private class methods) so they can be unit-tested
 * against a real temp directory without a Postgres container — matching the
 * plan's "chisti helpers … symlink-guard — unit, without a container" line.
 */

/** 409 — mirrors `conventions`' `RepoNotClonedError`. */
export class RepoNotClonedError extends AppError {
  constructor() {
    super(
      REPO_NOT_CLONED_CODE,
      'This repository has not finished cloning yet — wait for the clone to complete, then reload.',
      409,
    );
  }
}

export interface WalkedContextFile {
  /** Repo-relative POSIX path (matches `ContextDocPath`'s wire shape). */
  relPath: string;
  /**
   * The file's badge — either the configured ROOT name it was found under
   * (SPEC-01), or the lowercased stem of the configured file NAME it matched
   * (SPEC-02 AC-1/AC-2). Root wins when both apply (AC-3) — see `badgeFor`.
   */
  root: string;
  size: number;
  mtimeMs: number;
}

export interface ContextWalkResult {
  files: WalkedContextFile[];
  /** Every matching file found, even past `limit` — never content, just the count. */
  total: number;
  truncated: boolean;
}

/**
 * Recursively find every file matching EITHER of two independent rules,
 * skipping `SKIP_DIR_NAMES` and every symlink:
 *
 * 1. Root rule (SPEC-01): a `.md` file under any of `roots` (a directory
 *    NAME, not a path — matched anywhere in the tree, e.g. both `specs/` and
 *    `packages/x/docs/`).
 * 2. Name rule (SPEC-02 AC-1): a file whose NAME matches one of `fileNames`
 *    case-insensitively, on ANY depth — including the clone root itself —
 *    regardless of whether it is under a configured root.
 *
 * A file matching both is collected exactly once, badged by the root
 * (SPEC-02 AC-3) — `badgeFor` (`helpers.ts`) is the pure restatement of both
 * rules together and MUST stay in lockstep with this function; see its doc
 * comment.
 *
 * Never follows or lists a symlink (file or directory) — that is the walk's
 * OWN escape guard (AC-2/AC-3): a committed `specs/escape -> /etc` symlink
 * would otherwise let the listing (and later, an attachment) point outside
 * the clone. Skipping the entry outright removes the need to `realpath` every
 * candidate during the walk; `classifyAndRead` below still re-checks with
 * `isInsideRoot` on the READ path, which is the one that actually opens a file.
 *
 * One `stat` per MATCHED file, never file content (NFR Performance): this is
 * the perf-relevant half of the walk. The name rule adds no new filesystem
 * call of its own — it only widens which already-`readdir`'d entries qualify.
 */
export async function walkContextFiles(
  clonePath: string,
  roots: readonly string[],
  fileNames: readonly string[],
  limit: number,
): Promise<ContextWalkResult> {
  const rootSet = new Set(roots);
  const nameBadgeByLowerName = new Map<string, string>();
  for (const name of fileNames) nameBadgeByLowerName.set(name.toLowerCase(), nameBadgeFor(name));
  const files: WalkedContextFile[] = [];
  let total = 0;

  async function walk(absDir: string, relDir: string, activeRoot: string | null): Promise<void> {
    const entries = await readdir(absDir, { withFileTypes: true }).catch(() => null);
    if (entries === null) return; // unreadable dir (permissions, race) — degrade, don't throw

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        const nextRoot = activeRoot ?? (rootSet.has(entry.name) ? entry.name : null);
        await walk(join(absDir, entry.name), rel, nextRoot);
        continue;
      }

      if (!entry.isFile()) continue;

      const matchesRoot = activeRoot !== null && entry.name.toLowerCase().endsWith('.md');
      const nameBadge = nameBadgeByLowerName.get(entry.name.toLowerCase()) ?? null;
      if (!matchesRoot && nameBadge === null) continue;
      const badge = activeRoot ?? nameBadge!; // root wins when both match (AC-3)

      total += 1;
      if (files.length >= limit) continue; // keep counting `total`; stop collecting metadata

      const info = await stat(join(absDir, entry.name)).catch(() => null);
      if (info === null) {
        total -= 1; // vanished between readdir and stat — was never really "found"
        continue;
      }
      files.push({ relPath: rel, root: badge, size: info.size, mtimeMs: info.mtimeMs });
    }
  }

  await walk(clonePath, '', null);
  return { files, total, truncated: total > files.length };
}

type ClassifiedRead = { content: string } | { reason: string };

/**
 * Guarded single-document read, re-derived from `readInsideClone` +
 * `isInsideRoot` (unchanged, `modules/_shared/clone-fs.ts`) with a human
 * reason attached for the Live Log / preview 404 — the shared guard collapses
 * every failure to `null`, which is right for "can I open this file" but not
 * for "why didn't this doc make it into the run".
 *
 * `roots`/`fileNames` add a bound the shared guard never had: being inside
 * the clone and ending in `.md` is not enough — the wire contract
 * (`ContextDocPath`) already enforces both of those and a path can still
 * satisfy them from OUTSIDE every configured root AND every configured name
 * (`node_modules/pkg/README.md` is genuinely inside the clone and genuinely
 * `.md`). Without this check that path is readable via
 * `GET /repos/:id/context/doc?path=` even though the listing never offered
 * it, and the same stored path is silently attach-able to an agent/skill.
 * Checked first (`badgeFor` is pure — no I/O) so a path outside every root
 * and every name never reaches the filesystem at all.
 */
export async function classifyAndRead(
  root: string,
  relPath: string,
  maxBytes: number,
  roots: readonly string[],
  fileNames: readonly string[],
): Promise<ClassifiedRead> {
  if (badgeFor(relPath, roots, fileNames) === null) {
    return { reason: 'outside the configured context roots and file names' };
  }
  const real = await realpath(resolve(root, relPath)).catch(() => null);
  if (real === null) return { reason: 'not found in the clone' };
  if (!isInsideRoot(root, real)) return { reason: 'escapes the clone root (symlink)' };

  const info = await stat(real).catch(() => null);
  if (info === null || !info.isFile()) return { reason: 'not found in the clone' };
  if (info.size > maxBytes) return { reason: `over the ${maxBytes}-byte document limit` };

  const content = await readInsideClone(root, relPath, maxBytes);
  if (content === null) return { reason: 'unreadable' };
  return { content };
}

export class ContextService implements ProjectContext {
  private repo: ContextRepository;

  constructor(private container: Container) {
    this.repo = new ContextRepository(container.db);
  }

  async listContext(workspaceId: string, repoId: string): Promise<ContextListing> {
    const root = await this.realpathClone(workspaceId, repoId);
    const roots = this.container.config.contextRoots;
    const fileNames = this.container.config.contextFiles;

    const walked = await walkContextFiles(root, roots, fileNames, MAX_CONTEXT_FILES);
    const counts = await this.repo.usedByAgentCounts(
      workspaceId,
      walked.files.map((f) => f.relPath),
    );

    const files: SpecFile[] = walked.files
      .map((f) => ({
        path: f.relPath,
        content: null,
        size: f.size,
        updated_at: new Date(f.mtimeMs).toISOString(),
        root: f.root,
        tokens_est: estimateTokens(f.size),
        used_by_agents: counts.get(f.relPath) ?? 0,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));

    return {
      files,
      total: walked.total,
      truncated: walked.truncated,
      roots: [...roots],
      file_names: [...fileNames],
      scanned_at: new Date().toISOString(),
    };
  }

  async readDoc(workspaceId: string, repoId: string, path: string): Promise<SpecFile> {
    const root = await this.realpathClone(workspaceId, repoId);

    const read = await classifyAndRead(
      root,
      path,
      MAX_CONTEXT_DOC_BYTES,
      this.container.config.contextRoots,
      this.container.config.contextFiles,
    );
    if ('reason' in read) throw new NotFoundError(`Document not found (${read.reason})`);

    const bytes = Buffer.byteLength(read.content, 'utf8');
    // Best-effort mtime for the preview header. A race (file removed between
    // the read above and this stat) still returns the content already read —
    // AC-4's "document deleted after attachment" edge case, degraded gracefully
    // rather than turned into a 404 for a read that just succeeded.
    const real = await realpath(resolve(root, path)).catch(() => null);
    const info = real ? await stat(real).catch(() => null) : null;

    return {
      path,
      content: read.content,
      size: bytes,
      updated_at: info ? new Date(info.mtimeMs).toISOString() : null,
      root: badgeFor(path, this.container.config.contextRoots, this.container.config.contextFiles),
      tokens_est: estimateTokens(bytes),
      used_by_agents: null, // listing-only field — see SpecFile's contract comment
    };
  }

  async agentDocs(workspaceId: string, agentId: string): Promise<ContextPaths | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    return { paths: await this.repo.agentDocPaths(agentId) };
  }

  async setAgentDocs(
    workspaceId: string,
    agentId: string,
    paths: string[],
  ): Promise<ContextPaths | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.repo.setAgentDocPaths(agentId, paths);
    return { paths: await this.repo.agentDocPaths(agentId) };
  }

  async skillDocs(workspaceId: string, skillId: string): Promise<ContextPaths | undefined> {
    const skill = await this.container.skillsRepo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    return { paths: await this.repo.skillDocPaths(skillId) };
  }

  async setSkillDocs(
    workspaceId: string,
    skillId: string,
    paths: string[],
  ): Promise<ContextPaths | undefined> {
    const skill = await this.container.skillsRepo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    await this.repo.setSkillDocPaths(skillId, paths);
    return { paths: await this.repo.skillDocPaths(skillId) };
  }

  /**
   * Run path. Own docs first, then every enabled linked skill's docs in
   * `enabledSkillIds` order (already filtered to enabled by the caller —
   * `run-executor.ts` mirrors the "enabled is the kill switch" rule it
   * already applies to `## Skills / rules`). Never throws: a run must not
   * fail because Project Context has nothing to attach, or the clone is gone.
   *
   * Every filesystem failure was already degraded into a `skipped` entry
   * (clone missing, over-limit, outside a configured root, …) — but until
   * fix pass 2, item 5, the TWO repository reads above (`agentDocPaths`,
   * `skillDocPaths`) were unguarded: a transient DB error there failed the
   * whole review run, a failure mode this branch introduced for a run that
   * attaches no documents at all. Degraded here the same way
   * `run-executor.ts` already degrades `skillsRepo.recordRunSkills(...)`
   * three lines above this facade's call site — `.catch()`, a Live Log line,
   * fall back to "nothing to attach" rather than let it propagate.
   */
  async resolveForRun(
    clonePath: string | null,
    agentId: string,
    enabledSkillIds: string[],
  ): Promise<ResolvedContextDocs> {
    const lookupFailures: SkippedContextDoc[] = [];

    const ownPaths = await this.repo.agentDocPaths(agentId).catch((err: unknown) => {
      lookupFailures.push({
        path: '(agent context)',
        reason: `could not load the agent's attached paths — ${(err as Error).message}`,
      });
      return [];
    });
    const skillPathLists = await Promise.all(
      enabledSkillIds.map((skillId) =>
        this.repo.skillDocPaths(skillId).catch((err: unknown) => {
          lookupFailures.push({
            path: `(skill ${skillId} context)`,
            reason: `could not load the skill's attached paths — ${(err as Error).message}`,
          });
          return [];
        }),
      ),
    );
    const merged = dedupeKeepFirst([...ownPaths, ...skillPathLists.flat()]);
    if (merged.length === 0) return { specs: [], specsRead: [], skipped: lookupFailures };

    if (!clonePath) {
      return { specs: [], specsRead: [], skipped: [...lookupFailures, ...skipAll(merged, 'repository not cloned')] };
    }
    const root = await realpath(clonePath).catch(() => null);
    if (root === null) {
      return { specs: [], specsRead: [], skipped: [...lookupFailures, ...skipAll(merged, 'clone path unreadable')] };
    }

    const readOk: { path: string; content: string }[] = [];
    const skippedIO: SkippedContextDoc[] = [];
    for (const path of merged) {
      const result = await classifyAndRead(
        root,
        path,
        MAX_CONTEXT_DOC_BYTES,
        this.container.config.contextRoots,
        this.container.config.contextFiles,
      );
      if ('reason' in result) skippedIO.push({ path, reason: result.reason });
      else readOk.push({ path, content: result.content });
    }

    const packed = packDocs(readOk, MAX_CONTEXT_BLOCK_CHARS);
    return {
      specs: packed.specs,
      specsRead: packed.specsRead,
      skipped: [...lookupFailures, ...skippedIO, ...packed.skipped],
    };
  }

  /** Resolve + validate the repo's clone root once — shared by listContext/readDoc. */
  private async realpathClone(workspaceId: string, repoId: string): Promise<string> {
    const repo = await this.repo.repoBasics(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');
    if (!repo.clonePath) throw new RepoNotClonedError();
    const root = await realpath(repo.clonePath).catch(() => null);
    if (root === null) throw new RepoNotClonedError();
    return root;
  }
}

function skipAll(paths: string[], reason: string): SkippedContextDoc[] {
  return paths.map((path) => ({ path, reason }));
}
