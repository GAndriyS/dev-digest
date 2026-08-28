import type { UnifiedDiff, DiffHunk } from '@devdigest/shared';

/**
 * Minimal unified-diff parser. Extracts per-file hunks and the set of new-side
 * line numbers each hunk covers — exactly what the citation-grounding gate
 * needs (file:line must intersect a real hunk).
 *
 * Handles standard `git diff` output:
 *   diff --git a/path b/path
 *   --- a/path
 *   +++ b/path
 *   @@ -oldStart,oldLines +newStart,newLines @@
 */
export function parseUnifiedDiff(raw: string): UnifiedDiff {
  const files: UnifiedDiff['files'] = [];
  const lines = raw.split('\n');

  let current: UnifiedDiff['files'][number] | null = null;
  let hunk: DiffHunk | null = null;
  let newLineCursor = 0;

  const flushHunk = () => {
    if (current && hunk) current.hunks.push(hunk);
    hunk = null;
  };
  const flushFile = () => {
    flushHunk();
    if (current) files.push(current);
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      flushFile();
      // path resolved from +++ line below; placeholder for now
      current = { path: '', additions: 0, deletions: 0, hunks: [] };
      continue;
    }
    if (line.startsWith('+++ ')) {
      if (!current) current = { path: '', additions: 0, deletions: 0, hunks: [] };
      const p = line.slice(4).replace(/^b\//, '').trim();
      current.path = p === '/dev/null' ? current.path : p;
      continue;
    }
    if (line.startsWith('--- ')) continue;
    const hh = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hh) {
      flushHunk();
      const newStart = Number(hh[3]);
      const newLines = hh[4] ? Number(hh[4]) : 1;
      hunk = {
        file: current?.path ?? '',
        oldStart: Number(hh[1]),
        oldLines: hh[2] ? Number(hh[2]) : 1,
        newStart,
        newLines,
        newLineNumbers: [],
      };
      newLineCursor = newStart;
      continue;
    }
    if (!current || !hunk) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      current.additions++;
      hunk.newLineNumbers.push(newLineCursor);
      newLineCursor++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      current.deletions++;
      // deletion: no new-side line consumed
    } else {
      // context line: advances new-side cursor and counts as covered
      hunk.newLineNumbers.push(newLineCursor);
      newLineCursor++;
    }
  }
  flushFile();

  return { raw, files: files.filter((f) => f.path) };
}

/**
 * A patch fragment already carries its own file header iff it has a `+++ `
 * line — `parseUnifiedDiff` above resolves a file's path from nothing else.
 * `diff --git` alone is not enough: it only opens a file with an empty path,
 * which the final `.filter((f) => f.path)` then discards.
 */
const HAS_FILE_HEADER = /(^|\n)\+\+\+ /;

/**
 * Give a patch fragment the unified-diff file header `parseUnifiedDiff` needs.
 *
 * **The invariant this exists to hold:** GitHub's `pr_files.patch` is hunks
 * only — it starts at `@@` and names no file. `parseUnifiedDiff` resolves a
 * path ONLY from a `+++ ` line, so a headerless fragment parses to
 * `files: []`, and the citation-grounding gate
 * (`reviewer-core/src/grounding.ts`) then drops EVERY finding as
 * "file not present in diff". Anything that persists or replays a
 * `pr_files.patch` must come through here first.
 *
 * Idempotent on purpose: a fragment that already has a header is returned
 * untouched. Prepending unconditionally would emit a second `diff --git`/`+++`
 * pair for the same path, which makes the parser produce two entries for it —
 * one of them hunk-less.
 */
export function ensureDiffFileHeader(path: string, patch: string): string {
  if (HAS_FILE_HEADER.test(patch)) return patch;
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${patch}`;
}

/**
 * Assemble one unified diff from per-file patches, headering each fragment
 * that needs it. This is the shape `reviews/diff-loader.ts#diffFromPrFiles`
 * has always built by hand; sharing it is what keeps a second consumer (the
 * eval runner, which replays a stored `pr_files.patch`) from diverging again.
 */
export function unifiedDiffFromPatches(
  files: readonly { path: string; patch: string | null }[],
): string {
  const parts: string[] = [];
  for (const f of files) {
    if (!f.patch) continue;
    parts.push(ensureDiffFileHeader(f.path, f.patch));
  }
  return parts.join('\n');
}
