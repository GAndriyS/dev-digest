import type { CSSProperties } from "react";

/** Co-located styles for the skill ConfigTab. */
export const s = {
  wrap: { maxWidth: 820 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 20 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  enabledLabel: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 12, marginTop: 10 } satisfies CSSProperties,
  dirtyNote: { fontSize: 13, color: "var(--warn)", fontWeight: 600 } satisfies CSSProperties,
  bodyMeta: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  tokenCount: { fontSize: 12, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" } satisfies CSSProperties,
} as const;
