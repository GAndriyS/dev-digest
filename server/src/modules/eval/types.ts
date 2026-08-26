import type * as t from '../../db/schema.js';
import type { EvalOwnerKind } from '@devdigest/shared';

/**
 * eval — shared row/DTO shapes for `repository.ts` and the modules that read
 * it (`service.ts`, `runner.ts`, `dashboard.ts` — steps 7-9, not this step).
 * Mirrors the `repo-intel/types.ts` precedent: one file the whole module
 * codes against, so later files don't re-derive these shapes.
 *
 * This module owns the AGENT side of `eval_cases`/`eval_runs` only — the
 * skill side is `modules/skills/repository.ts` (`listEvalCases` etc., already
 * shipped). `EvalOwnerKind` stays a field on the DTOs below (it is what the
 * wire contract `EvalCaseInput` carries), but every read/lookup method here
 * hardcodes `'agent'` — see `repository.ts` (AC-28: the filter lives in the
 * repository, not the UI).
 */

export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;

export interface InsertEvalCase {
  workspaceId: string;
  ownerKind: EvalOwnerKind;
  ownerId: string;
  name: string;
  inputDiff: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
  /** Provenance pointer (no FK — see `db/schema/eval.ts`); `null`/absent for
   *  hand-authored cases. */
  sourceFindingId?: string | null;
}

export interface UpdateEvalCase {
  name?: string;
  inputDiff?: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

/** One `eval_runs` row to persist, written a batch at a time (AC-22, AC-25). */
export interface InsertEvalRun {
  caseId: string;
  batchId: string;
  agentVersion: number;
  actualOutput: unknown;
  /** `null` = this case's run errored (AC-25) — `recall`/`precision`/
   *  `citationAccuracy` must be `null` on the same row. */
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number | null;
  costUsd: number | null;
  /** Set iff `pass` is `null`; duplicates `actualOutput.error` so the reason
   *  is queryable without unpacking jsonb. */
  errorReason?: string | null;
}

/** One persisted run, with its case's name joined in — the per-case row
 *  `dashboard.ts` (step 9) shapes into `EvalRunRecord`/`EvalCaseResult`. */
export interface EvalBatchRunRow {
  id: string;
  caseId: string;
  caseName: string;
  batchId: string;
  agentVersion: number | null;
  ranAt: Date;
  actualOutput: unknown;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number | null;
  costUsd: number | null;
  errorReason: string | null;
}

/**
 * One agent-set batch run (AC-12, AC-22), grouped but NOT aggregated — no
 * averaging, no `pass = null` exclusion. Those are metric-aggregation rules
 * (AC-16..AC-20, AC-25) that belong to `dashboard.ts`'s business logic, not
 * to this repository's SQL. `runs` is every case row of the batch, newest
 * first within the group; `ranAt` is the batch's most recent run (its start
 * is not separately recorded — all rows of one batch land within the same
 * runner invocation).
 */
export interface EvalBatchRuns {
  batchId: string;
  /** The agent's id — `eval_cases.owner_id` for every case in this batch. */
  ownerId: string;
  agentVersion: number | null;
  ranAt: Date;
  runs: EvalBatchRunRow[];
}
