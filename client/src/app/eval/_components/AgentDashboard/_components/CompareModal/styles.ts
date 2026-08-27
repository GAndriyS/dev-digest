import type { CSSProperties } from "react";
import { DIFF_COLORS } from "./constants";
import type { DiffKind } from "./helpers";

/** Co-located styles for CompareModal. */
export const s = {
  section: { marginBottom: 22 } satisfies CSSProperties,
  h3: { fontSize: 14, fontWeight: 700, marginBottom: 10 } satisfies CSSProperties,
  /* Four cards in one row. `minmax(0, 1fr)` rather than `1fr` so a long cost
     string shrinks its own card instead of overflowing the grid. */
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 12,
  } satisfies CSSProperties,
  card: {
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  cardLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  cardValues: { display: "flex", alignItems: "baseline", gap: 7 } satisfies CSSProperties,
  cardBefore: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  cardArrow: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  cardAfter: (color: string): CSSProperties => ({ fontSize: 21, fontWeight: 700, color }),
  legend: {
    display: "flex",
    gap: 16,
    alignItems: "center",
    marginBottom: 8,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  legendSwatch: (color: string): CSSProperties => ({
    width: 9,
    height: 9,
    borderRadius: 2,
    background: color,
    flexShrink: 0,
  }),
  headingRow: { display: "flex", alignItems: "center", gap: 7, marginBottom: 10 } satisfies CSSProperties,
  microHeading: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 } satisfies CSSProperties,
  diff: {
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    overflow: "auto",
    maxHeight: 340,
    fontSize: 12.5,
    lineHeight: 1.55,
  } satisfies CSSProperties,
  diffRow: (kind: DiffKind): CSSProperties => ({
    display: "flex",
    gap: 10,
    padding: "0 12px",
    background: DIFF_COLORS[kind].bg,
    color: kind === "context" ? "var(--text-secondary)" : "var(--text-primary)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  }),
  sign: (kind: DiffKind): CSSProperties => ({
    width: 10,
    flexShrink: 0,
    color: DIFF_COLORS[kind].fg,
    fontWeight: 700,
  }),
  footer: { display: "flex", justifyContent: "flex-end" } satisfies CSSProperties,
} as const;
