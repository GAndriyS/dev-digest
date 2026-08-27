import { describe, it, expect } from 'vitest';
import { BREAKING_PR_FILES } from '../src/db/seed.js';
import {
  parseUnifiedDiff,
  ensureDiffFileHeader,
  unifiedDiffFromPatches,
} from '../src/adapters/git/diff-parser.js';

/**
 * Pins the bug that made agent eval scoring inert, and the helper that fixes it.
 *
 * GitHub's `pr_files.patch` is hunks only — it starts at `@@` and names no
 * file. `parseUnifiedDiff` resolves a path ONLY from a `+++ ` line, so a
 * headerless fragment parses to `files: []`, and `groundFindings` then drops
 * every finding as "file not present in diff". The review path had always
 * reconstructed the header inline; the eval-case path did not, so a
 * `must_not_flag` case passed no matter what the agent did and a `must_find`
 * case could never pass (12 runs, 8 findings emitted, 0 grounded).
 */

const PATH = 'src/api/public/webhooks.ts';

/** What GitHub actually returns: hunks, no file header. Header and body agree —
    3 old lines, 4 new (3 context + 1 addition). */
const HUNKS_ONLY = [
  '@@ -14,3 +14,4 @@',
  ' const a = 1;',
  '+const b = 2;',
  ' const c = 3;',
  ' const d = 4;',
].join('\n');

describe('the headerless-patch bug', () => {
  it('parses a hunks-only patch to NO files — this is what broke grounding', () => {
    const diff = parseUnifiedDiff(HUNKS_ONLY);
    // Not "a file with no hunks" — no file at all. `filesInDiff` in the
    // grounding gate is therefore empty, and its first check drops every
    // finding before line numbers are ever considered.
    expect(diff.files).toEqual([]);
  });
});

describe('ensureDiffFileHeader', () => {
  it('makes a hunks-only patch parseable, with the path and the new-side lines intact', () => {
    const diff = parseUnifiedDiff(ensureDiffFileHeader(PATH, HUNKS_ONLY));

    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]!.path).toBe(PATH);
    // The hunk band the grounding gate matches findings against.
    expect(diff.files[0]!.hunks.flatMap((h) => [...h.newLineNumbers])).toEqual([14, 15, 16, 17]);
  });

  it('leaves an already-headered fragment byte-identical, and is idempotent', () => {
    const headered = `diff --git a/${PATH} b/${PATH}\n--- a/${PATH}\n+++ b/${PATH}\n${HUNKS_ONLY}`;

    // Idempotence is load-bearing, not a nicety: an unconditional prepend
    // would emit a SECOND `diff --git`/`+++` pair for the same path, which
    // makes the parser produce two entries for it — one of them hunk-less.
    expect(ensureDiffFileHeader(PATH, headered)).toBe(headered);

    const once = ensureDiffFileHeader(PATH, HUNKS_ONLY);
    expect(ensureDiffFileHeader(PATH, once)).toBe(once);
    expect(parseUnifiedDiff(once).files).toHaveLength(1);
  });

  it('treats a `+++` line as the header marker, even without `diff --git`', () => {
    // `diff --git` alone opens a file with an empty path, which the parser's
    // own `.filter((f) => f.path)` then discards — so it is not a header.
    const gitLineOnly = `diff --git a/${PATH} b/${PATH}\n${HUNKS_ONLY}`;
    expect(parseUnifiedDiff(gitLineOnly).files).toEqual([]);
    expect(ensureDiffFileHeader(PATH, gitLineOnly)).not.toBe(gitLineOnly);
  });
});

describe('unifiedDiffFromPatches', () => {
  it('reproduces the old inline reconstruction byte-for-byte', () => {
    // This is the regression proof for rewiring `diffFromPrFiles`: the string
    // it feeds `parseUnifiedDiff` must not change for any existing data.
    const inline: string[] = [];
    for (const f of BREAKING_PR_FILES) {
      inline.push(`diff --git a/${f.path} b/${f.path}`);
      inline.push(`--- a/${f.path}`);
      inline.push(`+++ b/${f.path}`);
      inline.push(f.patch);
    }

    expect(unifiedDiffFromPatches(BREAKING_PR_FILES)).toBe(inline.join('\n'));
  });

  it('skips files with no patch text', () => {
    // Seeded PR #482's rows have no patch — server/INSIGHTS.md.
    const files = [
      { path: 'a.ts', patch: null },
      { path: 'b.ts', patch: HUNKS_ONLY },
      { path: 'c.ts', patch: '' },
    ];
    const diff = parseUnifiedDiff(unifiedDiffFromPatches(files));
    expect(diff.files.map((f) => f.path)).toEqual(['b.ts']);
  });
});
