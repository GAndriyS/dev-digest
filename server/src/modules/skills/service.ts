import type { Container } from '../../platform/container.js';
import type {
  EvalCase,
  EvalRun,
  LLMProvider,
  Provider,
  Skill,
  SkillImportPreview,
  SkillSource,
  SkillStats,
  SkillType,
  SkillUsage,
  SkillVersion,
} from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { AppError, ConfigError, NotFoundError, NoProviderKeyError } from '../../platform/errors.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import type { EvalCaseRow, SkillRow, SkillsRepository } from './repository.js';
import {
  EVAL_FALLBACK_MODEL,
  EVAL_FALLBACK_PROVIDER,
  EVAL_HARNESS_PROMPT,
  EVAL_STRATEGY,
  STATS_WINDOW_DAYS,
} from './constants.js';
import {
  citationAccuracy,
  compareEval,
  currentVersionEntry,
  expectedFindings,
  toActualFinding,
  toEvalCaseDto,
  toSkillDto,
  toSkillVersionDto,
} from './helpers.js';
import { buildSkillImportPreview, decodeImportPayload } from './import.js';

/**
 * A1 — skills service. Business logic for the Skills Lab: CRUD, the immutable
 * body history, "who uses this skill", the dashboard numbers, and the eval
 * harness that scores a skill against a stored diff with a REAL model call.
 */

export { NoProviderKeyError } from '../../platform/errors.js';

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled: boolean;
  evidence_files?: string[] | null;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  source?: SkillSource;
  body?: string;
  enabled?: boolean;
  evidence_files?: string[] | null;
}

export interface EvalCaseInput {
  name: string;
  input_diff: string;
  input_files?: unknown;
  input_meta?: unknown;
  expected_output?: unknown;
  notes?: string | null;
}

export type EvalCasePatch = Partial<EvalCaseInput>;

export class SkillsService {
  private repo: SkillsRepository;

  constructor(private container: Container) {
    // Resolved from the composition root (not `new`ed here) because the run
    // executor writes `run_skills` through the same repository.
    this.repo = container.skillsRepo;
  }

  // ---- CRUD ---------------------------------------------------------------

  async list(
    workspaceId: string,
    filter: { type?: SkillType; enabled?: boolean } = {},
  ): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId, filter);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill> {
    return toSkillDto(await this.require(workspaceId, id));
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source: input.source,
      body: input.body,
      enabled: input.enabled,
      evidenceFiles: input.evidence_files ?? null,
    });
    return toSkillDto(row);
  }

  async update(workspaceId: string, id: string, patch: UpdateSkillInput): Promise<Skill> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.source !== undefined ? { source: patch.source } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.evidence_files !== undefined ? { evidenceFiles: patch.evidence_files } : {}),
    });
    if (!row) throw new NotFoundError('Skill not found');
    return toSkillDto(row);
  }

  async delete(workspaceId: string, id: string): Promise<string> {
    const ok = await this.repo.deleteById(workspaceId, id);
    if (!ok) throw new NotFoundError('Skill not found');
    return id;
  }

  // ---- import (L02) -------------------------------------------------------

  /**
   * Preview the skill inside an uploaded `.md` or `.zip`. READ-ONLY by design:
   * nothing is written to the database, nothing is unpacked to disk, and no part
   * of an archive other than one markdown entry is ever decompressed.
   *
   * There is no `importConfirm` counterpart on purpose. Confirmation is the
   * ordinary `POST /skills` with the (possibly user-edited) preview fields and
   * `source: 'imported_url'`. Persisting a "pending import" would mean a second
   * lifecycle to expire, and abandoning a preview would leave a row behind.
   *
   * No `workspaceId`: there is nothing to scope. Every rule lives in `import.ts`
   * as a pure function, so the parser is tested without a container.
   */
  async importPreview(input: {
    filename: string;
    content_base64: string;
  }): Promise<SkillImportPreview> {
    return buildSkillImportPreview(input.filename, decodeImportPayload(input.content_base64));
  }

  // ---- version history ----------------------------------------------------

  /**
   * Body history, newest first. A never-edited skill has no stored row, so the
   * current version is synthesized (see `currentVersionEntry`) — the list is
   * never empty for a skill that exists. Bodies are omitted; only `body_chars`.
   */
  async listVersions(workspaceId: string, id: string): Promise<SkillVersion[]> {
    const skill = await this.require(workspaceId, id);
    const rows = await this.repo.listVersions(id);
    const dtos = rows.map((r) => toSkillVersionDto(r, false));
    return rows.some((r) => r.version === skill.version)
      ? dtos
      : [currentVersionEntry(skill, false), ...dtos];
  }

  /** One snapshot, WITH its body (this is the endpoint a diff view reads). */
  async getVersion(workspaceId: string, id: string, version: number): Promise<SkillVersion> {
    const skill = await this.require(workspaceId, id);
    const row = await this.repo.getVersion(id, version);
    if (row) return toSkillVersionDto(row, true);
    if (version === skill.version) return currentVersionEntry(skill, true);
    throw new NotFoundError('Skill version not found');
  }

  /**
   * Restore an old body — as a NEW version, never a rewind. Restoring v1 onto a
   * skill at v4 produces v5 with v1's text; v1..v4 stay exactly as they were.
   */
  async restoreVersion(workspaceId: string, id: string, version: number): Promise<Skill> {
    const skill = await this.require(workspaceId, id);
    const row = await this.repo.getVersion(id, version);
    const body = row?.body ?? (version === skill.version ? skill.body : undefined);
    if (body === undefined) throw new NotFoundError('Skill version not found');
    const restored = await this.repo.restore(workspaceId, id, body);
    if (!restored) throw new NotFoundError('Skill not found');
    return toSkillDto(restored);
  }

  // ---- usage + dashboard --------------------------------------------------

  async usedBy(workspaceId: string, id: string): Promise<SkillUsage[]> {
    await this.require(workspaceId, id);
    const rows = await this.repo.usedBy(workspaceId, id);
    return rows.map((r) => ({
      agent_id: r.agentId,
      agent_name: r.agentName,
      order: r.order,
      agent_enabled: r.agentEnabled,
    }));
  }

  /**
   * Dashboard numbers. Attribution is RUN-level: these count runs that INCLUDED
   * this skill and the findings those runs produced, because the engine renders
   * every linked skill into one prompt section and no honest per-finding mapping
   * exists (see the repository's stats section).
   *
   * `findings_by_category` and `accept_rate` are ALL-TIME over that set;
   * `pull_count_30d` / `findings_30d` restrict it to the last
   * `STATS_WINDOW_DAYS`. `accept_rate` is null — not 0 — when nothing has been
   * triaged, so "no signal" cannot be mistaken for "everything was dismissed".
   */
  async stats(workspaceId: string, id: string): Promise<SkillStats> {
    await this.require(workspaceId, id);
    const since = new Date(Date.now() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [usage, runs, findings] = await Promise.all([
      this.usedBy(workspaceId, id),
      this.repo.runCounts(id, since),
      this.repo.findingStats(id, since),
    ]);
    const triaged = findings.accepted + findings.dismissed;
    return {
      used_by: usage,
      pull_count_30d: runs.recent,
      runs_total: runs.total,
      findings_30d: findings.recent,
      accept_rate: triaged === 0 ? null : findings.accepted / triaged,
      findings_by_category: findings.byCategory,
    };
  }

  // ---- eval cases ---------------------------------------------------------

  async listEvalCases(workspaceId: string, skillId: string): Promise<EvalCase[]> {
    await this.require(workspaceId, skillId);
    const rows = await this.repo.listEvalCases(workspaceId, 'skill', skillId);
    return rows.map(toEvalCaseDto);
  }

  async createEvalCase(
    workspaceId: string,
    skillId: string,
    input: EvalCaseInput,
  ): Promise<EvalCase> {
    await this.require(workspaceId, skillId);
    const row = await this.repo.insertEvalCase({
      workspaceId,
      ownerKind: 'skill',
      ownerId: skillId,
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files,
      inputMeta: input.input_meta,
      expectedOutput: input.expected_output,
      notes: input.notes ?? null,
    });
    return toEvalCaseDto(row);
  }

  async updateEvalCase(
    workspaceId: string,
    id: string,
    patch: EvalCasePatch,
  ): Promise<EvalCase> {
    const row = await this.repo.updateEvalCase(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.input_diff !== undefined ? { inputDiff: patch.input_diff } : {}),
      ...(patch.input_files !== undefined ? { inputFiles: patch.input_files } : {}),
      ...(patch.input_meta !== undefined ? { inputMeta: patch.input_meta } : {}),
      ...(patch.expected_output !== undefined ? { expectedOutput: patch.expected_output } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    });
    if (!row) throw new NotFoundError('Eval case not found');
    return toEvalCaseDto(row);
  }

  async deleteEvalCase(workspaceId: string, id: string): Promise<string> {
    const ok = await this.repo.deleteEvalCase(workspaceId, id);
    if (!ok) throw new NotFoundError('Eval case not found');
    return id;
  }

  // ---- eval execution (real model call) -----------------------------------

  /** Run one stored case against its owning skill. */
  async runEvalCase(workspaceId: string, caseId: string): Promise<EvalRun> {
    const row = await this.repo.getEvalCase(workspaceId, caseId);
    if (!row) throw new NotFoundError('Eval case not found');
    if (row.ownerKind !== 'skill') {
      throw new AppError(
        'unsupported_eval_owner',
        'Only skill-owned eval cases can be run from the Skills Lab.',
        400,
      );
    }
    const skill = await this.require(workspaceId, row.ownerId);
    return this.executeCase(workspaceId, skill, row);
  }

  /** Run every case owned by a skill, in name order. */
  async runSkillEvals(workspaceId: string, skillId: string): Promise<EvalRun[]> {
    const skill = await this.require(workspaceId, skillId);
    const cases = await this.repo.listEvalCases(workspaceId, 'skill', skillId);
    const results: EvalRun[] = [];
    // Sequential on purpose: these are paid model calls, and running a whole
    // suite in parallel is the fastest way to trip a provider rate limit.
    for (const row of cases) results.push(await this.executeCase(workspaceId, skill, row));
    return results;
  }

  /**
   * The harness. Assembles a prompt whose ONLY review policy is the skill body,
   * runs it through the same engine a real review uses (so grounding, reduction
   * and scoring behave identically), compares against the expectation, and
   * persists an `eval_runs` row.
   */
  private async executeCase(
    workspaceId: string,
    skill: SkillRow,
    row: EvalCaseRow,
  ): Promise<EvalRun> {
    const diffText = row.inputDiff ?? '';
    if (diffText.trim().length === 0) {
      throw new AppError('eval_case_empty', `Eval case "${row.name}" has no input diff.`, 422);
    }
    const { provider, model } = await this.resolveEvalTarget(workspaceId, skill.id);
    const llm = await this.resolveLlm(provider);
    const diff = parseUnifiedDiff(diffText);

    const start = Date.now();
    const outcome = await reviewPullRequest({
      systemPrompt: EVAL_HARNESS_PROMPT,
      model,
      diff,
      llm,
      strategy: EVAL_STRATEGY,
      // The skill under test, as a resolved BODY — reviewer-core never sees ids.
      skills: [skill.body],
      task: `Evaluate the skill "${skill.name}" against the diff below.`,
      sessionId: `eval:${skill.name}:${row.name}`,
    });
    const durationMs = Date.now() - start;

    // `reviewPullRequest` already applies the shared `groundFindings` gate, so
    // `outcome.review.findings` are the GROUNDED survivors and `outcome.dropped`
    // are the hallucinated citations. Re-grounding here would be a no-op; what
    // the eval adds is turning the drop rate into a reported number.
    const actual = outcome.review.findings.map(toActualFinding);
    const expected = expectedFindings(row.expectedOutput);
    const comparison = compareEval(expected, actual);
    const citation = citationAccuracy(actual.length, outcome.dropped.length);

    await this.repo.insertEvalRun({
      caseId: row.id,
      pass: comparison.pass,
      actualOutput: { findings: actual },
      recall: comparison.recall,
      precision: comparison.precision,
      citationAccuracy: citation,
      durationMs,
      costUsd: outcome.costUsd ?? null,
    });

    return {
      recall: comparison.recall,
      precision: comparison.precision,
      citation_accuracy: citation,
      traces_passed: comparison.pass ? 1 : 0,
      traces_total: 1,
      duration_ms: durationMs,
      cost_usd: outcome.costUsd ?? null,
      per_trace: [
        {
          name: row.name,
          pass: comparison.pass,
          expected: { findings: expected },
          actual: { findings: actual },
        },
      ],
    };
  }

  /**
   * Which provider/model an eval runs on.
   *
   * Borrowed from an agent that actually uses the skill, so the eval scores it
   * under the conditions it will really ship in; any other enabled agent is the
   * next best proxy, and the seed defaults are the last resort for a skill in a
   * workspace with no agents at all. `container.agentsRepo` is the sanctioned
   * cross-module path — reaching into `modules/agents/repository.ts` is not.
   */
  private async resolveEvalTarget(
    workspaceId: string,
    skillId: string,
  ): Promise<{ provider: Provider; model: string }> {
    const [enabled, linked] = await Promise.all([
      this.container.agentsRepo.listEnabled(workspaceId),
      this.repo.usedBy(workspaceId, skillId),
    ]);
    const linkedIds = new Set(linked.map((l) => l.agentId));
    const agent = enabled.find((a) => linkedIds.has(a.id)) ?? enabled[0];
    return agent
      ? { provider: agent.provider as Provider, model: agent.model }
      : { provider: EVAL_FALLBACK_PROVIDER, model: EVAL_FALLBACK_MODEL };
  }

  /**
   * Resolve the LLM exactly the way the review run executor does — through the
   * container, so the key is read via SecretsProvider at resolve time and tests
   * can inject a mock. The container throws `ConfigError` when the key is
   * missing; that becomes the 409 the UI keys its disabled Run buttons off.
   */
  private async resolveLlm(provider: Provider): Promise<LLMProvider> {
    try {
      return await this.container.llm(provider);
    } catch (err) {
      if (err instanceof ConfigError) throw new NoProviderKeyError(provider, 'run evals');
      throw err;
    }
  }

  private async require(workspaceId: string, id: string): Promise<SkillRow> {
    const row = await this.repo.getById(workspaceId, id);
    if (!row) throw new NotFoundError('Skill not found');
    return row;
  }
}
