import type { CSSProperties } from "react";

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
  toggle: {
    display: "flex",
    gap: 4,
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
