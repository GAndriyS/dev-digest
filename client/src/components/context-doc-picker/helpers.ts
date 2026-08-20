/** Pure helpers for ContextDocPicker — no React, no data access. */

import type { SpecFile } from "@devdigest/shared";

/** Move the item at `from` to `to`, returning a new array. Out-of-range is a no-op. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to) return [...items];
  if (from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items];
  const next = [...items];
  // Spread the removed slice back in rather than indexing it — under
  // noUncheckedIndexedAccess `next.splice(...)[0]` is `T | undefined`.
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** Case-insensitive match over the repo-relative path. An empty query matches everything. */
export function matchesFilter(path: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return path.toLowerCase().includes(q);
}

/** One row of the "attached" list. `file` is `null` for a path attached earlier
 *  but no longer present in the listing (deleted from the repo, or outside the
 *  truncated page) — rendered as a "missing" row rather than dropped, so it
 *  stays visible and removable. */
export interface AttachedRow {
  path: string;
  file: SpecFile | null;
}

/**
 * Split the listing into rows attached to this owner (in prompt order) and the
 * rest (in listing order). Unlike a linked-skill hole, an attached path with no
 * matching file is NOT dropped — see `AttachedRow`.
 */
export function partitionFiles(
  files: readonly SpecFile[],
  attachedPaths: readonly string[],
): { attached: AttachedRow[]; available: SpecFile[] } {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const attachedSet = new Set(attachedPaths);
  return {
    attached: attachedPaths.map((p) => ({ path: p, file: byPath.get(p) ?? null })),
    available: files.filter((f) => !attachedSet.has(f.path)),
  };
}

/**
 * ≈ total tokens across the attached set, deduplicated (a path can only appear
 * once in practice, but a stale draft during a race must not double-count) and
 * read from the listing's own size-based estimates — never re-derived here, so
 * this number always matches the badge on the Project Context page.
 */
export function totalTokensEst(files: readonly SpecFile[], attachedPaths: readonly string[]): number {
  const byPath = new Map(files.map((f) => [f.path, f.tokens_est ?? 0]));
  const seen = new Set<string>();
  let total = 0;
  for (const p of attachedPaths) {
    if (seen.has(p)) continue;
    seen.add(p);
    total += byPath.get(p) ?? 0;
  }
  return total;
}
