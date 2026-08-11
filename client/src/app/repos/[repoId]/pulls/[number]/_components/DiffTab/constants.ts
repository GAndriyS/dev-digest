/** Local toggle state for DiffTab's "Smart order / Original order" switch.
    Not URL-backed on purpose (Decision 8 of the L03 Smart Diff v2 plan): the
    diff tab's ranking is a display preference, not shareable state. */
export type DiffView = "smart" | "original";

export const DEFAULT_DIFF_VIEW: DiffView = "smart";
