import type { CSSProperties } from "react";

/** Co-located styles for EvalOverview. */
export const s = {
  wrap: {
    maxWidth: 1160,
    margin: "0 auto",
    padding: "28px 28px 60px",
    display: "flex",
    flexDirection: "column",
    gap: 32,
  } satisfies CSSProperties,
  h1: { fontSize: 20, fontWeight: 700 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, marginTop: 4 } satisfies CSSProperties,
  h2: { fontSize: 15, fontWeight: 700, marginBottom: 14 } satisfies CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: 14,
  } satisfies CSSProperties,
  cardLink: { textDecoration: "none", color: "inherit", display: "block" } satisfies CSSProperties,
  card: { display: "flex", flexDirection: "column", gap: 10, minHeight: 118 } satisfies CSSProperties,
  cardHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } satisfies CSSProperties,
  cardName: {
    fontSize: 14,
    fontWeight: 700,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  cardMeta: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  cardMetrics: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  cardPass: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
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
  link: { color: "var(--accent)", textDecoration: "none", fontWeight: 600 } satisfies CSSProperties,
  erroredBadge: { marginLeft: 8 } satisfies CSSProperties,
} as const;
