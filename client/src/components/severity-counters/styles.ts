import type { CSSProperties } from "react";
import { POPOVER_WIDTH } from "./popoverHelpers";

/** Co-located styles for SeverityCounters. */
export const s = {
  wrap: { display: "inline-flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  /** Unstyled button so the vendored SeverityBadge keeps owning the visuals. */
  chip: (interactive: boolean, dimmed: boolean, selected: boolean): CSSProperties => ({
    display: "inline-flex",
    background: "none",
    border: "none",
    padding: 0,
    borderRadius: 5,
    font: "inherit",
    cursor: interactive ? "pointer" : "default",
    opacity: dimmed ? 0.4 : 1,
    outline: selected ? "2px solid var(--accent)" : "none",
    outlineOffset: 1,
    transition: "opacity 120ms ease",
  }),
} as const;

/** Co-located styles for FindingsPopover. Panel chrome mirrors the Dropdown
    panel in `vendor/ui/kit/Dropdown.tsx` so floating surfaces stay consistent;
    `ddpop` is the shared entrance animation from `vendor/ui/styles.css`. */
export const pop = {
  panel: (position: CSSProperties): CSSProperties => ({
    ...position,
    width: POPOVER_WIDTH,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 9,
    boxShadow: "var(--shadow-modal)",
    padding: "12px 14px",
    zIndex: 40,
    animation: "ddpop .12s ease",
    cursor: "default",
    textAlign: "left",
  }),
  header: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 10,
  } satisfies CSSProperties,
  row: (first: boolean): CSSProperties => ({
    display: "flex",
    gap: 10,
    paddingTop: first ? 0 : 11,
    marginTop: first ? 0 : 11,
    borderTop: first ? "none" : "1px solid var(--border)",
  }),
  badgeWrap: { paddingTop: 1, flexShrink: 0 } satisfies CSSProperties,
  rowMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" } satisfies CSSProperties,
  title: (dismissed: boolean): CSSProperties => ({
    fontSize: 13,
    fontWeight: 600,
    color: dismissed ? "var(--text-muted)" : "var(--text-primary)",
    textDecoration: dismissed ? "line-through" : "none",
  }),
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  // A repo path can be several times the card's width, and it has no spaces to
  // break at. `minWidth: 0` lets the flex item shrink at all (items default to
  // `auto`, which is what let the path escape the panel) and `overflowWrap:
  // anywhere` gives the browser permission to break mid-segment, so a long path
  // wraps onto further lines instead of running past the edge.
  file: {
    minWidth: 0,
    fontSize: 13,
    color: "var(--accent)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  rationale: {
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    marginTop: 5,
    // The 2-line clamp the design calls for. Needs all four properties; the
    // rationale is stripped to plain text first (see stripMarkdownInline).
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
    overflow: "hidden",
  } as CSSProperties,
  more: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: 11,
    paddingTop: 11,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  skeletonRow: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 } satisfies CSSProperties,
} as const;
