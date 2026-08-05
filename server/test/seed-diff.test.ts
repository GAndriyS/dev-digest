import { describe, it, expect } from 'vitest';
import { BREAKING_PR_FILES } from '../src/db/seed.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';

/**
 * Pins the PR #483 fixture — the Skills Lab control experiment's diff.
 *
 * Every `@@` header states how many lines its hunk covers on each side, and the
 * grounding gate builds each hunk's new-side line set from that arithmetic. A
 * header that disagrees with its body does not fail loudly: the diff still
 * parses, the review still runs, and every finding is then dropped for citing
 * lines "outside the hunk". The experiment would read as "the skills changed
 * nothing" when in fact the fixture was broken. Hence this test.
 */

/** Rebuild the diff exactly as `diffFromPrFiles` does before parsing. */
function parseFixture() {
  const parts: string[] = [];
  for (const f of BREAKING_PR_FILES) {
    parts.push(`diff --git a/${f.path} b/${f.path}`);
    parts.push(`--- a/${f.path}`);
    parts.push(`+++ b/${f.path}`);
    parts.push(f.patch);
  }
  return parseUnifiedDiff(parts.join('\n'));
}

/** Count what a hunk body actually contains, independent of its header. */
function bodyCounts(patch: string) {
  const [, ...body] = patch.split('\n');
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
    '%s: the @@ header agrees with the hunk body',
    (_path, patch) => {
      const header = patch.split('\n')[0]!;
      const m = header.match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
      expect(m, `unparsable hunk header: ${header}`).not.toBeNull();
      const [, , oldCount, , newCount] = m!.map(Number) as unknown as number[];
      const { context, removed, added } = bodyCounts(patch);
      expect(oldCount).toBe(context + removed);
      expect(newCount).toBe(context + added);
    },
  );

  it('grounds findings on the lines the breaking changes actually landed on', () => {
    const diff = parseFixture();
    const linesOf = (path: string) => {
      const file = diff.files.find((f) => f.path === path)!;
      return new Set(file.hunks.flatMap((h) => [...h.newLineNumbers]));
    };

    // The renamed response field and the 204 — a finding citing either of these
    // must survive grounding, or the experiment cannot show anything.
    const webhooks = linesOf('src/api/public/webhooks.ts');
    expect(webhooks).toContain(18); // secret made required
    expect(webhooks).toContain(19); // new required `events`
    expect(webhooks).toContain(24); // 200 → 204
    expect(webhooks).toContain(25); // callbackUrl → callback_url

    const types = linesOf('src/api/public/types.ts');
    expect(types).toContain(4); // callback_url replaces the @deprecated field
    expect(types).toContain(5);

    const pkg = linesOf('package.json');
    expect(pkg).toContain(3); // 2.4.1 → 2.5.0, a minor bump for a breaking change
  });

  it('states additions/deletions that match the hunk bodies', () => {
    for (const f of BREAKING_PR_FILES) {
      const { added, removed } = bodyCounts(f.patch);
      expect(f.additions, `${f.path} additions`).toBe(added);
      expect(f.deletions, `${f.path} deletions`).toBe(removed);
    }
  });
});
