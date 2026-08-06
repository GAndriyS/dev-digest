import { describe, it, expect } from 'vitest';
import { EXPERIMENT_PRS } from '../scripts/seed-l02-experiment.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';

/**
 * Pins the L02 experiment fixtures (PRs 901 and 902), for the same reason
 * `seed-diff.test.ts` pins PR #483 — and because these two had gone wrong
 * exactly the way that file warns about.
 *
 * `parseUnifiedDiff` numbers each hunk from the `@@` NEW-SIDE START, and
 * `groundFindings` keeps a finding only when its line falls in the band the
 * PARSER computed. A header whose counts disagree with its body therefore lets
 * a model cite a line the parser never produced: the finding is dropped, the
 * review still "succeeds", and the A/B experiment reads as "the skill changed
 * nothing" when the fixture was simply broken.
 *
 * Both defects this file now guards were real:
 * - 901 claimed `@@ -1,6 +1,20 @@` over a body of 5 old and 14 new lines, and
 *   its old side omitted the function's closing brace, so the implied original
 *   file did not compile.
 * - 902 claimed `-12,17 +12,17` over a body of 12 old and 11 new lines.
 */

const byNumber = (n: number) => EXPERIMENT_PRS.find((p) => p.number === n)!;

/** Rebuild one PR's diff exactly as `diffFromPrFiles` does before parsing. */
function parsePr(number: number) {
  const parts: string[] = [];
  for (const f of byNumber(number).files) {
    parts.push(`diff --git a/${f.path} b/${f.path}`);
    parts.push(`--- a/${f.path}`);
    parts.push(`+++ b/${f.path}`);
    parts.push(f.patch);
  }
  return parseUnifiedDiff(parts.join('\n'));
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

function hunksOf(patch: string): string[] {
  return patch
    .split(/\n(?=@@)/)
    .map((h) => h.trim())
    .filter(Boolean);
}

const allFiles = EXPERIMENT_PRS.flatMap((p) =>
  p.files.map((f) => [p.number, f.path, f.patch] as const),
);

describe('L02 experiment fixtures', () => {
  it.each(allFiles)('PR %i · %s: every @@ header agrees with its hunk body', (_n, _path, patch) => {
    const hunks = hunksOf(patch);
    expect(hunks.length).toBeGreaterThan(0);
    for (const hunk of hunks) {
      const header = hunk.split('\n')[0]!;
      const m = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      expect(m, `unparsable hunk header: ${header}`).not.toBeNull();
      const oldCount = m![2] === undefined ? 1 : Number(m![2]);
      const newCount = m![4] === undefined ? 1 : Number(m![4]);
      const { context, removed, added } = bodyCounts(hunk);
      expect(oldCount, `old count in ${header}`).toBe(context + removed);
      expect(newCount, `new count in ${header}`).toBe(context + added);
    }
  });

  it.each(allFiles)('PR %i · %s: the stored counts match the patch', (_n, _path, patch) => {
    const file = EXPERIMENT_PRS.flatMap((p) => p.files).find((f) => f.patch === patch)!;
    let added = 0;
    let removed = 0;
    for (const hunk of hunksOf(patch)) {
      const c = bodyCounts(hunk);
      added += c.added;
      removed += c.removed;
    }
    // The PR list renders these, so a lie here is visible in the UI even when
    // the diff itself parses cleanly.
    expect(file.additions, 'additions').toBe(added);
    expect(file.deletions, 'deletions').toBe(removed);
  });

  it('numbers PR 901 exactly — an off-by-one start would fail here', () => {
    const diff = parsePr(901);
    const linesOf = (path: string) =>
      diff.files
        .find((f) => f.path === path)!
        .hunks.flatMap((h) => [...h.newLineNumbers])
        .sort((a, b) => a - b);

    // The WHOLE set, not membership: `toContain` over a contiguous band passes
    // for any start within the band's width.
    expect(linesOf('src/lib/coupon.ts')).toEqual(Array.from({ length: 14 }, (_, i) => 1 + i));
    expect(linesOf('src/lib/coupon.test.ts')).toEqual(Array.from({ length: 18 }, (_, i) => 1 + i));
  });

  it('numbers PR 902 exactly', () => {
    const diff = parsePr(902);
    const lines = diff.files[0]!.hunks.flatMap((h) => [...h.newLineNumbers]).sort((a, b) => a - b);
    expect(lines).toEqual(Array.from({ length: 11 }, (_, i) => 12 + i));
  });

  it('puts each planted defect on a line a finding would cite', () => {
    // Ties numbers to content: a shifted header moves these and fails.
    const coupon = newSideLines(hunksOf(byNumber(901).files[0]!.patch)[0]!);
    expect(coupon.get(5)).toContain('throw new CouponExpiredError');
    expect(coupon.get(13)).toContain('export class CouponExpiredError');

    const test = newSideLines(hunksOf(byNumber(901).files[1]!.patch)[0]!);
    // The assertion that re-states its own mock — what the test-quality skill
    // must flag, and the whole reason this PR exists.
    expect(test.get(16)).toContain('toHaveBeenCalled');

    const invoices = newSideLines(hunksOf(byNumber(902).files[0]!.patch)[0]!);
    expect(invoices.get(13)).toContain("'/invoices/:invoiceId'"); // path param renamed
    expect(invoices.get(15)).toContain('code(204)'); // 404 turned into 204
    expect(invoices.get(18)).toContain('total:'); // amount_due renamed
  });
});

/** New-side line number → content, so assertions can name lines by what is on them. */
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
