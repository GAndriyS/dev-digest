/**
 * Region 2 only: `IntentCard` and `BlastTab` side by side while both fit, a
 * single stacked column below that. 420px is the floor at which IntentCard's
 * own in/out-of-scope pair still reads. Region 1 (the Why + Risk Brief) and
 * region 3 (Review Focus) sit outside this grid entirely, each on its own
 * full-width row (SPEC-04 AC-56…AC-58) — this declares exactly two tracks,
 * never three. auto-fit (not auto-fill) collapses the unused track when the
 * two cards stack, so they still split the row evenly instead of hugging the
 * left edge.
 */
export const OVERVIEW_GRID_COLS = "repeat(auto-fit, minmax(420px, 1fr))";
