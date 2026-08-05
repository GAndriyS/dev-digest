import type { CSSProperties } from "react";
import type { ConventionCandidate } from "@devdigest/shared";

/** Status tints the left edge, so a triaged list is scannable at a glance. */
function edge(status: ConventionCandidate["status"]): string {
  if (status === "accepted") return "var(--ok)";
  if (status === "rejected") return "var(--text-muted)";
  return "var(--accent)";
}

export const s = {
  card: (status: ConventionCandidate["status"]): CSSProperties => ({
    display: "flex",
    gap: 16,
    padding: "14px 16px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${edge(status)}`,
    background: "var(--bg-surface)",
    opacity: status === "rejected" ? 0.55 : 1,
  }),
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  rule: {
    fontSize: 14,
    fontWeight: 600,
    fontStyle: "italic",
    color: "var(--text-primary)",
    lineHeight: 1.4,
  } satisfies CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  snippetWrap: {
    marginTop: 10,
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--code-bg)",
    overflow: "hidden",
  } satisfies CSSProperties,
  snippetHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  snippetPath: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  snippet: {
    margin: 0,
    padding: "10px 12px",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-primary)",
    overflowX: "auto",
    whiteSpace: "pre",
  } satisfies CSSProperties,
  confidenceRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  } satisfies CSSProperties,
  confidenceLabel: {
    fontSize: 12,
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  bar: { width: 130 } satisfies CSSProperties,
  confidenceValue: {
    fontSize: 12,
    color: "var(--text-secondary)",
    minWidth: 34,
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    flexShrink: 0,
    width: 128,
  } satisfies CSSProperties,
  editRow: { display: "flex", gap: 8, marginTop: 10 } satisfies CSSProperties,
} as const;
