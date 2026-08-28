import type { CSSProperties } from "react";

/** Co-located styles for EvalOverview. The AGENTS section is now a stack of
    full-width `AgentRow`s (own styles live in that folder) rather than a card
    grid, so the old `grid`/`card*` keys are gone — this file only carries the
    page chrome: header row, the Run all agents affordances, and the recent-
    batches table (AC-8, AC-27, AC-36, AC-43…AC-52). */
export const s = {
  wrap: {
    maxWidth: 1160,
    margin: "0 auto",
    padding: "28px 28px 60px",
    display: "flex",
    flexDirection: "column",
    gap: 24,
  } satisfies CSSProperties,
  h1: { fontSize: 20, fontWeight: 700 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, marginTop: 4 } satisfies CSSProperties,
  h2: { fontSize: 15, fontWeight: 700, marginBottom: 14 } satisfies CSSProperties,

  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  } satisfies CSSProperties,
  headerActions: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 6,
    flexShrink: 0,
  } satisfies CSSProperties,
  /** Textual disabled reason (AC-50, AC-52) — rendered as a real text node
      next to the button, never only a `title` attribute (NFR Доступність). */
  disabledReason: {
    fontSize: 12,
    color: "var(--text-muted)",
    textAlign: "right",
    maxWidth: 260,
    lineHeight: 1.4,
  } satisfies CSSProperties,

  /** Per-agent failure list (AC-51) — a compact block under the header row,
      cleared as soon as the next run starts (the page hides it while
      `isRunning`, see EvalOverview.tsx). */
  failureList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    margin: 0,
    padding: "10px 12px",
    listStyle: "none",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  failureItem: { fontSize: 12.5, color: "var(--warn)" } satisfies CSSProperties,

  rows: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,

  tableWrap: {
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    overflow: "auto",
  } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 } satisfies CSSProperties,
  th: {
    textAlign: "left",
    padding: "10px 14px",
    fontSize: 11.5,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.03em",
    borderBottom: "1px solid var(--border)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  td: {
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  /** Pass cell only — `X/Y pass` renders bold (AC-27, AC-45). */
  tdBold: {
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
    whiteSpace: "nowrap",
    fontWeight: 700,
  } satisfies CSSProperties,
  link: { color: "var(--accent)", textDecoration: "none", fontWeight: 600 } satisfies CSSProperties,
  erroredBadge: { marginLeft: 8 } satisfies CSSProperties,

  /** Horizontal bar + number for recall/precision/citation table cells
      (AC-44) — the number always renders, the bar is additive. */
  metricCell: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  metricBar: { width: 56 } satisfies CSSProperties,
  metricValue: { minWidth: 34, textAlign: "right" } satisfies CSSProperties,
} as const;
