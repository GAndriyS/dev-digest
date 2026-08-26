import type { CSSProperties } from "react";
import { DIFF_COLORS } from "./constants";
import type { DiffKind } from "./helpers";

/** Co-located styles for CompareModal. */
export const s = {
  section: { marginBottom: 22 } satisfies CSSProperties,
  h3: { fontSize: 14, fontWeight: 700, marginBottom: 10 } satisfies CSSProperties,
  metricGrid: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    borderRadius: 8,
    border: "1px solid var(--border)",
    padding: "4px 14px",
  } satisfies CSSProperties,
  metricRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 0",
    borderBottom: "1px solid var(--border)",
    fontSize: 13,
  } satisfies CSSProperties,
  metricRowLast: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 0",
    fontSize: 13,
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
