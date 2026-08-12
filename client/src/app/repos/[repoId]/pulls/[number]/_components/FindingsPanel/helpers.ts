import type { FindingRecord, Severity } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/**
 * Optionally narrow to one severity, drop low-confidence findings, and sort.
 * `keepId` — a finding navigated to from the Diff tab — bypasses BOTH cuts: a
 * click that lands on a finding hidden by the caller's own filter would look
 * like the click did nothing.
 */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  severity?: Severity | null,
  keepId?: string | null,
): FindingRecord[] {
  let shown = findings;
  if (severity) shown = shown.filter((f) => f.severity === severity || f.id === keepId);
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD || f.id === keepId);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}
