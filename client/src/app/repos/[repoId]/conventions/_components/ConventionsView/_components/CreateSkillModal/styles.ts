import type { CSSProperties } from "react";

/** Co-located styles for CreateSkillModal. */
export const s = {
  error: {
    marginBottom: 16,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    color: "var(--text-primary)",
    fontSize: 13,
  } satisfies CSSProperties,
  banner: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--accent)",
    background: "var(--accent-bg)",
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    marginBottom: 18,
  } satisfies CSSProperties,
  bannerIcon: { color: "var(--accent-text)", flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  row: { display: "flex", gap: 16 } satisfies CSSProperties,
  col: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  toggleRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
} as const;
