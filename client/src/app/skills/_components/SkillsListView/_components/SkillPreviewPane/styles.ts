import type { CSSProperties } from "react";

/** Co-located styles for the /skills side preview. */
export const s = {
  wrap: { padding: 18 } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 6,
  } satisfies CSSProperties,
  name: {
    fontSize: 16,
    fontWeight: 700,
    flex: 1,
    minWidth: 0,
    letterSpacing: "-0.01em",
    wordBreak: "break-word",
  } satisfies CSSProperties,
  description: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    marginBottom: 12,
  } satisfies CSSProperties,
  badgeRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  notice: {
    marginTop: 12,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
  noticeBody: {
    marginTop: 6,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  actions: { marginTop: 14 } satisfies CSSProperties,
  h3: { fontSize: 13, fontWeight: 700, marginTop: 20 } satisfies CSSProperties,
  hint: {
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.45,
    margin: "4px 0 10px",
  } satisfies CSSProperties,
  frame: {
    padding: 14,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" } satisfies CSSProperties,
} as const;
