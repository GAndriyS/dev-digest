import type { CSSProperties } from "react";

/** Co-located styles for EvalCaseModal. */
export const s = {
  body: { padding: 24 } satisfies CSSProperties,
  footer: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  footerRow: { display: "flex", alignItems: "center", gap: 12, justifyContent: "flex-end" } satisfies CSSProperties,
  error: {
    marginBottom: 16,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    color: "var(--text-primary)",
    fontSize: 13,
  } satisfies CSSProperties,
  validBadge: { fontSize: 12, fontWeight: 600, color: "var(--ok)" } satisfies CSSProperties,
  invalidBadge: { fontSize: 12, fontWeight: 600, color: "var(--crit)" } satisfies CSSProperties,

  // ---- Kind banner (AC-60/61/62) — colour additive only, the words carry
  // the meaning: `positive`/`negative` only change the accent, never the copy. ----
  bannerPositive: {
    marginBottom: 20,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--accent)",
    background: "var(--accent-bg)",
  } satisfies CSSProperties,
  bannerNegative: {
    marginBottom: 20,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
  bannerTitle: { fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", marginBottom: 6 } satisfies CSSProperties,
  bannerLine: { fontSize: 13, lineHeight: 1.5 } satisfies CSSProperties,

  // ---- Stored-kind vs expected-output mismatch (AC-58) ----
  mismatch: {
    marginBottom: 16,
    fontSize: 12.5,
    color: "var(--warn)",
  } satisfies CSSProperties,

  // ---- Actual output panel (AC-65/AC-66/AC-69) ----
  actualOutput: {
    marginTop: 4,
    marginBottom: 4,
    padding: 14,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  actualOutputTitle: { fontSize: 13, fontWeight: 700, marginBottom: 8 } satisfies CSSProperties,
  neverRun: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  runFailed: { fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
  passLabel: { fontSize: 13, fontWeight: 600, color: "var(--ok)", marginBottom: 4 } satisfies CSSProperties,
  failLabel: { fontSize: 13, fontWeight: 600, color: "var(--crit)", marginBottom: 4 } satisfies CSSProperties,
  resultSummary: { fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 8 } satisfies CSSProperties,
  findingsList: { margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  findingItem: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,

  // ---- Run controls (AC-63/64/67/68) ----
  runControls: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  toggleWrap: { display: "inline-flex", alignItems: "center" } satisfies CSSProperties,
  toggleLabel: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  disabledReason: {
    padding: "8px 12px",
    borderRadius: 7,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    color: "var(--text-primary)",
    fontSize: 12.5,
  } satisfies CSSProperties,
} as const;
