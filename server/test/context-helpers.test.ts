import { describe, it, expect } from 'vitest';
import {
  dedupeKeepFirst,
  estimateTokens,
  formatContextChunk,
  packDocs,
  rootBadgeFor,
} from '../src/modules/context/helpers.js';
import { BYTES_PER_TOKEN_EST } from '../src/modules/context/constants.js';

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

  describe('rootBadgeFor', () => {
    it('returns the first configured root segment found in the path', () => {
      expect(rootBadgeFor('specs/SPEC-01.md', ['specs', 'docs', 'insights'])).toBe('specs');
      expect(rootBadgeFor('packages/api/docs/architecture.md', ['specs', 'docs'])).toBe('docs');
    });

    it('returns null for a path under none of the configured roots', () => {
      expect(rootBadgeFor('README.md', ['specs', 'docs'])).toBeNull();
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
  });
});
