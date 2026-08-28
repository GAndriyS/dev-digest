import { describe, it, expect } from 'vitest';
import { BREAKING_PR_FILES } from '../src/db/seed.js';
import { parseUnifiedDiff, unifiedDiffFromPatches } from '../src/adapters/git/diff-parser.js';

/**
 * Pins the PR #483 fixture — the Skills Lab control experiment's diff.
 *
 * The field the grounding gate actually depends on is the `@@` NEW-SIDE START:
 * `parseUnifiedDiff` numbers the hunk from it, and `groundFindings` keeps a
 * finding only if its line falls in that band. Shift the start by one and every
 * finding is dropped for citing lines "outside the hunk" — silently, because
 * the diff still parses and the review still runs. The experiment would then
 * read as "the skills changed nothing" when in fact the fixture was broken.
 *
 * So the start is pinned by asserting the EXACT line set, and by tying specific
 * numbers to the content that must be on them. The header counts are checked
 * separately, for diff fidelity rather than for grounding — a wrong `newLines`
 * would not drop anything, since the parser populates the line array itself.
 */

/** Rebuild the diff exactly as `diffFromPrFiles` does before parsing — through
    the same shared helper it uses, so this fixture cannot drift from it. */
function parseFixture() {
  return parseUnifiedDiff(unifiedDiffFromPatches(BREAKING_PR_FILES));
}

/** Count what a hunk body actually contains, independent of its header. */
function bodyCounts(hunk: string) {
  const [, ...body] = hunk.split('\n');
  let context = 0;
  let removed = 0;
  let added = 0;
  for (const line of body) {
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
    else context++;
  }
  return { context, removed, added };
}

/** Split a patch into hunks — the fixture is one per file today, not by rule. */
function hunksOf(patch: string): string[] {
  return patch
    .split(/\n(?=@@)/)
    .map((h) => h.trim())
    .filter(Boolean);
}

/**
 * Walk a hunk body and return new-side line number → line content, so an
 * assertion can say "line 25 is the callback_url line" instead of trusting the
 * header. Removed lines do not exist on the new side and are skipped.
 */
function newSideLines(hunk: string): Map<number, string> {
  const lines = hunk.split('\n');
  const start = Number(lines[0]!.match(/\+(\d+)/)![1]);
  const out = new Map<number, string>();
  let n = start;
  for (const line of lines.slice(1)) {
    if (line.startsWith('-')) continue;
    out.set(n++, line.slice(1));
  }
  return out;
}

describe('PR #483 fixture', () => {
  it('parses into the three changed files', () => {
    const diff = parseFixture();
    expect(diff.files.map((f) => f.path)).toEqual([
      'src/api/public/webhooks.ts',
      'src/api/public/types.ts',
      'package.json',
    ]);
  });

  it.each(BREAKING_PR_FILES.map((f) => [f.path, f.patch] as const))(
    '%s: every @@ header agrees with its hunk body',
    (_path, patch) => {
      const hunks = hunksOf(patch);
      expect(hunks.length).toBeGreaterThan(0);
      for (const hunk of hunks) {
        const header = hunk.split('\n')[0]!;
        // The counts are optional in unified diff — git omits them for a
        // single-line range — so do not demand them.
        const m = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        expect(m, `unparsable hunk header: ${header}`).not.toBeNull();
        const oldCount = m![2] === undefined ? 1 : Number(m![2]);
        const newCount = m![4] === undefined ? 1 : Number(m![4]);
        const { context, removed, added } = bodyCounts(hunk);
        expect(oldCount, `old count in ${header}`).toBe(context + removed);
        expect(newCount, `new count in ${header}`).toBe(context + added);
      }
    },
  );

  it('numbers the new side exactly — an off-by-one start would fail here', () => {
    const diff = parseFixture();
    const linesOf = (path: string) => {
      const file = diff.files.find((f) => f.path === path)!;
      return file.hunks.flatMap((h) => [...h.newLineNumbers]).sort((a, b) => a - b);
    };

    // The WHOLE set, not membership: `toContain` on a contiguous band passes
    // for any start within the band's width, which is exactly the corruption
    // this test exists to catch.
    expect(linesOf('src/api/public/webhooks.ts')).toEqual(
      Array.from({ length: 13 }, (_, i) => 14 + i),
    );
    expect(linesOf('src/api/public/types.ts')).toEqual([3, 4, 5, 6]);
    expect(linesOf('package.json')).toEqual([1, 2, 3, 4, 5]);
  });

  it('puts the breaking changes on the lines a finding would cite', () => {
    const byPath = new Map(BREAKING_PR_FILES.map((f) => [f.path, f.patch]));
    const at = (path: string) => newSideLines(hunksOf(byPath.get(path)!)[0]!);

    // Tie number to content, so a shifted hunk cannot satisfy this by accident.
    const webhooks = at('src/api/public/webhooks.ts');
    expect(webhooks.get(18)).toContain('secret: z.string(),');
    expect(webhooks.get(19)).toContain('events: z.array');
    expect(webhooks.get(24)).toContain('reply.status(204)');
    expect(webhooks.get(25)).toContain('callback_url');

    const types = at('src/api/public/types.ts');
    expect(types.get(4)).toContain('callback_url');
    expect(types.get(5)).toContain('enabled');

    expect(at('package.json').get(3)).toContain('"version": "2.5.0"');
  });

  it('states additions/deletions that match the hunk bodies', () => {
    let totalAdded = 0;
    let totalRemoved = 0;
    for (const f of BREAKING_PR_FILES) {
      const counts = hunksOf(f.patch).map(bodyCounts);
      const added = counts.reduce((n, c) => n + c.added, 0);
      const removed = counts.reduce((n, c) => n + c.removed, 0);
      expect(f.additions, `${f.path} additions`).toBe(added);
      expect(f.deletions, `${f.path} deletions`).toBe(removed);
      totalAdded += added;
      totalRemoved += removed;
    }
    // The PR row's own totals are hand-written in seed.ts; keep them honest.
    expect(totalAdded, 'PR additions total').toBe(7);
    expect(totalRemoved, 'PR deletions total').toBe(7);
  });
});
