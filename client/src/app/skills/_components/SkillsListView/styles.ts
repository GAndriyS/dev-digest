import type { CSSProperties } from "react";

/** Co-located styles for the SkillsListView left-column list. */
export const s = {
  wrap: { paddingTop: 12 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
} as const;
