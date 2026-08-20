/** Pure helpers for ProjectContextView — no React, no data access. */

import type { SpecFile } from "@devdigest/shared";

/** Case-insensitive match over the repo-relative path. An empty query matches everything. */
export function matchesFilter(file: SpecFile, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return file.path.toLowerCase().includes(q);
}

/** ≈ total tokens across the files actually returned (never `total` — pages past
 *  the truncation cap were never walked, so there is no estimate for them). */
export function sumTokensEst(files: readonly SpecFile[]): number {
  return files.reduce((sum, f) => sum + (f.tokens_est ?? 0), 0);
}

/** `scanned_at` as a locale-formatted timestamp. Falls back to the raw string
 *  on an unparsable value rather than rendering "Invalid Date". */
export function formatScannedAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
