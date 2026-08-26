import type { EvalCase, EvalRunRecord } from "@devdigest/shared";

export type CaseOutcome = "passed" | "failed" | "errored" | "never";

/**
 * Most recent run per case, read from `EvalDashboard.recent_runs` (plan
 * step 9's per-case rows) — never assumed to already arrive sorted, and
 * never derived from a just-triggered `useRunAgentEvalBatch()` result alone:
 * a case's last run may predate this page load, and the dashboard read is
 * the one that knows about every run, not just the one just fired here.
 */
export function latestRunByCase(runs: EvalRunRecord[]): Map<string, EvalRunRecord> {
  const map = new Map<string, EvalRunRecord>();
  for (const run of runs) {
    const existing = map.get(run.case_id);
    if (!existing || new Date(run.ran_at).getTime() > new Date(existing.ran_at).getTime()) {
      map.set(run.case_id, run);
    }
  }
  return map;
}

/** `pass: null` on a run means the case errored (AC-25) — a third outcome,
    distinct from failed (`pass: false`, scored but under 1.0). */
export function caseOutcome(run: EvalRunRecord | undefined): CaseOutcome {
  if (!run) return "never";
  if (run.pass === true) return "passed";
  if (run.pass === false) return "failed";
  return "errored";
}

/** "N of M passed" for the case-list header — driven by the full case list
    (so a case added since the last batch still counts toward the total),
    not by the latest batch's own `traces_total` alone. */
export function countPassed(cases: EvalCase[], latest: Map<string, EvalRunRecord>): number {
  return cases.filter((c) => caseOutcome(latest.get(c.id)) === "passed").length;
}

/**
 * `expected_output.findings`: non-empty = must_find, `[]` = must_not_flag,
 * and anything else (absent field, wrong shape) safe-parses to `[]` and
 * reads as must_not_flag too — mirroring the server scorer's `safeParse`
 * fallback (plan step 3) so the tab never disagrees with what actually gets
 * scored, and never 500s on a hand-edited case.
 */
export function expectedFindings(expectedOutput: unknown): unknown[] {
  if (typeof expectedOutput !== "object" || expectedOutput === null) return [];
  const raw = (expectedOutput as Record<string, unknown>).findings;
  return Array.isArray(raw) ? raw : [];
}

export type ExpectationType = "must_find" | "must_not_flag";

export function expectationType(expectedOutput: unknown): ExpectationType {
  return expectedFindings(expectedOutput).length > 0 ? "must_find" : "must_not_flag";
}
