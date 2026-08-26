/** Colour per case outcome — paired with translated text everywhere it is
    used (never colour alone, NFR Доступність): the badge always renders the
    status word too, not just the dot. */
export const OUTCOME_COLORS = {
  passed: "var(--ok)",
  failed: "var(--crit)",
  errored: "var(--warn)",
  never: "var(--text-muted)",
} as const;

/** Locale-neutral placeholder for a metric the API reported as `null`
    (e.g. `citation_accuracy` when a run produced zero raw findings) — never
    "0%", which would read as a real, bad result. */
export const NO_VALUE = "—";
