import type { CSSProperties } from "react";
import { OVERVIEW_GRID_COLS } from "./constants";

export const s = {
  // Outer container: one full-width column, three siblings in render order
  // (region 1 → region 2 → region 3, SPEC-04 AC-56, AC-69). No `order`, no
  // `grid-template-areas` — visual order is DOM order.
  container: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
  } satisfies CSSProperties,
  // Region 2 only: IntentCard + BlastTab. The auto-fit grid lives here and
  // nowhere else — region 1 and region 3 are full-width outside it.
  pairGrid: {
    display: "grid",
    gridTemplateColumns: OVERVIEW_GRID_COLS,
    gap: 24,
    // The two cards load independently and Blast's skeleton/degraded states
    // render without a card box — start-aligned so neither column stretches
    // to the other's height.
    alignItems: "start",
  } satisfies CSSProperties,
} as const;
