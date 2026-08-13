import type { CSSProperties } from "react";

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,

  // ---- stats row ----
  stats: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 18,
    paddingBottom: 14,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  stat: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  statNum: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  // ---- banners ----
  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 8,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    border: "1px solid color-mix(in srgb, var(--warn) 30%, transparent)",
  } satisfies CSSProperties,
  error: {
    padding: "10px 12px",
    borderRadius: 8,
    fontSize: 12.5,
    color: "var(--critical)",
    background: "var(--critical-bg)",
    border: "1px solid color-mix(in srgb, var(--critical) 30%, transparent)",
  } satisfies CSSProperties,

  // ---- summary paragraph ----
  summary: {
    margin: 0,
    fontSize: 13.5,
    lineHeight: 1.6,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  // ---- symbol tree ----
  tree: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  symbolRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-subtle)",
    cursor: "pointer",
    textAlign: "left",
    font: "inherit",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  symbolName: {
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    fontWeight: 600,
  } satisfies CSSProperties,
  symbolKind: {
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  callerCount: {
    marginLeft: "auto",
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  branch: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    margin: "6px 0 4px 14px",
    paddingLeft: 14,
    borderLeft: "1px solid var(--border)",
  } satisfies CSSProperties,
  callerRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
  } satisfies CSSProperties,
  callerName: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  arrow: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  chips: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  } satisfies CSSProperties,
  noDownstream: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
} as const;
