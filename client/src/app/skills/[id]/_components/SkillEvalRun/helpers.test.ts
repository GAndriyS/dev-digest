import { describe, it, expect } from "vitest";
import type { EvalCase, EvalRun } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { indexRunsByCase, isNoProviderKey } from "./helpers";

const evalCase = (id: string, name: string): EvalCase => ({
  id,
  owner_kind: "skill",
  owner_id: "sk1",
  name,
  input_diff: "@@ -1 +1 @@",
  input_files: null,
  input_meta: null,
  expected_output: { findings: [{ severity: "CRITICAL", category: "security" }] },
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

describe("indexRunsByCase", () => {
  const cases = [evalCase("c1", "alpha"), evalCase("c2", "beta")];

  it("matches a run to its case by trace name, whatever the order", () => {
    const beta = run(1, 1, { name: "beta", actual: 1 });
    const alpha = run(0, 1, { name: "alpha", actual: 0 });
    const byId = indexRunsByCase(cases, [beta, alpha]);
    expect(byId.c1).toBe(alpha);
    expect(byId.c2).toBe(beta);
  });

  it("falls back to list order for runs with no identifying trace", () => {
    const first = run(1, 1);
    const second = run(0, 1);
    const byId = indexRunsByCase(cases, [first, second]);
    expect(byId.c1).toBe(first);
    expect(byId.c2).toBe(second);
  });
});

describe("isNoProviderKey", () => {
  it("recognises the 409 the eval endpoints answer with", () => {
    expect(isNoProviderKey(new ApiError("nope", 409, "no_provider_key"))).toBe(true);
  });

  it("ignores every other failure", () => {
    expect(isNoProviderKey(new ApiError("conflict", 409, "other"))).toBe(false);
    expect(isNoProviderKey(new ApiError("boom", 500))).toBe(false);
    expect(isNoProviderKey(new Error("boom"))).toBe(false);
    expect(isNoProviderKey(null)).toBe(false);
  });
});
