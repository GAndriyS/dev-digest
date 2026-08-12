import type { CSSProperties } from "react";

/** Gap between the pill's border and its highlight, in px. Used three times in
    one geometry (the pill's padding, the highlight's offset and its size), so
    it is a constant rather than the same literal written out three times. */
const ORDER_THUMB_INSET = 3;

export const s = {
  header: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginBottom: 14,
  } satisfies CSSProperties,
  headerTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  headerLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  headerIcon: {
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  headerLabelText: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  /* The segmented pill. Grid, not flex: two `1fr` columns come out equal at the
     widest label, whereas flex items over a zero basis keep their own text
     widths inside a shrink-to-fit container — which left the highlight 6px
     wider than the segment it sat on. Equal columns are what make the 50%
     highlight below exact. The 3px padding is the highlight's inset, so
     ORDER_THUMB_INSET moves the two together. */
  order: {
    position: "relative",
    display: "inline-grid",
    gridTemplateColumns: "repeat(2, 1fr)", // one per DIFF_VIEWS entry — a pair
    alignItems: "center",
    padding: ORDER_THUMB_INSET,
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  /* The sliding highlight. Width is half the padding box minus the inset, i.e.
     exactly one segment, so `translateX(100%)` lands it on the other one — the
     slide needs no measured pixel value and survives a longer translation. */
  orderThumb: {
    position: "absolute",
    top: ORDER_THUMB_INSET,
    left: ORDER_THUMB_INSET,
    width: `calc(50% - ${ORDER_THUMB_INSET}px)`,
    height: `calc(100% - ${ORDER_THUMB_INSET * 2}px)`,
    borderRadius: 7,
    background: "var(--bg-elevated)",
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.28)",
    transform: "translateX(0)",
    transition: "transform 0.18s ease",
    pointerEvents: "none",
  } satisfies CSSProperties,
  orderThumbEnd: {
    transform: "translateX(100%)",
  } satisfies CSSProperties,
  /* `position: relative` lifts the label above the highlight, which is painted
     first; the grid column already gives it its width. */
  orderSegment: {
    position: "relative",
    appearance: "none",
    border: "none",
    background: "transparent",
    padding: "5px 14px",
    borderRadius: 7,
    fontSize: 12.5,
    fontWeight: 500,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
    cursor: "pointer",
    transition: "color 0.18s ease",
  } satisfies CSSProperties,
  orderSegmentOn: {
    color: "var(--text-primary)",
    fontWeight: 600,
  } satisfies CSSProperties,
  headerStats: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    gap: 4,
  } satisfies CSSProperties,
  addText: {
    color: "var(--code-add-text)",
  } satisfies CSSProperties,
  delText: {
    color: "var(--code-del-text)",
  } satisfies CSSProperties,
} as const;
