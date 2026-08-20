/**
 * Below this width the shell collapses to one column (AC-26): the left list OR
 * the right editor, never both, with an explicit way back to the list. Matches
 * the query `useMediaQuery`'s own tests exercise.
 */
export const NARROW_QUERY = "(max-width: 1023px)";

/**
 * One height for every control in the header row. The search box and the Add
 * Skill button are sized from this rather than from their own padding, so
 * they stay level instead of matching only by coincidence.
 */
export const HEADER_CONTROL_HEIGHT = 34;

/** Width of the left (list) column once the viewport is wide enough for both. */
export const LIST_COL_WIDTH = 340;

/** Which "add" flow is open, if any. */
export type AddFlow = "create" | "import";
