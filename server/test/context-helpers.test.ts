import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import {
  agentLookupFailureDoc,
  badgeFor,
  dedupeKeepFirst,
  estimateTokens,
  formatContextChunk,
  mergeWithAttribution,
  nameBadgeFor,
  packDocs,
  skillLookupFailureDoc,
} from '../src/modules/context/helpers.js';
import type { EnabledSkillRef } from '../src/modules/context/types.js';
import { BYTES_PER_TOKEN_EST, MAX_CONTEXT_BLOCK_CHARS } from '../src/modules/context/constants.js';
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

    it('badges a file matched by CONFIGURED NAME, on any depth including the clone root (SPEC-01 AC-26)', () => {
      expect(badgeFor('INSIGHTS.md', [], ['INSIGHTS.md'])).toBe('insights');
      expect(badgeFor('packages/api/INSIGHTS.md', [], ['INSIGHTS.md'])).toBe('insights');
    });

    it('matches the configured name case-insensitively against the on-disk name, badging from the CONFIGURED casing', () => {
      // Disk has `Insights.md`; config says `INSIGHTS.md` — badge derives
      // from the config entry, not from what's on disk.
      expect(badgeFor('Insights.md', [], ['INSIGHTS.md'])).toBe('insights');
    });

    it('root wins when a file matches both a configured root and a configured name (AC-28) — one badge, not two', () => {
      expect(badgeFor('docs/INSIGHTS.md', ['docs'], ['INSIGHTS.md'])).toBe('docs');
    });

    it('refuses a name match through a SKIP_DIR_NAMES segment, same as the root rule (AC-31)', () => {
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
        // Under an active root but NOT `.md` and not a configured name — the
        // walk's `matchesRoot` requires the extension check even once a root
        // is active, so this must be rejected too. `badgeFor`'s root branch
        // once skipped this check and returned the root as soon as a
        // directory segment matched, regardless of the file's own name.
        'specs/notes.txt': '# under a root, wrong extension — must be rejected',
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
    const AGENT = { kind: 'agent' as const };

    it('packs everything that fits, in order', () => {
      const docs = [
        { path: 'a.md', content: 'aaaa', source: AGENT },
        { path: 'b.md', content: 'bbbb', source: AGENT },
      ];
      const result = packDocs(docs, 10_000);
      expect(result.attached.map((a) => a.path)).toEqual(['a.md', 'b.md']);
      expect(result.specs).toHaveLength(2);
      expect(result.skipped).toEqual([]);
    });

    it('skips a document that would overflow the budget, but keeps trying later ones', () => {
      const docs = [
        { path: 'huge.md', content: 'x'.repeat(100), source: AGENT },
        { path: 'small.md', content: 'y', source: AGENT },
      ];
      // Budget fits the header + "small.md" chunk but not "huge.md"'s.
      const budget = formatContextChunk('small.md', 'y').length;
      const result = packDocs(docs, budget);
      expect(result.attached.map((a) => a.path)).toEqual(['small.md']);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toMatchObject({ path: 'huge.md' });
      expect(result.skipped[0]!.reason).toMatch(/budget/);
    });

    it('never partially includes a document — over budget means fully skipped', () => {
      const docs = [{ path: 'only.md', content: 'z'.repeat(50), source: AGENT }];
      const result = packDocs(docs, 5);
      expect(result.specs).toEqual([]);
      expect(result.attached).toEqual([]);
      expect(result.skipped).toHaveLength(1);
    });

    it('keeps each document\'s source on both sides — attached AND a budget skip (SPEC-01 AC-43)', () => {
      const skillSource = { kind: 'skill' as const, skillId: 'sk1', skillName: 'pr-quality-rubric', skillVersion: 2 };
      const docs = [
        { path: 'kept.md', content: 'y', source: AGENT },
        { path: 'over.md', content: 'x'.repeat(100), source: skillSource },
      ];
      const budget = formatContextChunk('kept.md', 'y').length;
      const result = packDocs(docs, budget);
      expect(result.attached).toEqual([{ path: 'kept.md', source: AGENT }]);
      expect(result.skipped).toEqual([
        {
          path: 'over.md',
          source: skillSource,
          reason: expect.stringMatching(/budget/),
        },
      ]);
    });

    /**
     * SPEC-01 AC-20 raises the block budget from SPEC-01's 32_000 chars to
     * 80_000. The two chunk sizes below are the plan's own measured numbers
     * (root `INSIGHTS.md` + `server/INSIGHTS.md`, Decisions taken §2) — real,
     * not synthetic round numbers — and their sum (37_234) fits comfortably
     * under the new budget but would have overflowed the OLD one.
     */
    it('packs two INSIGHTS.md-sized real docs (19,335 B + 17,899 B) under the new 80,000-char budget; a third that would overflow it is skipped whole (AC-20)', () => {
      // Imported, not hardcoded (code-review, fix pass 1, item 4) — reverting
      // MAX_CONTEXT_BLOCK_CHARS to SPEC-01's 32_000 must fail this exact test,
      // not silently pass because the assertion carries its own frozen number.
      const budget = MAX_CONTEXT_BLOCK_CHARS;
      const chunkContentFor = (path: string, targetChunkLen: number) =>
        'x'.repeat(targetChunkLen - formatContextChunk(path, '').length);

      const doc1 = { path: 'root/INSIGHTS.md', content: chunkContentFor('root/INSIGHTS.md', 19_335), source: AGENT };
      const doc2 = {
        path: 'server/INSIGHTS.md',
        content: chunkContentFor('server/INSIGHTS.md', 17_899),
        source: AGENT,
      };
      expect(formatContextChunk(doc1.path, doc1.content).length).toBe(19_335);
      expect(formatContextChunk(doc2.path, doc2.content).length).toBe(17_899);

      // A third doc sized to push the running total exactly one char past budget.
      const remaining = budget - 19_335 - 17_899;
      const doc3 = { path: 'third.md', content: chunkContentFor('third.md', remaining + 1), source: AGENT };

      const result = packDocs([doc1, doc2, doc3], budget);
      expect(result.attached.map((a) => a.path)).toEqual(['root/INSIGHTS.md', 'server/INSIGHTS.md']);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toMatchObject({ path: 'third.md' });
      expect(result.skipped[0]!.reason).toMatch(new RegExp(String(budget)));
    });
  });

  describe('mergeWithAttribution', () => {
    const skill1: EnabledSkillRef = { id: 'sk1', name: 'alpha', version: 2 };
    const skill2: EnabledSkillRef = { id: 'sk2', name: 'beta', version: 7 };

    it('attributes an agent-only path to the agent', () => {
      const merged = mergeWithAttribution(['a.md'], []);
      expect(merged).toEqual([{ path: 'a.md', source: { kind: 'agent' } }]);
    });

    it('AC-39/edge case: a path attached to both the agent and an inherited skill is attributed to the agent (own wins over inherited)', () => {
      const merged = mergeWithAttribution(['shared.md'], [{ skill: skill1, paths: ['shared.md'] }]);
      expect(merged).toEqual([{ path: 'shared.md', source: { kind: 'agent' } }]);
    });

    it('AC-39/edge case: a path attached to two enabled skills is attributed to the FIRST skill in prompt order', () => {
      const merged = mergeWithAttribution(
        [],
        [
          { skill: skill1, paths: ['shared.md'] },
          { skill: skill2, paths: ['shared.md'] },
        ],
      );
      expect(merged).toEqual([
        { path: 'shared.md', source: { kind: 'skill', skillId: 'sk1', skillName: 'alpha', skillVersion: 2 } },
      ]);
    });

    it('own docs come first, then each skill in order, each surviving path exactly once', () => {
      const merged = mergeWithAttribution(
        ['own.md'],
        [
          { skill: skill1, paths: ['sk1-doc.md'] },
          { skill: skill2, paths: ['sk2-doc.md'] },
        ],
      );
      expect(merged.map((m) => m.path)).toEqual(['own.md', 'sk1-doc.md', 'sk2-doc.md']);
      expect(merged[1]!.source).toEqual({ kind: 'skill', skillId: 'sk1', skillName: 'alpha', skillVersion: 2 });
      expect(merged[2]!.source).toEqual({ kind: 'skill', skillId: 'sk2', skillName: 'beta', skillVersion: 7 });
    });

    it('a disabled skill never appears here — the caller filters before this merge runs (AC-40)', () => {
      // No disabled-skill branch to test: `enabledSkills` is ALREADY filtered
      // by run-executor before this helper ever sees it. Documented so the
      // absence of an "enabled: false" case here isn't mistaken for a gap.
      const merged = mergeWithAttribution([], [{ skill: skill1, paths: ['a.md'] }]);
      expect(merged).toHaveLength(1);
    });
  });

  describe('agentLookupFailureDoc / skillLookupFailureDoc (AC-42)', () => {
    it('names the agent as the source and keeps the pseudo-path', () => {
      const doc = agentLookupFailureDoc(new Error('connection reset'));
      expect(doc.path).toBe('(agent context)');
      expect(doc.source).toEqual({ kind: 'agent' });
      expect(doc.reason).toContain('connection reset');
    });

    it('names the skill by name+version, not just its id — the pseudo-path still carries the id (Recommendations §1, declined)', () => {
      const skill: EnabledSkillRef = { id: 'sk-9f3c', name: 'pr-quality-rubric', version: 2 };
      const doc = skillLookupFailureDoc(skill, new Error('timeout'));
      expect(doc.path).toBe('(skill sk-9f3c context)');
      expect(doc.source).toEqual({ kind: 'skill', skillId: 'sk-9f3c', skillName: 'pr-quality-rubric', skillVersion: 2 });
      expect(doc.reason).toContain('timeout');
    });
  });
});
