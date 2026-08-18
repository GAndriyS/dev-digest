import type { CSSProperties } from "react";

/** Co-located styles for ImportSkillDrawer. */
export const s = {
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
  error: {
    marginBottom: 16,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    color: "var(--text-primary)",
    fontSize: 13,
  } satisfies CSSProperties,
  filePicker: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  // The native control renders an unstyleable button that reads as body text in
  // this theme, so the Button beside it is the affordance. Kept in the DOM and
  // visually hidden rather than `display: none` — it stays reachable by its
  // label, which is how both assistive tech and the drawer's tests find it.
  fileInput: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
  } satisfies CSSProperties,
  fileName: { fontSize: 13, color: "var(--text-primary)", minWidth: 0 } satisfies CSSProperties,
  fileNamePlaceholder: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  status: { fontSize: 13, color: "var(--text-muted)", marginBottom: 16 } satisfies CSSProperties,
  result: { borderTop: "1px solid var(--border)", paddingTop: 18 } satisfies CSSProperties,
  resultHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  } satisfies CSSProperties,
  h3: { fontSize: 15, fontWeight: 700, flex: 1, minWidth: 0 } satisfies CSSProperties,
  unsavedNote: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    padding: "8px 12px",
    borderRadius: 7,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    margin: "8px 0 18px",
  } satisfies CSSProperties,
  h4: { fontSize: 13, fontWeight: 700, marginTop: 4 } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)", margin: "4px 0 10px" } satisfies CSSProperties,
  frame: {
    padding: 14,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    fontSize: 13,
    color: "var(--text-secondary)",
    maxHeight: 320,
    overflow: "auto",
  } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" } satisfies CSSProperties,
  skipped: {
    marginTop: 20,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  skippedList: {
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    margin: "10px 0",
  } satisfies CSSProperties,
  skippedItem: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  skippedNote: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
