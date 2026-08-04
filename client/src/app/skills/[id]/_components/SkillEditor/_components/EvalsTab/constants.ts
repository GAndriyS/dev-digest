import type { FindingCategory, Severity } from "@devdigest/shared";

/** Selectable expected severities (labels are the contract values themselves). */
export const SEVERITY_VALUES: readonly Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

/** Selectable expected categories. */
export const CATEGORY_VALUES: readonly FindingCategory[] = [
  "bug",
  "security",
  "perf",
  "style",
  "test",
];

/** The 409 code the eval endpoints answer with when no LLM key is configured. */
export const NO_PROVIDER_KEY = "no_provider_key";

/** Colour per case outcome. */
export const OUTCOME_COLORS = {
  pass: "var(--ok)",
  fail: "var(--crit)",
  never: "var(--text-muted)",
} as const;
