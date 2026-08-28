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

/**
 * The kind to show for a case: the **stored** `expectation_kind` (AC-53),
 * falling back to the derived `expectationType()` only when the field is
 * absent or `null`. Defensive, not routine: after the wave-1 backfill (AC-56)
 * every agent case carries a stored kind, so this branch exists only for a
 * row written before that migration ran, never for one created since.
 */
export function expectationKindOf(evalCase: EvalCase): ExpectationType {
  return evalCase.expectation_kind ?? expectationType(evalCase.expected_output);
}

/** `expectationMismatch`'s return shape: the stored kind that disagrees with
    the case's actual expectations, and how many expectations there are. */
export type ExpectationMismatch = { kind: ExpectationType; count: number };

/**
 * `null` when the case has no stored kind to contradict, or when the stored
 * kind and the actual `expected_output` agree. Otherwise the mismatch (AC-58,
 * both directions): a `must_find` case with zero expectations, or a
 * `must_not_flag` case with some. Reads the **raw** `expectation_kind` field,
 * never `expectationKindOf()` — a fallback-derived kind is computed from the
 * same `expected_output` it would be compared against, so it can never
 * disagree with it, which would silently hide the very state AC-58 exists to
 * surface (a case edited after creation, so the stored intent and the
 * current expectations have drifted apart).
 */
export function expectationMismatch(evalCase: EvalCase): ExpectationMismatch | null {
  const kind = evalCase.expectation_kind;
  if (!kind) return null;
  const count = expectedFindings(evalCase.expected_output).length;
  if (kind === "must_find" && count === 0) return { kind, count };
  if (kind === "must_not_flag" && count > 0) return { kind, count };
  return null;
}

export type CaseOrigin = "accepted" | "dismissed" | "manual";

/**
 * The case editor's subtitle origin (AC-59), derived from exactly two fields
 * and no others (plan's Contract & migration impact): `source_finding_id ==
 * null` is a hand-made case; otherwise the stored kind tells which decision
 * minted it — `must_find` came from an accepted finding, anything else
 * (`must_not_flag`, or a legacy row with no stored kind) from a dismissed one.
 */
export function caseOrigin(evalCase: EvalCase): CaseOrigin {
  if (evalCase.source_finding_id == null) return "manual";
  return evalCase.expectation_kind === "must_find" ? "accepted" : "dismissed";
}
