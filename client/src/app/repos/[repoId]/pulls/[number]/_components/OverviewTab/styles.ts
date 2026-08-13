import type { CSSProperties } from "react";
import { OVERVIEW_GRID_COLS } from "./constants";

export const s = {
  grid: {
    display: "grid",
    gridTemplateColumns: OVERVIEW_GRID_COLS,
    gap: 24,
    // The two cards load independently and Blast's skeleton/degraded states
    // render without a card box — start-aligned so neither column stretches
    // to the other's height.
    alignItems: "start",
  } satisfies CSSProperties,
} as const;
