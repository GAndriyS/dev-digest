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
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) return wholesale(a, b);

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
  let left = 0;
  let right = 0;
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
  return rows;
}

/** Degenerate diff for bodies too large to align: drop all, add all. */
function wholesale(a: string[], b: string[]): DiffRow[] {
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
