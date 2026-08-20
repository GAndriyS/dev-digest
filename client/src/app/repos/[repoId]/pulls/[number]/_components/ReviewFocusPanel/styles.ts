import type { CSSProperties } from "react";

export const s = {
  count: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  focusList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  focusRowBase: {
    display: "flex",
    // Top-aligned, not centred: `focusReason` wraps to as many lines as the
    // text needs (see below), and a centred row would float the icon, path
    // and arrow to the middle of that block instead of the first line.
    alignItems: "flex-start",
    gap: 8,
    lineHeight: 1.45,
    width: "100%",
    padding: "8px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg)",
    fontSize: 13,
    textAlign: "left",
  } satisfies CSSProperties,
  focusRowInteractive: {
    color: "var(--text-primary)",
    cursor: "pointer",
  } satisfies CSSProperties,
  focusRowStatic: {
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  focusIcon: {
    color: "var(--text-muted)",
    flexShrink: 0,
    // Nudged onto the first text line now that the row is top-aligned.
    marginTop: 3,
  } satisfies CSSProperties,
  focusPath: {
    fontWeight: 600,
    flexShrink: 0,
  } satisfies CSSProperties,
  // The reason is the sentence that tells the reviewer WHY this file is worth
  // reading first — truncating it hides exactly the part that earns the row
  // its place, so it wraps over as many lines as it needs and is never cut
  // (SPEC-04 edge case "довгий шлях або пояснення"). `minWidth: 0` keeps the
  // flex item from refusing to wrap at its content width.
  focusReason: {
    color: "var(--text-secondary)",
    flex: 1,
    minWidth: 0,
    whiteSpace: "normal",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  focusArrow: {
    color: "var(--text-muted)",
    flexShrink: 0,
    marginTop: 3,
  } satisfies CSSProperties,
  muted: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
