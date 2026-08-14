/**
 * Two cards side by side while both fit, a single stacked column below that.
 * 420px is the floor at which IntentCard's own in/out-of-scope pair still
 * reads. The page caps this tab at 1440px, which leaves room for a third
 * track — auto-fit (not auto-fill) collapses it, so two cards still split the
 * row evenly instead of hugging the left edge.
 */
export const OVERVIEW_GRID_COLS = "repeat(auto-fit, minmax(420px, 1fr))";
