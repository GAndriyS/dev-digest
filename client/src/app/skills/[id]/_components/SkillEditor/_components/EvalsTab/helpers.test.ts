import { describe, it, expect } from "vitest";
import type { EvalCase, EvalRun } from "@devdigest/shared";
import {
  actualFindings,
  caseOutcome,
  countPassing,
  EMPTY_EXPECTED,
  readExpected,
  toExpectedOutput,
} from "./helpers";

const evalCase = (id: string, name: string, expected?: unknown): EvalCase => ({
  id,
  owner_kind: "skill",
  owner_id: "sk1",
  name,
  input_diff: "@@ -1 +1 @@",
  input_files: null,
  input_meta: null,
  expected_output: expected ?? { findings: [{ severity: "CRITICAL", category: "security" }] },
  notes: null,
});

const run = (passed: number, total: number, trace?: { name: string; actual: unknown }): EvalRun => ({
  recall: 1,
  precision: 1,
  citation_accuracy: 1,
  traces_passed: passed,
  traces_total: total,
  duration_ms: 10,
  cost_usd: null,
  per_trace: trace
    ? [{ name: trace.name, pass: passed === total, expected: 1, actual: trace.actual }]
    : [],
});

describe("readExpected", () => {
  it("reads the server's array shape as a count plus its severity", () => {
    const stored = {
      findings: [
        { severity: "WARNING", category: "perf" },
        { severity: "WARNING", category: "perf" },
        { severity: "WARNING", category: "perf" },
      ],
    };
    expect(readExpected(stored)).toEqual({
      findings: 3,
      severity: "WARNING",
      category: "perf",
      mixed: false,
    });
  });

  it("flags entries the flat form cannot represent", () => {
    const stored = {
      findings: [{ severity: "CRITICAL", category: "security" }, { severity: "WARNING" }],
    };
    expect(readExpected(stored)).toMatchObject({ findings: 2, mixed: true });
  });

  it("degrades to zero findings for a case authored elsewhere", () => {
    expect(readExpected(null)).toEqual(EMPTY_EXPECTED);
    expect(readExpected("nope")).toEqual(EMPTY_EXPECTED);
    expect(readExpected({ other: true })).toEqual(EMPTY_EXPECTED);
    // The pre-integration flat shape is no longer accepted — it is not what the
    // server stores, and reading it as valid is how the mismatch stayed hidden.
    expect(readExpected({ findings: 3, severity: "WARNING" })).toEqual(EMPTY_EXPECTED);
  });
});

describe("toExpectedOutput", () => {
  it("expands the count into one entry per expected finding", () => {
    expect(
      toExpectedOutput({ findings: 2, severity: "CRITICAL", category: "security", mixed: false }),
    ).toEqual({
      findings: [
        { severity: "CRITICAL", category: "security" },
        { severity: "CRITICAL", category: "security" },
      ],
    });
  });

  it("omits category when none was chosen", () => {
    expect(
      toExpectedOutput({ findings: 1, severity: "WARNING", category: null, mixed: false }),
    ).toEqual({ findings: [{ severity: "WARNING" }] });
  });

  it("yields an empty expectation with no severity or a zero count", () => {
    const none = { findings: [] };
    expect(toExpectedOutput({ ...EMPTY_EXPECTED })).toEqual(none);
    expect(
      toExpectedOutput({ findings: 2, severity: null, category: null, mixed: false }),
    ).toEqual(none);
  });

  it("round-trips through readExpected", () => {
    const form = {
      findings: 2,
      severity: "CRITICAL" as const,
      category: "security" as const,
      mixed: false,
    };
    expect(readExpected(toExpectedOutput(form))).toEqual(form);
  });
});

describe("caseOutcome", () => {
  it("is 'never' with no run", () => {
    expect(caseOutcome(undefined)).toBe("never");
  });

  it("passes only when every trace passed", () => {
    expect(caseOutcome(run(1, 1))).toBe("pass");
    expect(caseOutcome(run(0, 1))).toBe("fail");
  });

  it("does not call an empty run a pass", () => {
    expect(caseOutcome(run(0, 0))).toBe("fail");
  });
});

describe("actualFindings", () => {
  it("accepts a count or the findings themselves", () => {
    expect(actualFindings(run(1, 1, { name: "c", actual: 2 }))).toBe(2);
    expect(actualFindings(run(1, 1, { name: "c", actual: [{}, {}, {}] }))).toBe(3);
  });

  it("is null when the run says nothing about findings", () => {
    expect(actualFindings(undefined)).toBeNull();
    expect(actualFindings(run(1, 1))).toBeNull();
    expect(actualFindings(run(1, 1, { name: "c", actual: "??" }))).toBeNull();
  });
});

describe("countPassing", () => {
  it("counts only cases whose run passed", () => {
    const cases = [evalCase("c1", "alpha"), evalCase("c2", "beta"), evalCase("c3", "gamma")];
    const results = { c1: run(1, 1), c2: run(0, 1) };
    expect(countPassing(cases, results)).toBe(1);
  });
});
