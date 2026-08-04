import type { CSSProperties } from "react";
import { CONTENT_HEIGHT, RAIL_WIDTH } from "./constants";

/** Co-located styles for the SkillsListView master/detail shell. */
export const s = {
  split: { display: "flex", height: CONTENT_HEIGHT } satisfies CSSProperties,
  rail: {
    width: RAIL_WIDTH,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    background: "var(--bg-surface)",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  } satisfies CSSProperties,
  railHeader: { padding: "16px 16px 12px" } satisfies CSSProperties,
  railTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  } satisfies CSSProperties,
  h1: { fontSize: 18, fontWeight: 700, flex: 1, letterSpacing: "-0.02em" } satisfies CSSProperties,
  search: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
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
  railBody: { flex: 1, overflow: "auto", padding: "0 12px 16px", minHeight: 0 } satisfies CSSProperties,
  skeletons: { display: "flex", flexDirection: "column", gap: 10, padding: "4px 0" } satisfies CSSProperties,
  pane: { flex: 1, display: "grid", placeItems: "center", minWidth: 0 } satisfies CSSProperties,
} as const;
