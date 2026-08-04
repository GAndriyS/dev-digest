import { MAX_DIFF_LINES } from "./constants";

export type DiffKind = "add" | "del" | "context";

export interface DiffRow {
  kind: DiffKind;
  text: string;
  /** 1-based line number in the "before" body, null on an added line. */
  leftNo: number | null;
  /** 1-based line number in the "after" body, null on a removed line. */
  rightNo: number | null;
}

/**
 * Line diff over the longest common subsequence. There is no diff library in
 * this package and one line-level LCS is not worth a dependency: the table is
 * (n+1)·(m+1) ints held flat, walked once to emit rows in document order.
 */
export function diffLines(before: string, after: string): DiffRow[] {
  const all = before.split("\n");
  const bll = after.split("\n");

  // Peel the identical head and tail first. The LCS table is the only expensive
  // part and it is O(n·m) in BOTH time and memory — at the 1500-line guard that
  // is 2.25M cells, ~9 MB. Editing one line of a long body is the normal case
  // here, and after peeling it leaves a table of a few cells instead. Every
  // peeled line is emitted as context, so the rendered diff is identical.
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

  const headRows: DiffRow[] = all
    .slice(0, head)
    .map((text, k) => ({ kind: "context" as const, text, leftNo: k + 1, rightNo: k + 1 }));
  const tailRows: DiffRow[] = all.slice(all.length - tail).map((text, k) => ({
    kind: "context" as const,
    text,
    leftNo: all.length - tail + k + 1,
    rightNo: bll.length - tail + k + 1,
  }));

  // The guard now applies to the DIFFERING middle, which is what actually costs.
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return [...headRows, ...wholesale(a, b, head), ...tailRows];
  }

  const n = a.length;
  const m = b.length;
  const width = m + 1;
  // lcs[i][j] = length of the LCS of a[i..] and b[j..], filled from the end.
  const lcs = new Int32Array((n + 1) * width);
  const at = (i: number, j: number): number => lcs[i * width + j] ?? 0;

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  // Numbering continues past the peeled head on both sides.
  let left = head;
  let right = head;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ kind: "context", text: a[i] ?? "", leftNo: ++left, rightNo: ++right });
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      rows.push({ kind: "del", text: a[i] ?? "", leftNo: ++left, rightNo: null });
      i++;
    } else {
      rows.push({ kind: "add", text: b[j] ?? "", leftNo: null, rightNo: ++right });
      j++;
    }
  }
  while (i < n) rows.push({ kind: "del", text: a[i++] ?? "", leftNo: ++left, rightNo: null });
  while (j < m) rows.push({ kind: "add", text: b[j++] ?? "", leftNo: null, rightNo: ++right });
  return [...headRows, ...rows, ...tailRows];
}

/**
 * Degenerate diff for a middle too large to align: drop all, add all.
 * `offset` is the number of identical lines already emitted as context, so the
 * line numbers stay true to the whole body.
 */
function wholesale(a: string[], b: string[], offset = 0): DiffRow[] {
  return [
    ...a.map((text, k) => ({ kind: "del" as const, text, leftNo: k + 1, rightNo: null })),
    ...b.map((text, k) => ({ kind: "add" as const, text, leftNo: null, rightNo: k + 1 })),
  ];
}

export interface DiffCounts {
  added: number;
  removed: number;
}

export function countChanges(rows: DiffRow[]): DiffCounts {
  return {
    added: rows.filter((r) => r.kind === "add").length,
    removed: rows.filter((r) => r.kind === "del").length,
  };
}

/** Single-locale app (see src/i18n/request.ts) — the formatter is a constant. */
const DATE_FORMAT = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

export function formatVersionDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE_FORMAT.format(date);
}
