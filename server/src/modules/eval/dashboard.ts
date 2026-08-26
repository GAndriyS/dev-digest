import type { Container } from '../../platform/container.js';
import type {
  EvalAgentSummary,
  EvalAlert,
  EvalBatchRecord,
  EvalDashboard,
  EvalDashboardOverview,
  EvalRunRecord,
  EvalTrendPoint,
} from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { EvalRepository } from './repository.js';
import type { EvalBatchRunRow, EvalBatchRuns } from './types.js';
import { BATCH_TABLE_LIMIT, REGRESSION_THRESHOLD_PP } from './constants.js';
import { aggregateEvalBatch, round2 } from './scoring.js';

/**
 * eval — dashboard read models (SPEC-05, step 9). Two entry points, both take
 * a `Container` (never a `FastifyRequest`, not even as a type — `server/
 * AGENTS.md:20-22`): the workspace-wide overview (`GET /eval/overview`) and
 * one agent's dashboard (`GET /eval/dashboard?owner_id=…`). Pure read side —
 * no writes, no LLM calls.
 *
 * `EvalRepository` returns raw joined rows (`EvalBatchRuns`), never
 * aggregated: recall/precision/citation_accuracy averaging, the `pass = null`
 * exclusion rule, and the regression alert are business logic that belongs
 * here, not in SQL (mirrors `skills/repository.ts#findingStats`, which does
 * the same "group in JS from one join" for the skill side).
 *
 * Agent identity (name/model) is read exclusively through
 * `container.agentsRepo` — never an inline join on `agents` through
 * `container.db` (`onion-architecture`, Blind spots §4).
 */

// ---------------------------------------------------------------------------
// Batch / run aggregation (pure, no I/O)
// ---------------------------------------------------------------------------

interface BatchAggregate {
  recall: number;
  precision: number;
  citationAccuracy: number | null;
  tracesPassed: number;
  tracesTotal: number;
  casesErrored: number;
  durationMs: number;
  costUsd: number | null;
}

/**
 * AC-25: a row with `pass = null` means its case errored. Errored rows are
 * excluded from recall/precision/citation_accuracy AND from
 * `traces_passed`/`traces_total` — they only ever show up in `cases_errored`.
 * Otherwise `X/Y pass` would read as "the agent regressed" when the real
 * cause was a dead provider.
 *
 * The recall/precision/citation_accuracy/traces/errored rule itself is
 * `scoring.ts#aggregateEvalBatch` (fix pass, item 4) — the SAME function
 * `runner.ts#aggregate` uses on fresh results, so this read side and that
 * write side cannot independently drift on the mean/null rules again (this
 * file used to coerce a missing per-row `citationAccuracy` to `0` INTO the
 * mean's denominator; the runner never did). Only duration/cost stay local:
 * they sum every PERSISTED row here (this file has no batch-start timestamp
 * to compute a wall-clock duration from, unlike the runner).
 */
function aggregateBatch(runs: EvalBatchRunRow[]): BatchAggregate {
  const agg = aggregateEvalBatch(
    runs.map((r) => ({
      pass: r.pass,
      recall: r.recall,
      precision: r.precision,
      citationAccuracy: r.citationAccuracy,
    })),
  );

  const durationMs = runs.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
  const costValues = runs.map((r) => r.costUsd).filter((c): c is number => c !== null);
  const costUsd = costValues.length > 0 ? costValues.reduce((a, b) => a + b, 0) : null;

  return { ...agg, durationMs, costUsd };
}

function toBatchRecord(batch: EvalBatchRuns, agentName: string): EvalBatchRecord {
  const agg = aggregateBatch(batch.runs);
  return {
    batch_id: batch.batchId,
    agent_id: batch.ownerId,
    agent_name: agentName,
    // Every batch written by runner.ts (step 8) carries `agent_version` on
    // every row; 0 is a defensive fallback for a hypothetically null group,
    // never expected in practice.
    agent_version: batch.agentVersion ?? 0,
    ran_at: batch.ranAt.toISOString(),
    recall: agg.recall,
    precision: agg.precision,
    citation_accuracy: agg.citationAccuracy,
    traces_passed: agg.tracesPassed,
    traces_total: agg.tracesTotal,
    cases_errored: agg.casesErrored,
    duration_ms: agg.durationMs,
    cost_usd: agg.costUsd,
  };
}

/** Best-effort extraction of `{ code, message }` from a failed run's
 *  `actual_output` (shape: `{ error: { code, message } }` — Contract &
 *  migration impact). Falls back to `error_reason` (a plain column, always
 *  set alongside a null `pass`) when `actual_output` doesn't parse as
 *  expected, so a malformed jsonb blob never turns into a thrown 500 here. */
function extractError(actualOutput: unknown, errorReason: string | null): { code: string; message: string } | null {
  if (actualOutput && typeof actualOutput === 'object' && 'error' in actualOutput) {
    const err = (actualOutput as { error?: unknown }).error;
    if (err && typeof err === 'object') {
      const { code, message } = err as { code?: unknown; message?: unknown };
      if (typeof code === 'string' && typeof message === 'string') return { code, message };
    }
  }
  return errorReason ? { code: 'error', message: errorReason } : null;
}

function toRunRecord(row: EvalBatchRunRow): EvalRunRecord {
  return {
    id: row.id,
    case_id: row.caseId,
    case_name: row.caseName,
    batch_id: row.batchId,
    agent_version: row.agentVersion,
    ran_at: row.ranAt.toISOString(),
    actual_output: row.actualOutput,
    error: row.pass === null ? extractError(row.actualOutput, row.errorReason) : null,
    pass: row.pass,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
  };
}

/**
 * AC-31: latest vs previous batch, both already-aggregated `EvalBatchRecord`s
 * (newest-first order is the caller's responsibility). `null` when there is
 * no batch, or only one, to compare — a regression banner needs a baseline —
 * OR when the LATEST batch measured nothing (`traces_total === 0`, every case
 * in it errored — fix pass, item 2a): its `recall`/`precision` are the
 * schema-legal `0` placeholder, not a real measurement, and comparing that
 * placeholder against the previous batch would fabricate an 80pp "regression"
 * out of a dead provider. When both `recall` and `precision` cross the
 * threshold, the larger drop wins the `metric` slot; `others` always carries
 * the LATEST batch's three metrics (the "direction of the rest of the
 * metrics" the banner shows alongside the one that regressed) — including a
 * `null` `citation_accuracy` when the latest batch has one (fix pass, item
 * 2b: never coerced to `0`).
 */
function computeAlert(latest: EvalBatchRecord | null, previous: EvalBatchRecord | null): EvalAlert | null {
  if (!latest || !previous) return null;
  if (latest.traces_total === 0) return null;

  const recallDropPp = round2((previous.recall - latest.recall) * 100);
  const precisionDropPp = round2((previous.precision - latest.precision) * 100);

  // `>=`, not `>` (fix pass, item 6): `REGRESSION_THRESHOLD_PP`'s own doc
  // comment and the spec default both say "at least"/≥ 2 points, so a drop of
  // EXACTLY the threshold must alert, not slip through on a strict `>`.
  const candidates: Array<{ metric: EvalAlert['metric']; dropPp: number }> = [];
  if (recallDropPp >= REGRESSION_THRESHOLD_PP) candidates.push({ metric: 'recall', dropPp: recallDropPp });
  if (precisionDropPp >= REGRESSION_THRESHOLD_PP) candidates.push({ metric: 'precision', dropPp: precisionDropPp });
  if (candidates.length === 0) return null;

  const worst = candidates.reduce((a, b) => (b.dropPp > a.dropPp ? b : a));
  return {
    metric: worst.metric,
    drop_pp: worst.dropPp,
    others: {
      recall: latest.recall,
      precision: latest.precision,
      citation_accuracy: latest.citation_accuracy,
    },
  };
}

function toTrendPoint(record: EvalBatchRecord): EvalTrendPoint {
  return {
    ran_at: record.ran_at,
    recall: record.recall,
    precision: record.precision,
    // Nullable, mirroring `EvalBatchRecord.citation_accuracy` — never coerced
    // to `0` (fix pass, item 2c). Note the vendored `LineChart` DOES flatten
    // `null` to `0` (`charts/LineChart.tsx:35`, `s.data[i] ?? 0`), so the
    // honest handling is upstream of it: `getEvalDashboard` keeps unmeasured
    // batches out of `trend` entirely rather than relying on the chart to draw
    // a gap it cannot draw (review loop 2).
    citation_accuracy: record.citation_accuracy,
    pass_rate: record.traces_total > 0 ? round2(record.traces_passed / record.traces_total) : 0,
    cost_usd: record.cost_usd,
  };
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

/**
 * `GET /eval/overview` (AC-26, AC-27, AC-28): every agent with a non-empty
 * case set, plus the most recent batches across ALL agents. `owner_kind =
 * 'agent'` scoping already lives in `EvalRepository` (AC-28) — nothing here
 * re-checks it.
 *
 * `EvalRepository` has no bulk "case count grouped by agent" read (and this
 * lane owns only `dashboard.ts`, not `repository.ts` — plan Ownership), so
 * determining which agents have a non-empty set costs one `listAgentCases`
 * call per agent. That is bounded by the number of agents in the workspace
 * (a handful, local-first scale), never by run/case volume — unlike
 * `EvalRepository#recentBatches`, which stays at two calls total regardless
 * of how many batches exist. `last_batch` per agent comes from
 * `EvalRepository#latestBatchPerAgent` (fix pass, item 3), NOT from the
 * capped `recent_batches` window below: an agent whose latest run has since
 * scrolled past `BATCH_TABLE_LIMIT` because enough OTHER agents ran more
 * recently must still report its own last batch, not `null`.
 */
export async function getEvalOverview(
  container: Container,
  workspaceId: string,
): Promise<EvalDashboardOverview> {
  const repo = new EvalRepository(container.db);

  const [agents, batches, latestBatches] = await Promise.all([
    container.agentsRepo.list(workspaceId),
    repo.listBatchesForAllAgents(workspaceId, BATCH_TABLE_LIMIT),
    repo.latestBatchPerAgent(workspaceId),
  ]);

  const nameByAgentId = new Map(agents.map((a) => [a.id, a.name]));
  // `batches` is already newest-first (EvalRepository#recentBatches).
  const recentBatches = batches.map((b) => toBatchRecord(b, nameByAgentId.get(b.ownerId) ?? 'unknown'));

  const latestBatchByAgent = new Map<string, EvalBatchRecord>(
    latestBatches.map((b) => [b.ownerId, toBatchRecord(b, nameByAgentId.get(b.ownerId) ?? 'unknown')]),
  );

  const withCases = await Promise.all(
    agents.map(async (agent) => ({ agent, cases: await repo.listAgentCases(workspaceId, agent.id) })),
  );

  const agentSummaries: EvalAgentSummary[] = withCases
    .filter(({ cases }) => cases.length > 0)
    .map(({ agent, cases }) => ({
      agent_id: agent.id,
      name: agent.name,
      model: agent.model,
      cases_total: cases.length,
      last_batch: latestBatchByAgent.get(agent.id) ?? null,
      // Placeholder — step 5 (W2-A) fills this from a per-agent recent-batches
      // read (chronological, `traces_total > 0` only, capped at
      // `BATCH_TABLE_LIMIT`). Do not read meaning into `[]` here yet.
      trend: [],
    }));

  return { agents: agentSummaries, recent_batches: recentBatches };
}

/**
 * One agent's Eval Dashboard page (AC-9, AC-29, AC-30, AC-31): current
 * metrics (latest batch), delta vs the previous batch, a chronological trend
 * across batches, the recent-batches table and the per-case run history, plus
 * the structural regression alert.
 *
 * No batch ever run: `recent_batches`, `trend` and `recent_runs` are all `[]`,
 * `delta` and `alert` are `null` — that combination is the "no runs yet"
 * signal a caller (step 11, step 13) must check for. `current`'s numeric
 * fields (`recall`, `precision`, `citation_accuracy`) cannot themselves carry
 * `null` in that state — `EvalDashboard.current.citation_accuracy` is
 * non-nullable by contract (`vendor/shared/contracts/eval-ci.ts`) — so they
 * fall back to `0`/`null cost_usd`. AC-29 ("never zeros that read as
 * results") is satisfied by the empty arrays, not by these placeholder
 * numbers; a renderer that reads `current` without first checking
 * `recent_batches.length` would violate AC-29 even though the wire body is
 * schema-valid. `delta` is `null` whenever there is no PREVIOUS batch to
 * diff against (fix pass, item 5) — including the first-ever run, which used
 * to render a fabricated flat "0.0 pt" delta instead of no delta row at all.
 */
export async function getEvalDashboard(
  container: Container,
  workspaceId: string,
  agentId: string,
): Promise<EvalDashboard> {
  const agent = await container.agentsRepo.getById(workspaceId, agentId);
  if (!agent) throw new NotFoundError(`Agent ${agentId} not found`);

  const repo = new EvalRepository(container.db);
  const [cases, batches] = await Promise.all([
    repo.listAgentCases(workspaceId, agentId),
    repo.listBatchesForAgent(workspaceId, agentId, BATCH_TABLE_LIMIT),
  ]);

  // `batches` is already newest-first (EvalRepository#recentBatches).
  const recentBatches = batches.map((b) => toBatchRecord(b, agent.name));
  const latest = recentBatches[0] ?? null;
  const previous = recentBatches[1] ?? null;

  const current = latest
    ? {
        recall: latest.recall,
        precision: latest.precision,
        citation_accuracy: latest.citation_accuracy ?? 0,
        traces_passed: latest.traces_passed,
        traces_total: latest.traces_total,
        cost_usd: latest.cost_usd,
      }
    : { recall: 0, precision: 0, citation_accuracy: 0, traces_passed: 0, traces_total: 0, cost_usd: null };

  // `null`, not a fabricated flat `{ recall: 0, precision: 0, ... }`, when
  // there is no previous batch to diff against (fix pass, item 5) — and
  // equally when either side MEASURED NOTHING (`traces_total === 0`, every
  // case errored). Those batches carry the schema-legal `0` placeholder, so
  // diffing them manufactures a "+90.0 pt" recovery or a "-90.0 pt" collapse
  // out of a dead provider key. `computeAlert` already refuses that batch;
  // the tiles have to refuse it too, or the suppressed banner just leaves the
  // fabricated number as the only thing on screen (review loop 2).
  const measured = (b: EvalBatchRecord | null): boolean => !!b && b.traces_total > 0;
  const delta =
    latest && previous && measured(latest) && measured(previous)
      ? {
          recall: round2(latest.recall - previous.recall),
          precision: round2(latest.precision - previous.precision),
          citation_accuracy: round2((latest.citation_accuracy ?? 0) - (previous.citation_accuracy ?? 0)),
        }
      : null;

  // Chronological (oldest first) for a trend chart, unlike the newest-first
  // tables — `EvalTrendPoint`'s own doc comment: "per run, chronological".
  //
  // Batches that measured nothing are EXCLUDED rather than plotted: their
  // metrics are the `0` placeholder the non-nullable contract forces, and the
  // chart would draw a dive to the axis floor that never happened. The batch
  // is still listed in `recent_batches` with its `cases_errored` count — the
  // table is where "this run failed" belongs; the trend is for measurements
  // (review loop 2).
  const trend = [...recentBatches]
    .reverse()
    .filter((b) => b.traces_total > 0)
    .map(toTrendPoint);

  const recentRuns = batches
    .flatMap((b) => b.runs)
    .sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime())
    .map(toRunRecord);

  return {
    owner_kind: 'agent',
    owner_id: agentId,
    cases_total: cases.length,
    current,
    delta,
    trend,
    recent_runs: recentRuns,
    recent_batches: recentBatches,
    alert: computeAlert(latest, previous),
  };
}
