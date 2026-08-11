import type { CSSProperties } from "react";
import type { Severity } from "@/lib/types";
import type { Line } from "./helpers";

/** Colour tokens per contract `Severity` — CRITICAL/WARNING/SUGGESTION only
    (never the UI kit's, which adds an `INFO` the API can't produce; see
    client/INSIGHTS.md). Single source for the row stripe, the per-line
    annotation chips, and the header badge, so all three agree. */
const SEVERITY_TOKEN: Record<Severity, { color: string; bg: string }> = {
  CRITICAL: { color: "var(--crit)", bg: "var(--crit-bg)" },
  WARNING: { color: "var(--warn)", bg: "var(--warn-bg)" },
  SUGGESTION: { color: "var(--sugg)", bg: "var(--sugg-bg)" },
};

/** Co-located styles for the DiffViewer (extracted from inline styles). */
export const s = {
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  empty: { padding: "24px", fontSize: 14, color: "var(--text-muted)", textAlign: "center" } satisfies CSSProperties,
  fileCard: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  fileHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
  } satisfies CSSProperties,
  /** Amber tint added to `fileHeader` when a file's changed-line count
      exceeds `AUTO_EXPAND_MAX_LINES` (Smart Diff v2, item 3). */
  fileHeaderLarge: {
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
  fileIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  filePath: {
    fontSize: 13,
    fontWeight: 500,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  fileStat: { fontSize: 12 } satisfies CSSProperties,
  addText: { color: "var(--code-add-text)" } satisfies CSSProperties,
  delText: { color: "var(--code-del-text)" } satisfies CSSProperties,
  fileBody: {
    borderTop: "1px solid var(--border)",
    padding: "8px 0",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  noDiff: {
    padding: "14px 18px",
    fontSize: 13,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,
  hunk: {
    fontSize: 12,
    lineHeight: "20px",
    color: "var(--accent-text)",
    background: "var(--accent-bg)",
    padding: "0 14px",
  } satisfies CSSProperties,
  lineNo: {
    width: 44,
    textAlign: "right",
    padding: "0 10px 0 0",
    color: "var(--text-muted)",
    userSelect: "none",
    flexShrink: 0,
  } satisfies CSSProperties,
  lineText: {
    flex: 1,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
    paddingRight: 12,
  } satisfies CSSProperties,
  /** Fourth flex cell holding a line's annotation chip(s) — `flexShrink: 0`
      so it never competes with `lineText`'s wrap. */
  annotationsCell: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    paddingRight: 10,
  } satisfies CSSProperties,
  /** Static "large · N lines" chip in a FileCard header (Smart Diff v2,
      item 3) — not clickable, unlike `findingBadgeFor`. */
  largeChip: {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 600,
    color: "var(--warn)",
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
} as const;

/** Clickable finding-count badge in a FileCard header (Smart Diff), coloured
    by the highest-severity finding it summarises. */
export function findingBadgeFor(severity: Severity): CSSProperties {
  const tok = SEVERITY_TOKEN[severity];
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 8px",
    borderRadius: 5,
    fontSize: 12,
    fontWeight: 600,
    color: tok.color,
    background: tok.bg,
    cursor: "pointer",
    userSelect: "none",
  };
}

/** One clickable annotation chip inside `CodeLine`'s fourth span — severity
    icon + i18n label, coloured by that annotation's own severity. */
export function annotationChip(severity: Severity): CSSProperties {
  const tok = SEVERITY_TOKEN[severity];
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "1px 6px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    lineHeight: "16px",
    whiteSpace: "nowrap",
    color: tok.color,
    background: tok.bg,
    border: "none",
    cursor: "pointer",
  };
}

/** Chevron rotates 90deg when the file card is open. */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}

/** Row background per line kind (add/del tinted, others transparent); a line
    carrying an annotation is tinted and striped by that annotation's own
    severity instead — `boxShadow: inset` rather than `borderLeft` so the
    stripe never shifts layout or fights the row's other shorthand rules. When
    a line has multiple annotations, pass the highest-priority one (callers
    pre-sort CRITICAL → WARNING → SUGGESTION — see `FileCard`'s
    `annotationsByLine`). */
export function lineRowFor(kind: Line["kind"], severity?: Severity): CSSProperties {
  if (severity) {
    const tok = SEVERITY_TOKEN[severity];
    return {
      display: "flex",
      alignItems: "stretch",
      fontSize: 13,
      lineHeight: "20px",
      background: tok.bg,
      boxShadow: `inset 3px 0 0 ${tok.color}`,
    };
  }
  const background = kind === "add" ? "var(--code-add)" : kind === "del" ? "var(--code-del)" : "transparent";
  return { display: "flex", alignItems: "stretch", fontSize: 13, lineHeight: "20px", background };
}

/** Gutter sign colour per line kind. */
export function lineSignFor(kind: Line["kind"]): CSSProperties {
  return {
    width: 14,
    textAlign: "center",
    color: kind === "add" ? "var(--code-add-text)" : kind === "del" ? "var(--code-del-text)" : "var(--text-muted)",
    flexShrink: 0,
  };
}
