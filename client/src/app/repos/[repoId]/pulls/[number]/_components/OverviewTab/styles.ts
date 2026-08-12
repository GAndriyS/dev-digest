import type { CSSProperties } from "react";

export const s = {
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    /* No `whiteSpace: pre-wrap` — that was carrying the line breaks of the raw
       body. Markdown emits real block elements, and pre-wrap would keep the
       newlines *between* them as extra blank space on top of their margins. */
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;
