import type { CSSProperties } from "react";

export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
  skeletonWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  banner: {
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    borderRadius: 8,
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  bannerTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--warn)",
  } satisfies CSSProperties,
  bannerBody: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  splitList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  splitItem: {
    display: "flex",
    gap: 8,
    fontSize: 12.5,
    alignItems: "baseline",
  } satisfies CSSProperties,
  splitName: {
    fontWeight: 600,
    color: "var(--text-primary)",
    flexShrink: 0,
  } satisfies CSSProperties,
  splitFiles: {
    color: "var(--text-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  group: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    cursor: "pointer",
  } satisfies CSSProperties,
  groupHeaderStatic: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
  } satisfies CSSProperties,
  groupHeaderText: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    minWidth: 0,
  } satisfies CSSProperties,
  groupLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  groupDesc: {
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  groupMeta: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginLeft: "auto",
    flexShrink: 0,
  } satisfies CSSProperties,
  groupBody: {
    borderTop: "1px solid var(--border)",
    padding: 10,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
} as const;

/** Chevron rotates 90deg when the role group is open (matches diff-viewer's own). */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}

/** Small coloured square marking a role group's header — colour carries the
    role (`ROLE_MARKER_COLOR`), not a data value, so it's a style function
    rather than a static entry in `s`. */
export function groupMarker(color: string): CSSProperties {
  return {
    width: 8,
    height: 8,
    borderRadius: 2,
    background: color,
    flexShrink: 0,
  };
}
