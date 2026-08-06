import type { EvalCase, EvalRun, FindingCategory, Severity } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { NO_PROVIDER_KEY } from "./constants";

/**
 * The editor's model of an expectation: "N findings, all of severity S".
 *
 * The WIRE shape is different and is the server's:
 * `{ findings: [{ severity, category? }, …] }` — an array, one entry per
 * expected finding, validated strictly by `POST /skills/:id/eval-cases`. The
 * comparator scores on the multiset of severities, so an array is what it needs.
 *
 * The form stays a count + one severity because that is the case worth
 * authoring by hand; `readExpected` / `toExpectedOutput` convert at the
 * boundary. A case written elsewhere with mixed severities reads back as its
 * count plus the FIRST severity — lossy, and the round-trip would flatten it,
 * so `readExpected` reports `mixed` and the modal refuses to overwrite it.
 */
export interface ExpectedOutput {
  findings: number;
  severity: Severity | null;
  category: FindingCategory | null;
  /** True when the stored entries disagree — the flat form cannot represent it. */
  mixed: boolean;
}

export const EMPTY_EXPECTED: ExpectedOutput = {
  findings: 0,
  severity: null,
  category: null,
  mixed: false,
};

export function readExpected(value: unknown): ExpectedOutput {
  if (typeof value !== "object" || value === null) return EMPTY_EXPECTED;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.findings)) return EMPTY_EXPECTED;

  const entries = raw.findings.filter(
    (f): f is Record<string, unknown> => typeof f === "object" && f !== null,
  );
  const first = entries[0];
  const severity = typeof first?.severity === "string" ? (first.severity as Severity) : null;
  const category = typeof first?.category === "string" ? (first.category as FindingCategory) : null;
  const mixed = entries.some(
    (f) => f.severity !== severity || (f.category ?? null) !== (category ?? null),
  );

  return { findings: entries.length, severity, category, mixed };
}

/**
 * Build the wire shape from the form. `severity` is REQUIRED by the server for
 * every entry, so a non-zero count with no severity cannot be expressed — the
 * modal blocks submit in that state rather than sending something that 422s.
 */
export function toExpectedOutput(expected: ExpectedOutput): {
  findings: { severity: Severity; category?: FindingCategory }[];
} {
  if (expected.findings <= 0 || !expected.severity) return { findings: [] };
  const entry = {
    severity: expected.severity,
    ...(expected.category ? { category: expected.category } : {}),
  };
  return { findings: Array.from({ length: expected.findings }, () => ({ ...entry })) };
}

export type CaseOutcome = "pass" | "fail" | "never";

export function caseOutcome(run: EvalRun | undefined): CaseOutcome {
  if (!run) return "never";
  return run.traces_total > 0 && run.traces_passed === run.traces_total ? "pass" : "fail";
}

/**
 * How many findings the run actually produced. The engine reports it as the
 * trace's `actual`, which is either the count or the findings themselves.
 */
export function actualFindings(run: EvalRun | undefined): number | null {
  const actual = run?.per_trace[0]?.actual;
  if (typeof actual === "number") return actual;
  if (Array.isArray(actual)) return actual.length;
  return null;
}

/**
 * `POST /skills/:id/eval-run` returns one EvalRun per case in list order. Match
 * on the trace name first (order is the server's, not necessarily ours) and
 * fall back to the position when a run carries no identifying trace.
 */
export function indexRunsByCase(cases: EvalCase[], runs: EvalRun[]): Record<string, EvalRun> {
  const byId: Record<string, EvalRun> = {};
  const unmatched: EvalRun[] = [];
  for (const run of runs) {
    const traceName = run.per_trace[0]?.name;
    const hit = traceName ? cases.find((c) => c.name === traceName) : undefined;
    if (hit) byId[hit.id] = run;
    else unmatched.push(run);
  }
  let cursor = 0;
  for (const c of cases) {
    if (byId[c.id]) continue;
    const next = unmatched[cursor];
    if (!next) break;
    byId[c.id] = next;
    cursor++;
  }
  return byId;
}

export function countPassing(cases: EvalCase[], results: Record<string, EvalRun>): number {
  return cases.filter((c) => caseOutcome(results[c.id]) === "pass").length;
}

/** True when a failed eval run means "no LLM provider key is configured". */
export function isNoProviderKey(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === NO_PROVIDER_KEY;
}
