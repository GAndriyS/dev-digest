import type { CSSProperties } from "react";

/** Co-located styles for StatsTab. */
export const s = {
  wrap: { maxWidth: 980, display: "flex", flexDirection: "column", gap: 24 } satisfies CSSProperties,
  cards: { display: "flex", gap: 14, flexWrap: "wrap" } satisfies CSSProperties,
  section: {
    padding: 20,
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  h3: { fontSize: 14, fontWeight: 700, marginBottom: 14 } satisfies CSSProperties,
  agentRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 0",
    borderTop: "1px solid var(--border)",
    fontSize: 13,
  } satisfies CSSProperties,
  agentName: { fontWeight: 600, flex: 1, minWidth: 0 } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 } satisfies CSSProperties,
  note: {
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.5,
    marginTop: 14,
  } satisfies CSSProperties,
  skeletons: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
} as const;
