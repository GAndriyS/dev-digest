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
 * an expected finding AND their line ranges overlap. Each actual finding is
 * credited at most once: once it has been spent matching one expected
 * finding, it is removed from the pool and cannot match a second one. This
 * is a greedy one-pass assignment (first available match, in expected
 * order) rather than a maximum-cardinality matching — the input sizes here
 * (a handful of findings per case) make the two equivalent in practice, and
 * greedy keeps the rule simple enough to state in one sentence.
 */
export function matchFindings(
  expected: readonly ExpectedFinding[],
  actual: readonly ActualFinding[],
): MatchResult {
  const spent = new Set<number>();
  let creditedExpectations = 0;

  for (const exp of expected) {
    const expPath = normalizeFilePath(exp.file);
    const idx = actual.findIndex(
      (act, i) => !spent.has(i) && normalizeFilePath(act.file) === expPath && rangesOverlap(exp, act),
    );
    if (idx >= 0) {
      spent.add(idx);
      creditedExpectations += 1;
    }
  }

  return { creditedExpectations, creditedActuals: spent.size };
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
