import type { CSSProperties } from "react";
import { DIFF_COLORS } from "./constants";
import type { DiffKind } from "./helpers";

/** Co-located styles for VersionsTab. */
export const s = {
  wrap: { maxWidth: 980, display: "flex", flexDirection: "column", gap: 24 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700, marginBottom: 6 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 } satisfies CSSProperties,
  section: {
    padding: 20,
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  h3: { fontSize: 14, fontWeight: 700, marginBottom: 14 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 0",
    borderTop: "1px solid var(--border)",
    fontSize: 13,
  } satisfies CSSProperties,
  rowDate: { flex: 1, color: "var(--text-secondary)" } satisfies CSSProperties,
  rowChars: { color: "var(--text-muted)", fontSize: 12 } satisfies CSSProperties,
  pickers: { display: "flex", gap: 14, alignItems: "flex-end", marginBottom: 16 } satisfies CSSProperties,
  picker: { flex: 1, maxWidth: 220 } satisfies CSSProperties,
  pickerLabel: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 8,
  } satisfies CSSProperties,
  summary: { fontSize: 12, color: "var(--text-muted)", marginBottom: 10 } satisfies CSSProperties,
  diff: {
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    overflow: "auto",
    maxHeight: 460,
    fontSize: 12.5,
    lineHeight: 1.55,
  } satisfies CSSProperties,
  diffRow: (kind: DiffKind): CSSProperties => ({
    display: "flex",
    gap: 12,
    padding: "0 12px",
    background: DIFF_COLORS[kind].bg,
    color: kind === "context" ? "var(--text-secondary)" : "var(--text-primary)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  }),
  gutter: {
    width: 56,
    flexShrink: 0,
    textAlign: "right",
    color: "var(--text-muted)",
    userSelect: "none",
  } satisfies CSSProperties,
  sign: (kind: DiffKind): CSSProperties => ({
    width: 10,
    flexShrink: 0,
    color: DIFF_COLORS[kind].fg,
    fontWeight: 700,
  }),
  muted: { fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 } satisfies CSSProperties,
} as const;
