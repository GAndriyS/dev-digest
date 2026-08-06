import type { CSSProperties } from "react";

/** Co-located styles for EvalsTab. */
export const s = {
  wrap: { maxWidth: 980 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 6 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  actions: { marginLeft: "auto", display: "flex", gap: 10 } satisfies CSSProperties,
  hint: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    marginBottom: 18,
  } satisfies CSSProperties,
  notice: {
    marginBottom: 18,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    color: "var(--text-primary)",
    fontSize: 13,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  list: {
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px",
    borderBottom: "1px solid var(--border)",
    fontSize: 13,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  name: { fontWeight: 600, minWidth: 160 } satisfies CSSProperties,
  meta: { color: "var(--text-muted)", fontSize: 12.5, flex: 1, minWidth: 160 } satisfies CSSProperties,
  rowActions: { display: "flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
} as const;
