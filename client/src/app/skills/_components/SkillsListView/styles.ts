import type { CSSProperties } from "react";
import { CARD_GRID_COLS, PANE_MAX_HEIGHT, PANE_WIDTH } from "./constants";

/** Co-located styles for the SkillsListView grid + side preview. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1360, margin: "0 auto" } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    marginBottom: 20,
  } satisfies CSSProperties,
  h1: {
    fontSize: 24,
    fontWeight: 700,
    flex: 1,
    letterSpacing: "-0.02em",
  } satisfies CSSProperties,
  search: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    width: 220,
  } satisfies CSSProperties,
  searchIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  searchInput: {
    flex: 1,
    fontSize: 13,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  // The pane sits beside the grid rather than over it: the grid keeps its
  // scroll position while a selection is inspected.
  split: { display: "flex", alignItems: "flex-start", gap: 20 } satisfies CSSProperties,
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  grid: { display: "grid", gridTemplateColumns: CARD_GRID_COLS, gap: 14 } satisfies CSSProperties,
  pane: {
    width: PANE_WIDTH,
    flexShrink: 0,
    position: "sticky",
    top: 20,
    maxHeight: PANE_MAX_HEIGHT,
    overflow: "auto",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
} as const;
