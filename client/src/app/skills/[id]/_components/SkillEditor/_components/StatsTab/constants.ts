/**
 * Donut colours for finding categories. `category` is a free-form string on the
 * wire, so unknown values cycle through PALETTE instead of vanishing.
 */
export const CATEGORY_COLORS: Record<string, string> = {
  bug: "var(--crit)",
  security: "var(--warn)",
  perf: "var(--accent)",
  style: "var(--sugg)",
  test: "var(--ok)",
};

export const PALETTE: readonly string[] = [
  "var(--accent)",
  "var(--warn)",
  "var(--sugg)",
  "var(--ok)",
  "var(--crit)",
];
