import type { CSSProperties } from "react";

/** Co-located styles for EvalCaseModal. */
export const s = {
  body: { padding: 24 } satisfies CSSProperties,
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
  columns: { display: "flex", gap: 14 } satisfies CSSProperties,
  column: { flex: 1 } satisfies CSSProperties,
} as const;
