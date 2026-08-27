import { DELTA_ARROW, MAX_DIFF_LINES } from "./constants";

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

export type DeltaTone = "good" | "bad" | "neutral";

export interface DeltaBadge {
  tone: DeltaTone;
  /** `null` on a neutral delta — nothing moved, so nothing points anywhere. */
  arrow: string | null;
  /** Unsigned magnitude; the arrow carries the direction. */
  text: string;
}

/**
 * The delta badge for one card: how far the metric moved, and whether that
 * was an improvement.
 *
 * Two rules worth stating, because both are easy to get wrong:
 *
 * 1. **Tone is direction-of-improvement, never sign.** `higherIsBetter` comes
 *    from `COMPARE_METRICS`, and it is `false` for cost — a rise there is a
 *    regression. Colouring by sign would paint the worst outcome green.
 * 2. **Tone and arrow derive from the ROUNDED, PRINTED magnitude**, not the
 *    raw float. `0.9 - 0.8` is `0.09999999999999998`, and a delta of `1e-16`
 *    would otherwise render as "▲ 0.0" — an arrow and a tone insisting on a
 *    direction the number next to them denies.
 *
 * Returns `null` when the delta cannot be computed at all (either side of the
 * comparison is `null`), so the caller omits the badge rather than inventing
 * a zero (AC-78).
 */
export function deltaBadge(
  before: number | null | undefined,
  after: number | null | undefined,
  higherIsBetter: boolean,
  unit: "pt" | "usd",
): DeltaBadge | null {
  if (before == null || after == null) return null;

  const raw = after - before;
  // Round FIRST, then decide — see rule 2 above.
  const magnitude = unit === "pt" ? Math.round(raw * 1000) / 10 : Math.round(raw * 10000) / 10000;
  const text = unit === "pt" ? Math.abs(magnitude).toFixed(1) : `$${Math.abs(magnitude).toFixed(4)}`;

  if (magnitude === 0) return { tone: "neutral", arrow: null, text };

  const rose = magnitude > 0;
  const improved = rose === higherIsBetter;
  return {
    tone: improved ? "good" : "bad",
    arrow: rose ? DELTA_ARROW.good : DELTA_ARROW.bad,
    text,
  };
}
