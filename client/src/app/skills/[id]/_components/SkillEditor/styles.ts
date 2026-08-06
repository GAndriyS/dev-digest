import type { CSSProperties } from "react";

/** Co-located styles for the SkillEditor tab shell. */
export const s = {
  wrap: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  } satisfies CSSProperties,
  tabsBar: { marginTop: 14, flexShrink: 0 } satisfies CSSProperties,
  body: { flex: 1, overflow: "auto", padding: 28, minHeight: 0 } satisfies CSSProperties,
} as const;
