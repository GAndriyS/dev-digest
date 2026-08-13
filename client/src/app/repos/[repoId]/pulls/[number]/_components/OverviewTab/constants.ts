/**
 * Two cards side by side while both fit, a single stacked column below that.
 * 420px is the floor at which IntentCard's own in/out-of-scope pair still
 * reads; under the page's 1080px max-width this yields exactly two columns.
 */
export const OVERVIEW_GRID_COLS = "repeat(auto-fit, minmax(420px, 1fr))";
