import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import type { SeverityCountsView } from "@/components/severity-counters";

/** Tally one run's findings by severity (dismissed included, like findings_count). */
export function rollupSeverities(findings: FindingRecord[]): SeverityCountsView {
  const counts: SeverityCountsView = { critical: 0, warning: 0, suggestion: 0 };
  for (const f of findings) {
    if (f.severity === "CRITICAL") counts.critical += 1;
    else if (f.severity === "WARNING") counts.warning += 1;
    else if (f.severity === "SUGGESTION") counts.suggestion += 1;
  }
  return counts;
}

/**
 * run_id → severity breakdown, joined client-side from the reviews already
 * loaded for the accordions. Runs that never persisted a review (failed,
 * cancelled, review deleted) get no entry, so their timeline row shows no chips.
 */
export function severityCountsByRun(reviews: ReviewRecord[]): Record<string, SeverityCountsView> {
  const byRun: Record<string, SeverityCountsView> = {};
  for (const review of reviews) {
    if (!review.run_id) continue;
    byRun[review.run_id] = rollupSeverities(review.findings);
  }
  return byRun;
}

/**
 * run_id → the findings themselves, for the counters' hover card. Same join as
 * `severityCountsByRun`; the detail page already holds every finding in memory,
 * so the timeline's hover card costs no extra request.
 */
export function findingsByRun(reviews: ReviewRecord[]): Record<string, FindingRecord[]> {
  const byRun: Record<string, FindingRecord[]> = {};
  for (const review of reviews) {
    if (!review.run_id) continue;
    byRun[review.run_id] = review.findings;
  }
  return byRun;
}
