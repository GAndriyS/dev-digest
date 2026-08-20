import type { CSSProperties } from "react";
import { HEADER_CONTROL_HEIGHT, LIST_COL_WIDTH } from "./constants";

/** Co-located styles for the Skills Lab master-detail shell. */
export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    height: "calc(100vh - 52px)",
    minHeight: 0,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "20px 32px 16px",
    flexShrink: 0,
  } satisfies CSSProperties,
  h1: { fontSize: 20, fontWeight: 700, flex: 1, letterSpacing: "-0.02em" } satisfies CSSProperties,
  search: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    height: HEADER_CONTROL_HEIGHT,
    padding: "0 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    width: 220,
  } satisfies CSSProperties,
  /** Overrides the Button's own padding-derived height. Spread last by Button. */
  addButton: { height: HEADER_CONTROL_HEIGHT } satisfies CSSProperties,
  searchIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  searchInput: {
    flex: 1,
    fontSize: 13,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  // Row of two independently-scrolling columns. `overflow` lives on each
  // column, not here, so a tall list never drags the editor's scroll with it.
  body: { flex: 1, minHeight: 0, display: "flex" } satisfies CSSProperties,
  listCol: (isNarrow: boolean): CSSProperties => ({
    width: isNarrow ? "100%" : LIST_COL_WIDTH,
    flexShrink: 0,
    minHeight: 0,
    overflowY: "auto",
    borderRight: isNarrow ? "none" : "1px solid var(--border)",
    padding: "4px 20px 24px 24px",
  }),
  detailCol: { flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto" } satisfies CSSProperties,
  backToList: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    margin: "16px 0 0 28px",
    padding: "6px 4px",
    border: "none",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  } satisfies CSSProperties,
} as const;
