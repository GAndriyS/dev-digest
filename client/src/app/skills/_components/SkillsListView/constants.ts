/**
 * Responsive card grid. Same auto-fill shape as the /agents list so the two
 * halves of the Skills Lab read as one product rather than two screens.
 */
export const CARD_GRID_COLS = "repeat(auto-fill, minmax(260px, 1fr))";

/**
 * One height for every control in the header row. The search box and the
 * Add Skill button are sized from this rather than from their own padding, so
 * they stay level instead of matching only by coincidence — the box would
 * otherwise take its height from the input's inherited line-height.
 */
export const HEADER_CONTROL_HEIGHT = 34;

/** Width of the preview pane beside the grid. */
export const PANE_WIDTH = 380;

/** The pane sticks below the 52px topbar and scrolls on its own. */
export const PANE_MAX_HEIGHT = "calc(100vh - 96px)";
