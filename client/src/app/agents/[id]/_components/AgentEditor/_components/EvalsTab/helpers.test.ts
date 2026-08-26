import { describe, it, expect } from "vitest";
import type { EvalCase } from "@devdigest/shared";
import { expectationKindOf, expectationMismatch, caseOrigin } from "./helpers";

function makeCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "c1",
    owner_kind: "agent",
    owner_id: "ag1",
    name: "case one",
    input_diff: "@@ -1 +1 @@",
    input_files: null,
    input_meta: null,
    expected_output: { findings: [] },
    notes: null,
    source_finding_id: null,
    expectation_kind: null,
    ...overrides,
  };
}

describe("expectationKindOf", () => {
  it("reads the stored kind when present", () => {
    const evalCase = makeCase({ expectation_kind: "must_not_flag", expected_output: { findings: [{}] } });
    expect(expectationKindOf(evalCase)).toBe("must_not_flag");
  });

  it("falls back to deriving from expected_output when the stored kind is null", () => {
    const evalCase = makeCase({ expectation_kind: null, expected_output: { findings: [{}] } });
    expect(expectationKindOf(evalCase)).toBe("must_find");
  });

  it("falls back to must_not_flag when the stored kind is absent and there are no expectations", () => {
    const evalCase = makeCase({ expectation_kind: undefined, expected_output: { findings: [] } });
    expect(expectationKindOf(evalCase)).toBe("must_not_flag");
  });
});

describe("expectationMismatch", () => {
  it("returns null when there is no stored kind to contradict", () => {
    const evalCase = makeCase({ expectation_kind: null, expected_output: { findings: [{}] } });
    expect(expectationMismatch(evalCase)).toBeNull();
  });

  it("returns null when the stored kind agrees with the expectations", () => {
    const mustFind = makeCase({ expectation_kind: "must_find", expected_output: { findings: [{}] } });
    const mustNotFlag = makeCase({ expectation_kind: "must_not_flag", expected_output: { findings: [] } });
    expect(expectationMismatch(mustFind)).toBeNull();
    expect(expectationMismatch(mustNotFlag)).toBeNull();
  });

  it("flags a must_find case with zero expectations", () => {
    const evalCase = makeCase({ expectation_kind: "must_find", expected_output: { findings: [] } });
    expect(expectationMismatch(evalCase)).toEqual({ kind: "must_find", count: 0 });
  });

  it("flags a must_not_flag case with some expectations", () => {
    const evalCase = makeCase({
      expectation_kind: "must_not_flag",
      expected_output: { findings: [{}, {}] },
    });
    expect(expectationMismatch(evalCase)).toEqual({ kind: "must_not_flag", count: 2 });
  });
});

describe("caseOrigin", () => {
  it("is manual when the case has no source finding", () => {
    const evalCase = makeCase({ source_finding_id: null });
    expect(caseOrigin(evalCase)).toBe("manual");
  });

  it("is accepted when seeded from a finding and stored as must_find", () => {
    const evalCase = makeCase({ source_finding_id: "f1", expectation_kind: "must_find" });
    expect(caseOrigin(evalCase)).toBe("accepted");
  });

  it("is dismissed when seeded from a finding and stored as must_not_flag", () => {
    const evalCase = makeCase({ source_finding_id: "f1", expectation_kind: "must_not_flag" });
    expect(caseOrigin(evalCase)).toBe("dismissed");
  });

  it("is dismissed for a seeded, legacy case with no stored kind (no third source of provenance)", () => {
    const evalCase = makeCase({ source_finding_id: "f1", expectation_kind: null });
    expect(caseOrigin(evalCase)).toBe("dismissed");
  });
});
