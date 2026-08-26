import { MAX_DIFF_LINES, NO_VALUE } from "./constants";

export type DiffKind = "add" | "del" | "context";

export interface DiffRow {
  kind: DiffKind;
  text: string;
}

/**
 * Line diff over the longest common subsequence — a system prompt is
 * untrusted, free-form text, rendered below as escaped React text nodes
 * only (never markup, never `dangerouslySetInnerHTML`; plan step 13,
 * Untrusted inputs). There is no diff library in this package, and one
 * line-level LCS is not worth a dependency the plan did not call for.
 * Mirrors `diffLines` in the skill editor's VersionsTab helpers (same
 * repo, different route tree — copied, not imported, per
 * `frontend-ui-architecture`'s route-tree boundary).
 */
export function diffLines(before: string, after: string): DiffRow[] {
  const all = before.split("\n");
  const bll = after.split("\n");

  let head = 0;
  while (head < all.length && head < bll.length && all[head] === bll[head]) head++;
  let tail = 0;
  while (
    tail < all.length - head &&
    tail < bll.length - head &&
    all[all.length - 1 - tail] === bll[bll.length - 1 - tail]
  ) {
    tail++;
  }

  const a = all.slice(head, all.length - tail);
  const b = bll.slice(head, bll.length - tail);

  const headRows: DiffRow[] = all.slice(0, head).map((text) => ({ kind: "context" as const, text }));
  const tailRows: DiffRow[] = all.slice(all.length - tail).map((text) => ({ kind: "context" as const, text }));

  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return [...headRows, ...wholesale(a, b), ...tailRows];
  }

  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const lcs = new Int32Array((n + 1) * width);
  const at = (i: number, j: number): number => lcs[i * width + j] ?? 0;

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ kind: "context", text: a[i] ?? "" });
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      rows.push({ kind: "del", text: a[i] ?? "" });
      i++;
    } else {
      rows.push({ kind: "add", text: b[j] ?? "" });
      j++;
    }
  }
  while (i < n) rows.push({ kind: "del", text: a[i++] ?? "" });
  while (j < m) rows.push({ kind: "add", text: b[j++] ?? "" });
  return [...headRows, ...rows, ...tailRows];
}

function wholesale(a: string[], b: string[]): DiffRow[] {
  return [
    ...a.map((text) => ({ kind: "del" as const, text })),
    ...b.map((text) => ({ kind: "add" as const, text })),
  ];
}

/**
 * A metric delta (fraction) formatted as a SIGNED percentage point for
 * `dashboard.delta` ("{value} pt") — same rule as
 * `AgentDashboard/helpers.ts` `formatDeltaPt`, duplicated locally (co-located
 * per component, matching this codebase's existing convention, e.g.
 * `EvalsTab`'s local `pct`).
 */
export function formatDeltaPt(fraction: number): string {
  const pt = Math.round(fraction * 1000) / 10;
  if (pt === 0) return "0.0";
  const sign = pt > 0 ? "+" : "-";
  return `${sign}${Math.abs(pt).toFixed(1)}`;
}

/** USD cost delta, 4 decimals, signed. Either side `null` (no cost recorded)
    renders as an em dash — the null-metric rule applies to cost too. */
export function formatCostDelta(before: number | null, after: number | null): string {
  if (before == null || after == null) return NO_VALUE;
  const delta = after - before;
  if (delta === 0) return "$0.0000";
  const sign = delta > 0 ? "+" : "-";
  return `${sign}$${Math.abs(delta).toFixed(4)}`;
}
