import type { CSSProperties } from "react";

export const s = {
  count: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  focusList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  focusRowBase: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "8px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg)",
    fontSize: 13,
    textAlign: "left",
  } satisfies CSSProperties,
  focusRowInteractive: {
    color: "var(--text-primary)",
    cursor: "pointer",
  } satisfies CSSProperties,
  focusRowStatic: {
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  focusIcon: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  focusPath: {
    fontWeight: 600,
    flexShrink: 0,
  } satisfies CSSProperties,
  focusReason: {
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
  } satisfies CSSProperties,
  focusArrow: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  muted: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
