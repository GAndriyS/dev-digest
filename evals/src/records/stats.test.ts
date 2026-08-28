/**
 * The only non-model tests in the package — pure statistics math on fixed arrays.
 *   pnpm vitest run src/records/stats.test.ts
 */

import { describe, expect, test } from "vitest";
import { aggregate, calcStats, computeFlags, type EvalRecord } from "./stats.js";

const series = (passed: number, total: number) => ({ passed, total, rate: total ? passed / total : 0 });

const row = (over: Partial<EvalRecord>): EvalRecord => ({
  schema: 1,
  run_id: "t",
  git_sha: "0000000",
  dirty: false,
  config: "candidate",
  nodeid: "f.eval.ts > agent:x > case",
  label: "case",
  outcome: false,
  practices: [],
  num_turns: 10,
  metrics: { durationMs: 1000, inputTokens: 10, outputTokens: 100, toolCallCount: 3 },
  trace: { tools: [], subagents: [], skills: [], reads: [] },
  output_file: "outputs/t/case.md",
  ...over,
});

describe("calcStats", () => {
  test("mean / min / max / sample stddev of a known array", () => {
    const s = calcStats([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s.mean).toBe(5);
    expect(s.min).toBe(2);
    expect(s.max).toBe(9);
    // sample stddev (n−1) of this classic array ≈ 2.138 (population would be 2.0)
    expect(s.stddev).toBeCloseTo(2.138, 3);
    expect(s.n).toBe(8);
  });

  test("empty → zeros with n=0; singleton → stddev 0", () => {
    expect(calcStats([])).toEqual({ mean: 0, stddev: 0, min: 0, max: 0, n: 0 });
    expect(calcStats([42])).toEqual({ mean: 42, stddev: 0, min: 42, max: 42, n: 1 });
  });
});

describe("aggregate: invalid rows", () => {
  test("valid:false rows are excluded from rates and metrics, counted in `invalid`", () => {
    const rows = [
      row({ outcome: true, practices: [{ practice: "p", passed: true, evidence: "e" }] }),
      row({ outcome: true, practices: [{ practice: "p", passed: true, evidence: "e" }] }),
      // A zero-turn timeout: zeroed metrics that would drag every mean toward 0 if averaged in.
      row({
        outcome: false,
        valid: false,
        timed_out: true,
        num_turns: 0,
        metrics: { durationMs: 180000, inputTokens: 0, outputTokens: 0, toolCallCount: 0 },
      }),
    ];
    const agg = aggregate(rows)[rows[0].nodeid];
    expect(agg.pass).toEqual(series(2, 2)); // 2/2, not 2/3
    expect(agg.invalid).toBe(1);
    expect(agg.practices["p"]).toEqual(series(2, 2));
    expect(agg.metrics.outputTokens.mean).toBe(100); // the invalid row's 0 is not averaged in
    expect(agg.metrics.numTurns.n).toBe(2);
  });

  test("rows without a `valid` field (pre-field schema) count as valid", () => {
    const rows = [row({ outcome: true }), row({ outcome: false })];
    const agg = aggregate(rows)[rows[0].nodeid];
    expect(agg.pass).toEqual(series(1, 2));
    expect(agg.invalid).toBe(0);
  });

  test("all rows invalid → n=0 with the invalid count carrying the story", () => {
    const rows = [row({ valid: false }), row({ valid: false })];
    const agg = aggregate(rows)[rows[0].nodeid];
    expect(agg.pass).toEqual(series(0, 0));
    expect(agg.invalid).toBe(2);
  });
});

describe("computeFlags", () => {
  test("non_discriminating: 100% in both", () => {
    expect(computeFlags(series(5, 5), series(5, 5))).toContain("non_discriminating");
  });

  test("always_failing (n>0, rate 0) is NOT missing_data", () => {
    const flags = computeFlags(series(0, 5), series(0, 5));
    expect(flags).toContain("always_failing");
    expect(flags).not.toContain("missing_data");
  });

  test("missing_data (n=0) is NOT always_failing", () => {
    const flags = computeFlags(series(0, 0), series(0, 5));
    expect(flags).toContain("missing_data");
    expect(flags).not.toContain("always_failing");
  });

  test("flaky is exclusive of the 20% and 80% boundaries", () => {
    expect(computeFlags(series(1, 2), series(5, 5))).toContain("flaky"); // 50%
    expect(computeFlags(series(1, 5), series(5, 5))).not.toContain("flaky"); // exactly 20%
    expect(computeFlags(series(4, 5), series(5, 5))).not.toContain("flaky"); // exactly 80%
  });

  test("cost_regression when candidate tokens exceed 125% of baseline", () => {
    expect(computeFlags(series(5, 5), series(5, 5), { candTokens: 130, baseTokens: 100 })).toContain(
      "cost_regression",
    );
    expect(computeFlags(series(5, 5), series(5, 5), { candTokens: 120, baseTokens: 100 })).not.toContain(
      "cost_regression",
    );
  });
});
