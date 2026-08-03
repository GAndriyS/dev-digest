import type { Severity } from "@devdigest/shared";

/**
 * The three contract severities, in display order (worst first). The UI kit's
 * `SEV` map carries a fourth value (`INFO`) that the API cannot produce, so the
 * list is spelled out here rather than derived from the token map.
 */
export const SEVERITY_KEYS: {
  severity: Severity;
  /** key on SeverityCountsView */
  countKey: "critical" | "warning" | "suggestion";
}[] = [
  { severity: "CRITICAL", countKey: "critical" },
  { severity: "WARNING", countKey: "warning" },
  { severity: "SUGGESTION", countKey: "suggestion" },
];
