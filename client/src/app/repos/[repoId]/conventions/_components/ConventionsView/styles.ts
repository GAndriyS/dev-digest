import type { CSSProperties } from "react";

/** Co-located styles for the conventions list page. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1100, margin: "0 auto" } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 14,
    marginBottom: 18,
  } satisfies CSSProperties,
  headerMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  repoName: { color: "var(--accent-text)" } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginTop: 6,
    maxWidth: 640,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  } satisfies CSSProperties,
  count: { fontSize: 13, color: "var(--text-secondary)", flex: 1 } satisfies CSSProperties,
  scanSummary: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginBottom: 14,
  } satisfies CSSProperties,
  dropped: { color: "var(--warn)" } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  error: {
    marginBottom: 16,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    color: "var(--text-primary)",
    fontSize: 13,
  } satisfies CSSProperties,

} as const;
