import type { CSSProperties } from "react";

/** Co-located styles for the SkillDetailView shell (header + editor). */
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
    gap: 12,
    padding: "16px 28px 0",
    flexShrink: 0,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  icon: { color: "var(--accent)" } satisfies CSSProperties,
  h1: { fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  spacer: { marginLeft: "auto" } satisfies CSSProperties,
  notice: {
    margin: "14px 28px 0",
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    color: "var(--text-primary)",
    fontSize: 13,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  loading: {
    padding: 28,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,
} as const;
