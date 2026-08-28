import type { CSSProperties } from "react";
import type { DeltaDirection } from "./helpers";

const DELTA_COLOR: Record<DeltaDirection, string> = {
  up: "var(--ok)",
  down: "var(--crit)",
  flat: "var(--text-muted)",
};

/** Co-located styles for AgentDashboard. */
export const s = {
  wrap: {
    maxWidth: 1160,
    margin: "0 auto",
    padding: "28px 28px 60px",
    display: "flex",
    flexDirection: "column",
    gap: 28,
  } satisfies CSSProperties,
  h1: { fontSize: 20, fontWeight: 700 } satisfies CSSProperties,
  h2: { fontSize: 15, fontWeight: 700, marginBottom: 14 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 } satisfies CSSProperties,

  banner: {
    display: "flex",
    gap: 12,
    padding: "14px 16px",
    borderRadius: 9,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
  } satisfies CSSProperties,
  bannerIcon: { color: "var(--crit)", flexShrink: 0, marginTop: 2 } satisfies CSSProperties,
  bannerTitle: { fontSize: 14, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  bannerBody: { fontSize: 13, color: "var(--text-secondary)", marginTop: 2 } satisfies CSSProperties,
  bannerOthers: {
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  metricsRow: { display: "flex", gap: 14 } satisfies CSSProperties,
  metricCard: {
    flex: 1,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: 18,
  } satisfies CSSProperties,
  metricLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.03em",
  } satisfies CSSProperties,
  metricValue: { fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 10 } satisfies CSSProperties,
  metricDelta: (direction: DeltaDirection): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    marginTop: 8,
    fontSize: 13,
    fontWeight: 600,
    color: DELTA_COLOR[direction],
  }),

  chartSection: {
    padding: 20,
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  legend: { display: "flex", gap: 16, marginBottom: 12, fontSize: 12.5 } satisfies CSSProperties,
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  legendDot: (color: string): CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: 99,
    background: color,
    display: "inline-block",
  }),

  tableSection: {
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  tableHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 18px 0",
  } satisfies CSSProperties,
  tableHeading: { fontSize: 15, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  selectHint: { fontSize: 12.5, color: "var(--text-muted)", padding: "6px 18px 0" } satisfies CSSProperties,
  tableWrap: { overflow: "auto", marginTop: 14 } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 } satisfies CSSProperties,
  th: {
    textAlign: "left",
    padding: "10px 14px",
    fontSize: 11.5,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.03em",
    borderBottom: "1px solid var(--border)",
    borderTop: "1px solid var(--border)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  td: {
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  erroredBadge: { marginLeft: 8 } satisfies CSSProperties,
} as const;
