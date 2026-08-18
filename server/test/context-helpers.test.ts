import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import {
  badgeFor,
  dedupeKeepFirst,
  estimateTokens,
  formatContextChunk,
  nameBadgeFor,
  packDocs,
} from '../src/modules/context/helpers.js';
import { BYTES_PER_TOKEN_EST } from '../src/modules/context/constants.js';
import { walkContextFiles } from '../src/modules/context/service.js';

/**
 * L05 — pure Project Context helpers. No filesystem, no container — exactly
 * the "chisti helpers (order, dedup, packing, token estimate)" line from the
 * plan's Constraints. The symlink-guard walk (which DOES touch the
 * filesystem) has its own unit suite in `context-walk.test.ts`.
 */
describe('context helpers', () => {
  describe('estimateTokens', () => {
    it('is deterministic and scales with size', () => {
      expect(estimateTokens(0)).toBe(1); // never reads as 0 tokens
      expect(estimateTokens(BYTES_PER_TOKEN_EST)).toBe(1);
      expect(estimateTokens(BYTES_PER_TOKEN_EST * 10)).toBe(10);
      expect(estimateTokens(BYTES_PER_TOKEN_EST * 10 + 1)).toBe(11); // rounds up
    });
  });

  describe('nameBadgeFor', () => {
    it('lowercases and strips the extension of the CONFIGURED name', () => {
      expect(nameBadgeFor('INSIGHTS.md')).toBe('insights');
      expect(nameBadgeFor('NOTES.MD')).toBe('notes');
    });
  });

  describe('badgeFor', () => {
    it('returns the first configured root segment found in the path (SPEC-01)', () => {
      expect(badgeFor('specs/SPEC-01.md', ['specs', 'docs', 'insights'], [])).toBe('specs');
      expect(badgeFor('packages/api/docs/architecture.md', ['specs', 'docs'], [])).toBe('docs');
    });

    it('returns null for a path under none of the configured roots or names', () => {
      expect(badgeFor('README.md', ['specs', 'docs'], ['INSIGHTS.md'])).toBeNull();
    });

    it('badges a file matched by CONFIGURED NAME, on any depth including the clone root (SPEC-02 AC-1)', () => {
      expect(badgeFor('INSIGHTS.md', [], ['INSIGHTS.md'])).toBe('insights');
      expect(badgeFor('packages/api/INSIGHTS.md', [], ['INSIGHTS.md'])).toBe('insights');
    });

    it('matches the configured name case-insensitively against the on-disk name, badging from the CONFIGURED casing', () => {
      // Disk has `Insights.md`; config says `INSIGHTS.md` — badge derives
      // from the config entry, not from what's on disk.
      expect(badgeFor('Insights.md', [], ['INSIGHTS.md'])).toBe('insights');
    });

    it('root wins when a file matches both a configured root and a configured name (AC-3) — one badge, not two', () => {
      expect(badgeFor('docs/INSIGHTS.md', ['docs'], ['INSIGHTS.md'])).toBe('docs');
    });

    it('refuses a name match through a SKIP_DIR_NAMES segment, same as the root rule (AC-6)', () => {
      expect(badgeFor('node_modules/pkg/INSIGHTS.md', [], ['INSIGHTS.md'])).toBeNull();
    });

    it('refuses a root match through a SKIP_DIR_NAMES segment that appears after a real root', () => {
      expect(badgeFor('docs/node_modules/pkg/README.md', ['docs'], ['INSIGHTS.md'])).toBeNull();
    });
  });

  /**
   * Plan risk: "the walk and its pure restatement can diverge — that already
   * cost a fix pass once (helpers.ts:13-36)." This runs the walk over a real
   * temp tree covering every shape the module cares about (root-only,
   * name-only, both, SKIP_DIR_NAMES, nested, outside everything) and asserts
   * `badgeFor` agrees with the walk on EVERY path: the same badge for every
   * path the walk yielded, and `null` for every path the walk rejected.
   */
  describe('badgeFor agrees with walkContextFiles (paired test)', () => {
    const dirs: string[] = [];
    afterEach(async () => {
      await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
    });
    async function tmp(prefix: string): Promise<string> {
      const d = await mkdtemp(join(tmpdir(), prefix));
      dirs.push(d);
      return d;
    }

    it('badges every yielded path the same way the walk did, and null for every path the walk rejected', async () => {
      const root = await tmp('devdigest-context-parity-');
      const roots = ['specs', 'docs'];
      const fileNames = ['INSIGHTS.md'];

      const layout: Record<string, string> = {
        'specs/a.md': '# under a root',
        'docs/nested/b.md': '# under a root, nested',
        'INSIGHTS.md': '# name match at the clone root',
        'packages/api/INSIGHTS.md': '# name match, nested',
        'docs/INSIGHTS.md': '# both root and name — root should win',
        'node_modules/pkg/INSIGHTS.md': '# skipped dir, name match — must be rejected',
        'specs/node_modules/pkg/README.md': '# skipped dir under a real root — must be rejected',
        'random/x.md': '# neither root nor name — must be rejected',
      };
      for (const [rel, content] of Object.entries(layout)) {
        const abs = join(root, ...rel.split('/'));
        await mkdir(join(abs, '..'), { recursive: true });
        await writeFile(abs, content, 'utf8');
      }

      const walked = await walkContextFiles(root, roots, fileNames, 2000);
      const yieldedPaths = new Set(walked.files.map((f) => f.relPath));

      for (const f of walked.files) {
        expect(badgeFor(f.relPath, roots, fileNames)).toBe(f.root);
      }
      for (const rel of Object.keys(layout)) {
        if (yieldedPaths.has(rel)) continue;
        expect(badgeFor(rel, roots, fileNames)).toBeNull();
      }
    });
  });

  describe('dedupeKeepFirst', () => {
    it('keeps the FIRST occurrence — the agent-own-doc-wins-over-inherited rule', () => {
      expect(dedupeKeepFirst(['a.md', 'b.md', 'a.md', 'c.md', 'b.md'])).toEqual([
        'a.md',
        'b.md',
        'c.md',
      ]);
    });

    it('is a no-op on an already-unique list', () => {
      expect(dedupeKeepFirst(['x.md', 'y.md'])).toEqual(['x.md', 'y.md']);
    });

    it('handles an empty list', () => {
      expect(dedupeKeepFirst([])).toEqual([]);
    });
  });

  describe('formatContextChunk', () => {
    it('prefixes the content with a path header', () => {
      expect(formatContextChunk('specs/x.md', 'hello')).toBe('### specs/x.md\n\nhello');
    });
  });

  describe('packDocs', () => {
    it('packs everything that fits, in order', () => {
      const docs = [
        { path: 'a.md', content: 'aaaa' },
        { path: 'b.md', content: 'bbbb' },
      ];
      const result = packDocs(docs, 10_000);
      expect(result.specsRead).toEqual(['a.md', 'b.md']);
      expect(result.specs).toHaveLength(2);
      expect(result.skipped).toEqual([]);
    });

    it('skips a document that would overflow the budget, but keeps trying later ones', () => {
      const docs = [
        { path: 'huge.md', content: 'x'.repeat(100) },
        { path: 'small.md', content: 'y' },
      ];
      // Budget fits the header + "small.md" chunk but not "huge.md"'s.
      const budget = formatContextChunk('small.md', 'y').length;
      const result = packDocs(docs, budget);
      expect(result.specsRead).toEqual(['small.md']);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toMatchObject({ path: 'huge.md' });
      expect(result.skipped[0]!.reason).toMatch(/budget/);
    });

    it('never partially includes a document — over budget means fully skipped', () => {
      const docs = [{ path: 'only.md', content: 'z'.repeat(50) }];
      const result = packDocs(docs, 5);
      expect(result.specs).toEqual([]);
      expect(result.specsRead).toEqual([]);
      expect(result.skipped).toHaveLength(1);
    });

    /**
     * SPEC-02 AC-14 raises the block budget from SPEC-01's 32_000 chars to
     * 80_000. The two chunk sizes below are the plan's own measured numbers
     * (root `INSIGHTS.md` + `server/INSIGHTS.md`, Decisions taken §2) — real,
     * not synthetic round numbers — and their sum (37_234) fits comfortably
     * under the new budget but would have overflowed the OLD one.
     */
    it('packs two SPEC-02-sized real docs (19,335 B + 17,899 B) under the new 80,000-char budget; a third that would overflow it is skipped whole (AC-14)', () => {
      const budget = 80_000;
      const chunkContentFor = (path: string, targetChunkLen: number) =>
        'x'.repeat(targetChunkLen - formatContextChunk(path, '').length);

      const doc1 = { path: 'root/INSIGHTS.md', content: chunkContentFor('root/INSIGHTS.md', 19_335) };
      const doc2 = { path: 'server/INSIGHTS.md', content: chunkContentFor('server/INSIGHTS.md', 17_899) };
      expect(formatContextChunk(doc1.path, doc1.content).length).toBe(19_335);
      expect(formatContextChunk(doc2.path, doc2.content).length).toBe(17_899);

      // A third doc sized to push the running total exactly one char past budget.
      const remaining = budget - 19_335 - 17_899;
      const doc3 = { path: 'third.md', content: chunkContentFor('third.md', remaining + 1) };

      const result = packDocs([doc1, doc2, doc3], budget);
      expect(result.specsRead).toEqual(['root/INSIGHTS.md', 'server/INSIGHTS.md']);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toMatchObject({ path: 'third.md' });
      expect(result.skipped[0]!.reason).toMatch(/80000/);
    });
  });
});
