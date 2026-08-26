import type { CSSProperties } from "react";

/** Co-located styles for EvalCaseModal. */
export const s = {
  body: { padding: 24 } satisfies CSSProperties,
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
  error: {
    marginBottom: 16,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    color: "var(--text-primary)",
    fontSize: 13,
  } satisfies CSSProperties,
  validBadge: { fontSize: 12, fontWeight: 600, color: "var(--ok)" } satisfies CSSProperties,
  invalidBadge: { fontSize: 12, fontWeight: 600, color: "var(--crit)" } satisfies CSSProperties,
} as const;
