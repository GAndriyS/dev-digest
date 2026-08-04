/**
 * Above this many lines on either side the LCS table (O(n·m) cells) stops being
 * worth it; skill bodies are prose, so this is a guard rail, not a limit anyone
 * should hit. Beyond it the diff degrades to "everything replaced".
 */
export const MAX_DIFF_LINES = 1500;

/** Row background per diff kind — the only place the add/del colours are named. */
export const DIFF_COLORS = {
  add: { bg: "var(--ok-bg, rgba(34,197,94,0.12))", fg: "var(--ok)", sign: "+" },
  del: { bg: "var(--crit-bg, rgba(239,68,68,0.12))", fg: "var(--crit)", sign: "−" },
  context: { bg: "transparent", fg: "var(--text-secondary)", sign: " " },
} as const;
