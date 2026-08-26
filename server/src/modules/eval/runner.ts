import { randomUUID } from 'node:crypto';
import type { Container } from '../../platform/container.js';
import type {
  AgentEvalBatch,
  EvalBatchRecord,
  EvalCaseResult,
  EvalRunRecord,
  LLMProvider,
  Provider,
} from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { AppError, ConfigError, NotFoundError, NoProviderKeyError } from '../../platform/errors.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
// `constants.ts` is another module's PUBLISHED surface (depcruise
// `no-cross-module-internals` allows constants.ts/types.ts across modules) —
// reusing the review path's own strategy default, not re-deriving it, is what
// keeps this runner's prompt conditions identical to a real review's.
import { REVIEW_STRATEGY } from '../reviews/constants.js';
import { expectedFindings } from './helpers.js';
import { aggregateEvalBatch, scoreEvalCase, type EvalRunOutcome } from './scoring.js';
import { EvalRepository, type EvalCaseRow } from './repository.js';
import type { InsertEvalRun } from './types.js';

/** Everything one successful case run needs to build both the persisted row
 *  and the wire-facing `EvalCaseResult`. */
interface CaseSuccess {
  findings: unknown[];
  rawCount: number;
  groundedCount: number;
  costUsd: number | null;
  score: { pass: boolean; recall: number; precision: number; citation_accuracy: number };
}

/**
 * eval — the batch runner (AC-12, AC-13, AC-14, AC-19..AC-25, NFR
 * Вартість/Local-first/Секрети). Runs every stored case of one agent's set
 * against that agent, through the SAME review engine entry point the real
 * review path and the skills eval harness use
 * (`@devdigest/reviewer-core#reviewPullRequest`) — so the untrusted diff gets
 * the same `INJECTION_GUARD`/`wrapUntrusted` treatment (`reviewer-core/src/
 * prompt.ts`) and findings pass through the SAME citation-grounding gate
 * (`reviewer-core/src/grounding.ts`, re-exported by `platform/grounding.ts`)
 * as a real review. Scoring itself (`scoring.ts`) never touches the network —
 * this file is the only place in the module that calls a model.
 *
 * Takes a `Container`, never a `FastifyRequest` — this is business logic, not
 * a route handler (`server/AGENTS.md` module anatomy).
 */
export class EvalRunner {
  private repo: EvalRepository;

  constructor(private container: Container) {
    // `container.ts` is not touched by this plan (no `eval` slot exists on
    // it), so — like every other file in this module — the repository is
    // constructed locally rather than resolved off the container.
    this.repo = new EvalRepository(container.db);
  }

  /**
   * Run every case in `agentId`'s set (AC-12). One `batch_id` and the agent's
   * CURRENT `agents.version` are captured once, up front, and stamped on
   * every persisted row (AC-22) — later cases in the same batch never see a
   * version bump mid-run because nothing here can change the agent's config.
   *
   * Refuses an empty case set BEFORE resolving the LLM provider (AC-23: zero
   * model calls) and BEFORE the missing-key 409 path — an empty set is its
   * own 422, never conflated with "no key configured" (Open questions).
   */
  async runAgentBatch(workspaceId: string, agentId: string): Promise<AgentEvalBatch> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const cases = await this.repo.listAgentCases(workspaceId, agentId);
    if (cases.length === 0) {
      throw new AppError(
        'empty_eval_set',
        `Agent "${agent.name}" has no eval cases to run.`,
        422,
      );
    }

    // Resolved ONCE for the whole batch — a missing key is a batch-level 409
    // (AC-24), not a per-case failure; per-case failures (AC-25) are caught
    // inside the loop below and never include this one. Shared with
    // `runSingleCase` via `prepareCaseContext` — see that method's doc
    // comment for why the two paths must never diverge here.
    const { llm, skillBodies } = await this.prepareCaseContext(agentId, agent.provider as Provider);

    const batchId = randomUUID();
    const agentVersion = agent.version;
    const batchStart = Date.now();

    const insertRows: InsertEvalRun[] = [];
    // Everything `EvalCaseResult` needs except `run_id`, which only exists
    // once `insertRunBatch` has returned the persisted rows.
    const pending: Omit<EvalCaseResult, 'run_id'>[] = [];
    let costSum = 0;
    let costKnown = false;

    // Sequential on purpose — mirrors `skills/service.ts#runSkillEvals`
    // ("Sequential on purpose: these are paid model calls, and running a
    // whole suite in parallel is the fastest way to trip a provider rate
    // limit").
    for (const row of cases) {
      const caseStart = Date.now();
      try {
        const result = await this.runOneCase(agent, llm, skillBodies, row);
        const durationMs = Date.now() - caseStart;
        if (result.costUsd !== null) {
          costKnown = true;
          costSum += result.costUsd;
        }
        insertRows.push({
          caseId: row.id,
          batchId,
          agentVersion,
          actualOutput: {
            findings: result.findings,
            raw_count: result.rawCount,
            grounded_count: result.groundedCount,
          },
          pass: result.score.pass,
          recall: result.score.recall,
          precision: result.score.precision,
          citationAccuracy: result.score.citation_accuracy,
          durationMs,
          costUsd: result.costUsd,
        });
        pending.push({
          case_id: row.id,
          case_name: row.name,
          pass: result.score.pass,
          recall: result.score.recall,
          precision: result.score.precision,
          citation_accuracy: result.score.citation_accuracy,
          raw_count: result.rawCount,
          grounded_count: result.groundedCount,
          error: null,
        });
      } catch (err) {
        const durationMs = Date.now() - caseStart;
        // AC-25: never surface `input_diff` content in the stored/returned
        // reason — every branch below builds its message from the case NAME
        // and/or the underlying error's own message, never from `row.inputDiff`.
        const { code, message } = this.describeCaseFailure(err, row.name);
        insertRows.push({
          caseId: row.id,
          batchId,
          agentVersion,
          actualOutput: { error: { code, message } },
          pass: null,
          recall: null,
          precision: null,
          citationAccuracy: null,
          durationMs,
          costUsd: null,
          errorReason: message,
        });
        pending.push({
          case_id: row.id,
          case_name: row.name,
          pass: null,
          // `EvalCaseResult.recall`/`.precision` are non-nullable by contract
          // (only `pass`/`citation_accuracy`/`grounded_count`/`error` carry
          // the "this case errored" signal) — 0 is a placeholder, never read
          // because the aggregates below exclude every errored row.
          recall: 0,
          precision: 0,
          citation_accuracy: null,
          raw_count: 0,
          grounded_count: null,
          error: { code, message },
        });
      }
    }

    // Persist the whole batch BEFORE returning (the user may navigate away —
    // history must already be in the DB, not held in a response the client
    // might never receive).
    const insertedRows = await this.repo.insertRunBatch(insertRows);
    const results: EvalCaseResult[] = pending.map((p, i) => ({
      ...p,
      run_id: insertedRows[i]!.id,
    }));

    const record = this.aggregate(
      results,
      { batchId, agentId, agentName: agent.name, agentVersion },
      Date.now() - batchStart,
      costKnown ? costSum : null,
    );

    return { ...record, cases: results };
  }

  /**
   * Run exactly ONE case against its owning agent (AC-63, AC-69, AC-71) —
   * one model call, persisted OUTSIDE any batch (`batchId: null`, so it can
   * never join a batch aggregate) but through the SAME preamble
   * (`prepareCaseContext`) and the SAME `runOneCase` the batch loop uses, so
   * this result is comparable to a batch run of the same case (see
   * `prepareCaseContext`'s doc comment).
   *
   * 404 when the agent or the case doesn't exist, or the case is not
   * agent-owned or is owned by a DIFFERENT agent — all three read as "not
   * found" from this route's point of view, the same shape
   * `EvalService#requireAgentCase` already uses for the shared CRUD routes.
   * 409 `no_provider_key` is raised (inside `prepareCaseContext`) before any
   * DB write. A run that fails (provider error, timeout, empty
   * `input_diff`) is still persisted — `pass: null`, `error` set, exactly
   * the same failure shape `describeCaseFailure` gives the batch loop, never
   * the raw diff text (NFR Секрети) — and still returned as a 200
   * `EvalRunRecord` (NFR Спостережуваність): only "not found" and "no
   * provider key" are non-2xx here.
   */
  async runSingleCase(workspaceId: string, agentId: string, caseId: string): Promise<EvalRunRecord> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const row = await this.requireAgentCase(workspaceId, agentId, caseId);

    // 409 before any DB write — same rule as the batch path, just for one case.
    const { llm, skillBodies } = await this.prepareCaseContext(agentId, agent.provider as Provider);

    const agentVersion = agent.version;
    const runStart = Date.now();

    let insertRow: InsertEvalRun;
    let error: { code: string; message: string } | null = null;
    try {
      const result = await this.runOneCase(agent, llm, skillBodies, row);
      insertRow = {
        caseId: row.id,
        batchId: null,
        agentVersion,
        actualOutput: {
          findings: result.findings,
          raw_count: result.rawCount,
          grounded_count: result.groundedCount,
        },
        pass: result.score.pass,
        recall: result.score.recall,
        precision: result.score.precision,
        citationAccuracy: result.score.citation_accuracy,
        durationMs: Date.now() - runStart,
        costUsd: result.costUsd,
      };
    } catch (err) {
      // Same mapping the batch loop uses (AC-25/NFR Секрети): built from the
      // case NAME and/or the underlying error's own message, never from
      // `row.inputDiff`.
      const described = this.describeCaseFailure(err, row.name);
      error = described;
      insertRow = {
        caseId: row.id,
        batchId: null,
        agentVersion,
        actualOutput: { error: described },
        pass: null,
        recall: null,
        precision: null,
        citationAccuracy: null,
        durationMs: Date.now() - runStart,
        costUsd: null,
        errorReason: described.message,
      };
    }

    const persisted = await this.repo.insertRun(insertRow);

    return {
      id: persisted.id,
      case_id: persisted.caseId,
      case_name: row.name,
      batch_id: persisted.batchId,
      agent_version: persisted.agentVersion,
      ran_at: persisted.ranAt.toISOString(),
      actual_output: persisted.actualOutput,
      error,
      pass: persisted.pass,
      recall: persisted.recall,
      precision: persisted.precision,
      citation_accuracy: persisted.citationAccuracy,
      duration_ms: persisted.durationMs,
      cost_usd: persisted.costUsd,
    };
  }

  /** One case: parse its stored diff, run it through the shared review
   *  engine, and score the grounded survivors. Throws on any failure — the
   *  caller (the loop above) is the one place that catches per-case. */
  private async runOneCase(
    agent: { name: string; model: string; systemPrompt: string; strategy: string | null },
    llm: LLMProvider,
    skillBodies: string[],
    row: EvalCaseRow,
  ): Promise<CaseSuccess> {
    const diffText = row.inputDiff ?? '';
    if (diffText.trim().length === 0) {
      throw new AppError('eval_case_empty', `Eval case "${row.name}" has no input diff.`, 422);
    }
    // AC-13 — the ONLY input is what the case row itself stores: no GitHub,
    // no disk clone, nothing else read off `agent`/`container` besides the
    // prompt materials already resolved by the caller.
    const diff = parseUnifiedDiff(diffText);

    const outcome = await reviewPullRequest({
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      diff,
      llm,
      strategy: (agent.strategy as 'auto' | 'single-pass' | 'map-reduce' | null) ?? REVIEW_STRATEGY,
      ...(skillBodies.length > 0 ? { skills: skillBodies } : {}),
      task: `Evaluate the agent "${agent.name}" against eval case "${row.name}".`,
      sessionId: `eval:${agent.name}:${row.name}`,
    });

    // `reviewPullRequest` already ran the shared citation-grounding gate
    // (AC-14): `outcome.review.findings` are the GROUNDED survivors,
    // `outcome.dropped` is what the gate removed. `raw_count` is the sum —
    // findings the model emitted BEFORE the gate ran.
    const groundedCount = outcome.review.findings.length;
    const rawCount = groundedCount + outcome.dropped.length;
    const expected = expectedFindings(row.expectedOutput);
    const score = scoreEvalCase(expected, outcome.review.findings, rawCount);

    return {
      score,
      findings: outcome.review.findings,
      rawCount,
      groundedCount,
      costUsd: outcome.costUsd ?? null,
    };
  }

  /** Resolve the LLM exactly the way the review run executor and the skills
   *  eval harness do — through the container, so a missing key becomes the
   *  same 409 the UI already keys its disabled Run buttons off
   *  (`skills/service.ts:417-419`). */
  private async resolveLlm(provider: Provider): Promise<LLMProvider> {
    try {
      return await this.container.llm(provider);
    } catch (err) {
      if (err instanceof ConfigError) throw new NoProviderKeyError(provider, 'run evals');
      throw err;
    }
  }

  /**
   * The per-case preamble BOTH `runAgentBatch` and `runSingleCase` build
   * before calling `runOneCase`: resolve the LLM (409 `no_provider_key` on a
   * missing key, via `resolveLlm`) and collect the ENABLED linked-skill
   * bodies, with the SAME kill-switch rule the real review path applies
   * (`run-executor.ts`) — a linked skill disabled since it was linked does
   * not enter the prompt. Extracted into one method so a single-case run and
   * a batch run of the SAME case assemble an IDENTICAL prompt: a second,
   * subtly different assembly here would make a single-case result
   * incomparable with the batch's result for the same case, which would
   * quietly defeat the reason single-case running exists (AC-63).
   */
  private async prepareCaseContext(
    agentId: string,
    provider: Provider,
  ): Promise<{ llm: LLMProvider; skillBodies: string[] }> {
    const llm = await this.resolveLlm(provider);
    const linkedSkills = (await this.container.agentsRepo.linkedSkills(agentId)).filter(
      (l) => l.skill.enabled,
    );
    return { llm, skillBodies: linkedSkills.map((l) => l.skill.body) };
  }

  /** Scoped fetch that also enforces the module boundary — mirrors
   *  `EvalService#requireAgentCase`'s shape (this runner has its own
   *  `EvalRepository` instance, so the check is repeated here rather than
   *  reached across the service/runner boundary): a case that does not
   *  exist, is not agent-owned, or is owned by a DIFFERENT agent is "not
   *  found" from this route's point of view — never a 400/403. */
  private async requireAgentCase(
    workspaceId: string,
    agentId: string,
    caseId: string,
  ): Promise<EvalCaseRow> {
    const row = await this.repo.getCase(workspaceId, caseId);
    if (!row || row.ownerKind !== 'agent' || row.ownerId !== agentId) {
      throw new NotFoundError('Eval case not found');
    }
    return row;
  }

  /** Map a per-case failure to a `{ code, message }` pair — never built from
   *  `row.inputDiff` (AC-25's "never log the untrusted diff" rule). */
  private describeCaseFailure(err: unknown, caseName: string): { code: string; message: string } {
    if (err instanceof AppError) return { code: err.code, message: err.message };
    if (err instanceof Error) return { code: 'eval_case_failed', message: err.message };
    return { code: 'eval_case_failed', message: `Eval case "${caseName}" failed with an unknown error.` };
  }

  /** Aggregate over NON-ERRORED rows only (AC-25), via the shared aggregator
   *  (`scoring.ts#aggregateEvalBatch` — fix pass, item 4) so this runner and
   *  the dashboard's read side can never independently drift on the mean/
   *  null rules again. `costUsd` is computed by the caller (it needs the
   *  per-case cost, which `EvalCaseResult` does not carry on the wire) and
   *  passed straight through. */
  private aggregate(
    results: EvalCaseResult[],
    ids: { batchId: string; agentId: string; agentName: string; agentVersion: number },
    durationMs: number,
    costUsd: number | null,
  ): EvalBatchRecord {
    const outcomes: EvalRunOutcome[] = results.map((r) => ({
      pass: r.pass,
      recall: r.recall,
      precision: r.precision,
      citationAccuracy: r.citation_accuracy,
    }));
    const agg = aggregateEvalBatch(outcomes);

    return {
      batch_id: ids.batchId,
      agent_id: ids.agentId,
      agent_name: ids.agentName,
      agent_version: ids.agentVersion,
      ran_at: new Date().toISOString(),
      recall: agg.recall,
      precision: agg.precision,
      citation_accuracy: agg.citationAccuracy,
      traces_passed: agg.tracesPassed,
      traces_total: agg.tracesTotal,
      cases_errored: agg.casesErrored,
      duration_ms: durationMs,
      cost_usd: costUsd,
    };
  }
}
