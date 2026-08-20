/** Local toggle state for DiffTab's "Smart order / Original order" switch.
    Not URL-backed on purpose (Decision 8 of the L03 Smart Diff v2 plan): the
    diff tab's ranking is a display preference, not shareable state. */
export type DiffView = "smart" | "original";

export const DEFAULT_DIFF_VIEW: DiffView = "smart";

/** Segment order on screen, left to right. Typed as a pair, not an array: the
    highlight slides between exactly two positions, and the tuple is what lets
    the flip read an element without a `noUncheckedIndexedAccess` guard for an
    index that cannot be out of bounds. Reordering it moves the pill too. */
export const DIFF_VIEWS: readonly [DiffView, DiffView] = ["smart", "original"];

/** Any arrow moves to the other segment — with exactly two options "next" and
    "previous" are the same hop, so the radiogroup pattern collapses to a flip. */
export const SEGMENT_ARROW_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];

/** Frames the `?file=` scroll-to-target loop will chase a still-settling
    layout before giving up — same value and same reason as FindingsPanel's
    own constant of the same name (`client/INSIGHTS.md`): a `scrollIntoView`
    fired once lands short because the target `FileCard` (and any neighbours
    above it) are still expanding for several frames after mount. ~0.5s at
    60fps. Duplicated rather than imported: DiffTab and FindingsPanel are
    independent siblings, and the pattern — not the constant — is what's
    shared. */
export const SCROLL_SETTLE_MAX_FRAMES = 30;
