import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { BATCH_TABLE_LIMIT } from './constants.js';
import type {
  EvalBatchRunRow,
  EvalBatchRuns,
  EvalCaseRow,
  EvalRunRow,
  InsertEvalCase,
  InsertEvalRun,
  UpdateEvalCase,
} from './types.js';

export type { EvalCaseRow, EvalRunRow } from './types.js';

/**
 * eval — data-access for the agent side of `eval_cases`/`eval_runs` (SPEC-05).
 * The skill side stays on `modules/skills/repository.ts` (already shipped);
 * this repository is the ONLY layer that reads/writes `eval_cases`/`eval_runs`
 * for `owner_kind = 'agent'`, and every selection method hardcodes that filter
 * (AC-28 — the Eval Dashboard's owner-kind boundary lives here, not in the UI
 * or in a query param a caller could omit).
 *
 * No cross-module reads: `agents`, `findings` and `pr_files` are read through
 * `container.agentsRepo` / `container.reviewRepo` by the callers of this
 * repository (service.ts / runner.ts / dashboard.ts), never joined in here —
 * an inline join on another module's table would compile and pass depcruise
 * but is still the boundary violation `onion-architecture` calls out
 * (Blind spots §4).
 */

/**
 * Thrown by `insertCase` when the partial unique index
 * `eval_cases_owner_source_finding_uq` rejects a concurrent duplicate
 * (two "Turn into eval case" clicks racing on the same finding, AC-6).
 * Translating the Postgres wire error into a domain error HERE keeps the
 * driver's `code`/`constraint_name` shape out of the service layer —
 * repositories own SQL, including SQL failure shapes (architecture review,
 * loop 2).
 */
export class DuplicateEvalCaseError extends Error {
  constructor() {
    super('eval case already exists for this finding');
    this.name = 'DuplicateEvalCaseError';
  }
}

/**
 * True iff `err` is a Postgres unique-violation (`23505`) on `constraintName`.
 * The `postgres` driver (this project's, unlike `pg`) attaches `code`/
 * `constraint_name` directly on the thrown `PostgresError` — but checked
 * defensively under `.cause` too, in case a future wrapper (a transaction
 * helper, a retry layer) re-throws with the original attached there instead.
 */
function isUniqueConstraintViolation(err: unknown, constraintName: string): boolean {
  if (!err || typeof err !== 'object') return false;
  const direct = err as { code?: unknown; constraint_name?: unknown; cause?: unknown };
  const cause =
    direct.cause && typeof direct.cause === 'object'
      ? (direct.cause as { code?: unknown; constraint_name?: unknown })
      : undefined;
  const code = direct.code ?? cause?.code;
  const constraint = direct.constraint_name ?? cause?.constraint_name;
  return code === '23505' && constraint === constraintName;
}

export class EvalRepository {
  constructor(private db: Db) {}

  // ---- eval_cases CRUD (workspace-scoped) ----------------------------------

  async listAgentCases(workspaceId: string, agentId: string): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
        ),
      )
      .orderBy(asc(t.evalCases.name));
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  /**
   * AC-6 idempotency lookup: has this agent already turned this finding into
   * a case? Mirrors the partial unique index `eval_cases_owner_source_finding_uq`
   * on `(owner_id, source_finding_id) WHERE source_finding_id IS NOT NULL`
   * (`db/schema/eval.ts`) — `ownerKind` is pinned to `'agent'` here because
   * that index has no `owner_kind` column of its own to disambiguate against
   * a hypothetical skill-owned row with the same `owner_id`.
   */
  async findCaseBySourceFinding(
    workspaceId: string,
    agentId: string,
    sourceFindingId: string,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
          eq(t.evalCases.sourceFindingId, sourceFindingId),
        ),
      );
    return row;
  }

  async insertCase(values: InsertEvalCase): Promise<EvalCaseRow> {
    try {
      const [row] = await this.db
        .insert(t.evalCases)
        .values({
          workspaceId: values.workspaceId,
          ownerKind: values.ownerKind,
          ownerId: values.ownerId,
          name: values.name,
          inputDiff: values.inputDiff,
          inputFiles: values.inputFiles ?? null,
          inputMeta: values.inputMeta ?? null,
          expectedOutput: values.expectedOutput ?? null,
          notes: values.notes ?? null,
          sourceFindingId: values.sourceFindingId ?? null,
        })
        .returning();
      return row!;
    } catch (err) {
      if (isUniqueConstraintViolation(err, 'eval_cases_owner_source_finding_uq')) {
        throw new DuplicateEvalCaseError();
      }
      throw err;
    }
  }

  async updateCase(
    workspaceId: string,
    id: string,
    patch: UpdateEvalCase,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.inputFiles !== undefined ? { inputFiles: patch.inputFiles } : {}),
        ...(patch.inputMeta !== undefined ? { inputMeta: patch.inputMeta } : {}),
        ...(patch.expectedOutput !== undefined ? { expectedOutput: patch.expectedOutput } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row;
  }

  /** Deletes the case's `eval_runs` history too — `eval_runs.case_id` cascades
   *  on delete (`db/schema/eval.ts`), so AC-11 needs no extra query here. */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ---- eval_runs ------------------------------------------------------------

  /** Persists every case result of one batch run in a single statement
   *  (AC-12, AC-22) — one `batch_id`/`agent_version` pair shared by all rows
   *  is the caller's (runner.ts's) responsibility, not this method's. */
  async insertRunBatch(rows: InsertEvalRun[]): Promise<EvalRunRow[]> {
    if (rows.length === 0) return [];
    return this.db
      .insert(t.evalRuns)
      .values(
        rows.map((r) => ({
          caseId: r.caseId,
          batchId: r.batchId,
          agentVersion: r.agentVersion,
          actualOutput: r.actualOutput,
          pass: r.pass,
          recall: r.recall,
          precision: r.precision,
          citationAccuracy: r.citationAccuracy,
          durationMs: r.durationMs,
          costUsd: r.costUsd,
          errorReason: r.errorReason ?? null,
        })),
      )
      .returning();
  }

  /**
   * Batches for one agent, newest first, capped to `limit` DISTINCT batches
   * (not rows) — a batch of 20 cases must still count as one row against
   * `BATCH_TABLE_LIMIT`, so a plain `ORDER BY ran_at DESC LIMIT N` on
   * `eval_runs` would undercount. AC-28's `owner_kind = 'agent'` filter is
   * folded into the join, not left to the caller.
   */
  async listBatchesForAgent(
    workspaceId: string,
    agentId: string,
    limit = BATCH_TABLE_LIMIT,
  ): Promise<EvalBatchRuns[]> {
    return this.recentBatches(workspaceId, agentId, limit);
  }

  /** Same shape, across every agent — the `GET /eval/overview` read (AC-27).
   *  Skill-owned cases never surface here (AC-28): the join always filters
   *  `owner_kind = 'agent'`, with or without an `agentId`. */
  async listBatchesForAllAgents(
    workspaceId: string,
    limit = BATCH_TABLE_LIMIT,
  ): Promise<EvalBatchRuns[]> {
    return this.recentBatches(workspaceId, undefined, limit);
  }

  /**
   * Two queries, not N+1: first the `limit` most recent distinct `batch_id`s
   * (grouped, ordered by each batch's latest `ran_at`), then every run row for
   * exactly those batches. Bounded to 2 round-trips regardless of how many
   * batches or cases-per-batch exist (NFR Продуктивність — no N+1).
   */
  private async recentBatches(
    workspaceId: string,
    agentId: string | undefined,
    limit: number,
  ): Promise<EvalBatchRuns[]> {
    const scope = [
      eq(t.evalCases.workspaceId, workspaceId),
      eq(t.evalCases.ownerKind, 'agent' as const),
      isNotNull(t.evalRuns.batchId),
      ...(agentId !== undefined ? [eq(t.evalCases.ownerId, agentId)] : []),
    ];

    const batchIdRows = await this.db
      .select({ batchId: t.evalRuns.batchId, latestRanAt: sql<Date>`max(${t.evalRuns.ranAt})` })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalCases.id, t.evalRuns.caseId))
      .where(and(...scope))
      .groupBy(t.evalRuns.batchId)
      .orderBy(desc(sql`max(${t.evalRuns.ranAt})`))
      .limit(limit);

    const batchIds = batchIdRows.map((r) => r.batchId).filter((id): id is string => id !== null);
    // batchIds is already newest-first (from the grouped query above) —
    // `runRowsGroupedByBatch` preserves this order rather than re-deriving
    // it from the ungrouped row order.
    return this.runRowsGroupedByBatch(workspaceId, batchIds);
  }

  /**
   * The single LATEST batch per agent (AC-9's `EvalAgentSummary.last_batch`),
   * NOT derived from the global top-`BATCH_TABLE_LIMIT` window `recentBatches`
   * reads — an agent whose latest run has since scrolled out of that window
   * must still report it (fix pass, item 3: `getEvalOverview` used to derive
   * `last_batch` from the same capped `recentBatches` read `recent_batches`
   * uses, which silently drops an agent's last run once enough OTHER agents'
   * batches push it past the cap).
   *
   * Two queries, no per-agent loop: first every `(owner_id, batch_id)` pair's
   * own `max(ran_at)` — bounded by the total number of BATCHES ever run
   * (never runs/cases, local-first scale), reduced in memory to the one
   * winning `batch_id` per agent; then the same shared row-fetch-and-group
   * step `recentBatches` uses, for exactly those winning batches.
   */
  async latestBatchPerAgent(workspaceId: string): Promise<EvalBatchRuns[]> {
    const perBatch = await this.db
      .select({
        ownerId: t.evalCases.ownerId,
        batchId: t.evalRuns.batchId,
        batchRanAt: sql<Date>`max(${t.evalRuns.ranAt})`,
      })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalCases.id, t.evalRuns.caseId))
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent' as const),
          isNotNull(t.evalRuns.batchId),
        ),
      )
      .groupBy(t.evalCases.ownerId, t.evalRuns.batchId);

    const latestByAgent = new Map<string, { batchId: string; ranAt: Date }>();
    for (const row of perBatch) {
      if (row.batchId === null) continue;
      // Defensive `new Date(...)`: `sql<Date>` is a type HINT to drizzle, not
      // a runtime guarantee the driver returns an actual `Date` instance for
      // an aggregate expression the way it does for a plain column select —
      // `new Date(aDate)` is a no-op, `new Date(anIsoString)` is not.
      const ranAt = new Date(row.batchRanAt);
      const current = latestByAgent.get(row.ownerId);
      if (!current || ranAt > current.ranAt) {
        latestByAgent.set(row.ownerId, { batchId: row.batchId, ranAt });
      }
    }

    const batchIds = [...latestByAgent.values()].map((v) => v.batchId);
    return this.runRowsGroupedByBatch(workspaceId, batchIds);
  }

  /**
   * Shared second half of both batch reads above: fetch every run row for
   * exactly the given `batchIds` (one query) and group them into one
   * `EvalBatchRuns` per batch, in the caller-supplied order. Extracted (fix
   * pass, item 3) so `recentBatches` (top-N, global) and `latestBatchPerAgent`
   * (one per agent, unbounded) can never duplicate — and drift on — the
   * grouping rule.
   */
  private async runRowsGroupedByBatch(
    workspaceId: string,
    batchIds: readonly string[],
  ): Promise<EvalBatchRuns[]> {
    if (batchIds.length === 0) return [];

    const rows = await this.db
      .select({
        id: t.evalRuns.id,
        caseId: t.evalRuns.caseId,
        caseName: t.evalCases.name,
        batchId: t.evalRuns.batchId,
        ownerId: t.evalCases.ownerId,
        agentVersion: t.evalRuns.agentVersion,
        ranAt: t.evalRuns.ranAt,
        actualOutput: t.evalRuns.actualOutput,
        pass: t.evalRuns.pass,
        recall: t.evalRuns.recall,
        precision: t.evalRuns.precision,
        citationAccuracy: t.evalRuns.citationAccuracy,
        durationMs: t.evalRuns.durationMs,
        costUsd: t.evalRuns.costUsd,
        errorReason: t.evalRuns.errorReason,
      })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalCases.id, t.evalRuns.caseId))
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          inArray(t.evalRuns.batchId, batchIds as string[]),
        ),
      )
      .orderBy(desc(t.evalRuns.ranAt));

    // Group in JS from the one join (same pattern as
    // `skills/repository.ts#findingStats`) — this is a local-first studio,
    // row counts per batch are small, and one query keeps every group
    // derived from the same read.
    const groups = new Map<string, EvalBatchRuns>();
    for (const row of rows) {
      const batchId = row.batchId!; // filtered to inArray(batchIds), never null here
      let group = groups.get(batchId);
      if (!group) {
        group = { batchId, ownerId: row.ownerId, agentVersion: row.agentVersion, ranAt: row.ranAt, runs: [] };
        groups.set(batchId, group);
      }
      if (row.ranAt > group.ranAt) group.ranAt = row.ranAt;
      const run: EvalBatchRunRow = {
        id: row.id,
        caseId: row.caseId,
        caseName: row.caseName,
        batchId,
        agentVersion: row.agentVersion,
        ranAt: row.ranAt,
        actualOutput: row.actualOutput,
        pass: row.pass,
        recall: row.recall,
        precision: row.precision,
        citationAccuracy: row.citationAccuracy,
        durationMs: row.durationMs,
        costUsd: row.costUsd,
        errorReason: row.errorReason,
      };
      group.runs.push(run);
    }

    return batchIds.map((id) => groups.get(id)).filter((g): g is EvalBatchRuns => g !== undefined);
  }
}
