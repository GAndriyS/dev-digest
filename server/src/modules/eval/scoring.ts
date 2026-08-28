import { normalizeFilePath, rangesOverlap, type LineRange } from './helpers.js';
import type { ExpectedFinding } from './helpers.js';

/**
 * The eval scorer (AC-15..AC-21, AC-31). Pure functions only — no container,
 * no adapter, no LLM call. Everything the runner (step 8) and the dashboard
 * (step 9) need is exported here with explicit types so neither has to
 * re-derive the rules.
 *
 * Deliberately NOT copied from the pre-product reference
 * (`server/src/modules/eval/findingMatches` in the pre-product history):
 * that version also credited a match on title substring and on
 * severity/category equality. AC-15 allows ONLY normalized file path +
 * line-range overlap — matching on anything else would let a model get
 * credit for flagging the right kind of problem in the wrong place, which is
 * exactly what citation grounding (AC-14) exists to catch.
 */

/** The slice of a grounded (post-gate) model finding the scorer needs. */
export interface ActualFinding extends LineRange {
  file: string;
}

/** Result of crediting expected findings against the grounded actual ones. */
export interface MatchResult {
  /** Count of expected findings that had at least one uncredited actual match. */
  creditedExpectations: number;
  /** Count of actual findings spent crediting an expectation (≤ 1 each, AC-15). */
  creditedActuals: number;
}

/**
 * AC-15 — credit assignment.
 *
 * A match counts iff an actual finding has the SAME normalized file path as
 * an expected finding AND their line ranges overlap — that predicate (same
 * file + overlap) is the ONLY edge in the bipartite graph below; nothing
 * else (title, severity, category) ever adds or removes an edge. Each
 * actual finding is credited at most once (AC-15).
 *
 * This is MAXIMUM bipartite matching (Kuhn's augmenting-path algorithm), not
 * a greedy first-match: a greedy one-pass assignment under-counts whenever
 * an earlier expectation "steals" the only actual finding a LATER
 * expectation could have matched, while a different assignment would have
 * covered both. Counter-example (fix pass, item 7): expected `A(1-5)`,
 * `B(4-8)` in `a.ts`; actual `X(4-5)`, `Y(1-2)` in `a.ts`. Every pair
 * overlaps except `B`×`Y`. Greedy assigns `A`→`X` first (first match in
 * order), leaving `B` with no unspent partner — 1/2 credited. The maximum
 * matching is `A`→`Y`, `B`→`X` — 2/2, recall 1. Input sizes here (a handful
 * of findings per case) make Kuhn's O(V·E) irrelevant in practice; the
 * point is correctness, not asymptotics.
 */
export function matchFindings(
  expected: readonly ExpectedFinding[],
  actual: readonly ActualFinding[],
): MatchResult {
  const normalizedActualPaths = actual.map((a) => normalizeFilePath(a.file));

  // adjacency[e] = indices into `actual` that expected finding `e` could
  // match (same normalized path + overlapping range — AC-15's only edge).
  const adjacency: number[][] = expected.map((exp) => {
    const expPath = normalizeFilePath(exp.file);
    const edges: number[] = [];
    for (let i = 0; i < actual.length; i++) {
      if (normalizedActualPaths[i] === expPath && rangesOverlap(exp, actual[i]!)) edges.push(i);
    }
    return edges;
  });

  // matchOfActual[i] = the expected-finding index currently matched to
  // actual finding i, or -1 when unmatched.
  const matchOfActual = new Array<number>(actual.length).fill(-1);

  /** One augmenting-path attempt for expected finding `e`: try every actual
   *  it could match; if that actual is already taken, try to re-home the
   *  actual's current match elsewhere first (the "augmenting" step). */
  function tryAugment(e: number, visited: boolean[]): boolean {
    for (const actIdx of adjacency[e]!) {
      if (visited[actIdx]) continue;
      visited[actIdx] = true;
      const currentOwner = matchOfActual[actIdx]!;
      if (currentOwner === -1 || tryAugment(currentOwner, visited)) {
        matchOfActual[actIdx] = e;
        return true;
      }
    }
    return false;
  }

  let creditedExpectations = 0;
  for (let e = 0; e < expected.length; e++) {
    const visited = new Array<boolean>(actual.length).fill(false);
    if (tryAugment(e, visited)) creditedExpectations += 1;
  }

  const creditedActuals = matchOfActual.filter((m) => m !== -1).length;
  return { creditedExpectations, creditedActuals };
}

/** AC-16 — recall = credited expectations / all expectations; 1 when none expected. */
export function recall(expectedCount: number, creditedExpectations: number): number {
  return expectedCount === 0 ? 1 : creditedExpectations / expectedCount;
}

/**
 * AC-17 — precision = credited actuals / actuals that survived grounding;
 * 1 when none survived.
 */
export function precision(creditedActuals: number, survivedCount: number): number {
  return survivedCount === 0 ? 1 : creditedActuals / survivedCount;
}

/**
 * AC-18 — citation_accuracy = survived findings / raw findings the model
 * emitted; 1 when the model emitted none.
 */
export function citationAccuracy(survivedCount: number, rawCount: number): number {
  return rawCount === 0 ? 1 : survivedCount / rawCount;
}

/** AC-19 — pass iff recall and precision are both exactly 1. */
export function evalPass(recallValue: number, precisionValue: number): boolean {
  return recallValue === 1 && precisionValue === 1;
}

/** The full metric set for one eval case run — what `eval_runs` persists. */
export interface EvalCaseScore {
  pass: boolean;
  recall: number;
  precision: number;
  citation_accuracy: number;
}

/**
 * Score one case run: credit-match expected against grounded findings, then
 * derive all four metrics from the plan's stated rules (AC-16..AC-19).
 *
 * `survived` must already be the grounding-gate output (AC-14) — this
 * function does not run the gate itself, it only scores its result against
 * `rawCount` for citation_accuracy's denominator.
 */
export function scoreEvalCase(
  expected: readonly ExpectedFinding[],
  survived: readonly ActualFinding[],
  rawCount: number,
): EvalCaseScore {
  const { creditedExpectations, creditedActuals } = matchFindings(expected, survived);
  const r = recall(expected.length, creditedExpectations);
  const p = precision(creditedActuals, survived.length);
  return {
    pass: evalPass(r, p),
    recall: r,
    precision: p,
    citation_accuracy: citationAccuracy(survived.length, rawCount),
  };
}

// ---------------------------------------------------------------------------
// Batch aggregation (fix pass, item 4) — the ONE function both the runner
// (fresh in-memory results, same call) and the dashboard (persisted rows,
// read back later) use to roll per-case outcomes into batch-level metrics.
// Before this fix the two independently re-derived the rule and drifted:
// the dashboard's `citation_accuracy` coerced a missing per-row value to 0
// INTO the mean's denominator, which is not what the runner did.
// ---------------------------------------------------------------------------

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** The slice of one persisted/in-batch run outcome the aggregator needs —
 *  `pass: null` is what AC-25 uses to mark "this case errored". */
export interface EvalRunOutcome {
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
}

export interface EvalBatchAggregate {
  recall: number;
  precision: number;
  citationAccuracy: number | null;
  tracesPassed: number;
  tracesTotal: number;
  casesErrored: number;
}

/**
 * Aggregate one batch's per-case outcomes (AC-16..AC-20, AC-25, AC-31).
 *
 * - `recall`/`precision`: round2 MEAN over non-errored (`pass !== null`)
 *   rows; `0` when every row errored — a schema-legal placeholder
 *   (`EvalBatchRecord.recall`/`.precision` are non-nullable), never read as
 *   a real value because a caller that skips the regression alert on
 *   `traces_total === 0` (fix pass, item 2a) never surfaces it as a drop.
 * - `citation_accuracy`: round2 MEAN over rows where it is non-null — a
 *   missing value is EXCLUDED from the denominator, never coerced to 0
 *   inside it; `null` when no row has one.
 * - `traces_passed`/`traces_total` exclude errored rows entirely;
 *   `cases_errored` counts them.
 */
export function aggregateEvalBatch(runs: readonly EvalRunOutcome[]): EvalBatchAggregate {
  const valid = runs.filter((r) => r.pass !== null);
  const casesErrored = runs.length - valid.length;
  const tracesTotal = valid.length;
  const tracesPassed = valid.filter((r) => r.pass === true).length;

  const recallValues = valid.map((r) => r.recall).filter((v): v is number => v !== null);
  const precisionValues = valid.map((r) => r.precision).filter((v): v is number => v !== null);
  const citationValues = valid.map((r) => r.citationAccuracy).filter((v): v is number => v !== null);

  return {
    recall: recallValues.length > 0 ? round2(mean(recallValues)) : 0,
    precision: precisionValues.length > 0 ? round2(mean(precisionValues)) : 0,
    citationAccuracy: citationValues.length > 0 ? round2(mean(citationValues)) : null,
    tracesPassed,
    tracesTotal,
    casesErrored,
  };
}
