import type { CSSProperties } from "react";

/** Co-located styles for ContextDocPicker and its row. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "baseline", gap: 12 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  count: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  hint: { fontSize: 13, lineHeight: 1.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8, listStyle: "none", padding: 0, margin: 0 } satisfies CSSProperties,
  section: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  loading: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  footer: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  // Drop target feedback: the row being dragged dims, the row under the cursor
  // gets an accent top edge so the insertion point is unambiguous.
  row: (attached: boolean, dragging: boolean, dropTarget: boolean): CSSProperties => ({
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid " + (attached ? "var(--border-strong)" : "var(--border)"),
    background: attached ? "var(--bg-elevated)" : "transparent",
    opacity: dragging ? 0.45 : 1,
    boxShadow: dropTarget ? "inset 0 2px 0 0 var(--accent)" : "none",
    transition: "opacity .12s, box-shadow .12s",
  }),
  rowMain: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  grip: (draggable: boolean): CSSProperties => ({
    display: "inline-flex",
    color: "var(--text-muted)",
    cursor: draggable ? "grab" : "default",
    visibility: draggable ? "visible" : "hidden",
    flexShrink: 0,
  }),
  position: {
    minWidth: 18,
    fontSize: 12,
    fontWeight: 700,
    color: "var(--text-muted)",
    textAlign: "right",
    flexShrink: 0,
  } satisfies CSSProperties,
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  path: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  controls: { display: "flex", alignItems: "center", gap: 2, flexShrink: 0 } satisfies CSSProperties,
  // IconBtn has no disabled prop (vendored — not ours to patch), so a boundary
  // arrow is neutralised here instead: no pointer events, visibly inert.
  arrow: (enabled: boolean): CSSProperties => ({
    display: "inline-flex",
    opacity: enabled ? 1 : 0.3,
    pointerEvents: enabled ? "auto" : "none",
  }),
  previewWrap: {
    marginTop: 10,
    marginLeft: 24,
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 13,
    maxHeight: 260,
    overflow: "auto",
  } satisfies CSSProperties,
  previewError: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
