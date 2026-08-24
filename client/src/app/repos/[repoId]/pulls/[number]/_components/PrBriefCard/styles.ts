import type { CSSProperties } from "react";

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 18,
  } satisfies CSSProperties,
  topRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  scoreWrap: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  scoreLabel: {
    display: "block",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  scoreMuted: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  blockLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,
  blockText: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--text-primary)",
    whiteSpace: "pre-wrap",
  } satisfies CSSProperties,
  risksList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  riskItem: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    fontSize: 13,
    lineHeight: 1.45,
  } satisfies CSSProperties,
  riskTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  riskTitle: {
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  riskExplanation: {
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  error: {
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    color: "var(--crit)",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
  } satisfies CSSProperties,
} as const;
