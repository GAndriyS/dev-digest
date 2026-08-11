import type { CSSProperties } from "react";

/** Colours come from the severity tokens so the card follows the light theme
    too; the 30% border is `color-mix` over the same token rather than a second
    hardcoded colour, so a token change moves the outline with the fill. */
function tone(token: string) {
  return {
    color: `var(--${token})`,
    background: `var(--${token}-bg)`,
    border: `1px solid color-mix(in srgb, var(--${token}) 30%, transparent)`,
  };
}

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
  staleRow: {
    display: "flex",
  } satisfies CSSProperties,
  summary: {
    margin: 0,
    padding: 0,
    fontSize: 15,
    fontStyle: "italic",
    color: "var(--text-primary)",
    lineHeight: 1.55,
  } satisfies CSSProperties,
  quote: {
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  columns: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 28,
  } satisfies CSSProperties,
  colHead: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    marginBottom: 10,
  } satisfies CSSProperties,
  colHeadIn: {
    color: "var(--ok)",
  } satisfies CSSProperties,
  colHeadOut: {
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  list: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 7,
    fontSize: 13,
  } satisfies CSSProperties,
  item: {
    display: "flex",
    gap: 9,
    lineHeight: 1.45,
  } satisfies CSSProperties,
  bullet: {
    flexShrink: 0,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /* In-scope is what the PR claims to do, so it reads at full contrast;
     out-of-scope is context and stays recessive. */
  itemIn: {
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  itemOut: {
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /* Inline-Markdown marks. Both derive from `currentColor` rather than naming a
     token, so a code span stays bright in the in-scope column, recessive in
     out-of-scope, and tinted inside a risk chip — one rule, three contexts,
     and it follows the light theme for free. */
  code: {
    fontSize: "0.92em",
    padding: "1px 5px",
    borderRadius: 4,
    background: "color-mix(in srgb, currentColor 12%, transparent)",
    color: "inherit",
  } satisfies CSSProperties,
  strong: {
    fontWeight: 650,
    color: "inherit",
  } satisfies CSSProperties,
  link: {
    color: "inherit",
    textDecoration: "underline",
  } satisfies CSSProperties,
  divider: {
    height: 1,
    border: "none",
    margin: 0,
    background: "var(--border)",
  } satisfies CSSProperties,
  riskHead: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 10,
  } satisfies CSSProperties,
  muted: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  badgeRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  } satisfies CSSProperties,
  riskChip: {
    padding: "5px 11px",
    borderRadius: 7,
    fontWeight: 500,
    whiteSpace: "normal",
  } satisfies CSSProperties,
  riskCrit: tone("crit"),
  riskWarn: tone("warn"),
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 10,
    paddingTop: 14,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  sources: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  sourceUnavailable: {
    color: "var(--text-muted)",
    textDecoration: "line-through",
    textDecorationColor: "var(--border-strong)",
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
