import { describe, it, expect } from 'vitest';
import type { UnifiedDiff } from '@devdigest/shared';
import { parseUnifiedDiff, unifiedDiffFromPatches } from '../src/adapters/git/diff-parser.js';
import { BREAKING_PR_FILES } from '../src/db/seed.js';
import {
  hunkHeaderDigest,
  linkedIssueNumber,
  repoMarkdownRefs,
  externalLinkRefs,
  MAX_REPO_MD_REFS,
  MAX_EXTERNAL_URL_REFS,
} from '../src/modules/reviews/intent-inputs.js';

/**
 * Unit coverage for the L03 intent classifier's pure input builders.
 *
 * The diff fixture is built from seeded PR #483's `BREAKING_PR_FILES` (NOT
 * #482, whose `pr_files` rows have no `patch` text — server/INSIGHTS.md:47-57)
 * using the same "diff --git / --- / +++ / <patch>" reconstruction
 * `diffFromPrFiles` (reviews/diff-loader.ts) performs, so the fixture matches
 * how a real request would build the diff for this PR.
 */
function breakingDiff(): UnifiedDiff {
  return parseUnifiedDiff(unifiedDiffFromPatches(BREAKING_PR_FILES));
}

describe('hunkHeaderDigest', () => {
  it('reconstructs the exact @@ header set for PR #483, one per file, in file order', () => {
    const digest = hunkHeaderDigest(breakingDiff());
    const lines = digest.split('\n');

    // Exact set, not a subset check: reordering, dropping, or adding a header
    // must fail this test — the grounding gate maps findings onto these exact
    // new-side numbers, so an approximate match would hide a real regression.
    expect(lines).toEqual([
      'src/api/public/webhooks.ts',
      '@@ -14,12 +14,13 @@',
      'src/api/public/types.ts',
      '@@ -3,5 +3,4 @@',
      'package.json',
      '@@ -1,5 +1,5 @@',
    ]);
  });

  it('never leaks a +/- patch content line into the digest — the entire point of the redesign', () => {
    const digest = hunkHeaderDigest(breakingDiff());

    // The old (15fa391^) intent pass sent diff.raw, patch bodies and all. Any
    // content line from BREAKING_PR_FILES' patches — additions or deletions —
    // appearing in the digest is exactly that regression.
    for (const f of BREAKING_PR_FILES) {
      for (const patchLine of f.patch.split('\n')) {
        const trimmed = patchLine.trim();
        if (trimmed.startsWith('+') || trimmed.startsWith('-')) {
          // Strip the leading +/- marker to compare the actual code content —
          // not just the raw patch line, which would trivially never match a
          // digest line (the digest has no leading +/- at all).
          const content = trimmed.slice(1).trim();
          if (content.length > 0) {
            expect(digest).not.toContain(content);
          }
        }
      }
    }

    // Belt and suspenders: no digest line itself may start with + or - (the
    // digest is file paths and reconstructed @@ headers only).
    for (const line of digest.split('\n')) {
      expect(line.startsWith('+')).toBe(false);
      expect(line.startsWith('-')).toBe(false);
    }
  });

  it('returns an empty string for a diff with no files, and never throws', () => {
    expect(() => hunkHeaderDigest({ raw: '', files: [] })).not.toThrow();
    expect(hunkHeaderDigest({ raw: '', files: [] })).toBe('');
  });
});

describe('linkedIssueNumber', () => {
  it('extracts the first #N, optionally preceded by a closing keyword', () => {
    expect(linkedIssueNumber('Closes #471.')).toBe(471);
    expect(linkedIssueNumber('fixes #12 and mentions #99 later')).toBe(12);
    expect(linkedIssueNumber('See #7 for context')).toBe(7);
  });

  it('returns undefined for an absent, empty, or non-matching body, and never throws', () => {
    expect(linkedIssueNumber(undefined)).toBeUndefined();
    expect(linkedIssueNumber(null)).toBeUndefined();
    expect(linkedIssueNumber('')).toBeUndefined();
    expect(linkedIssueNumber('No issue reference here.')).toBeUndefined();
  });
});

describe('repoMarkdownRefs', () => {
  it('keeps repo-relative *.md paths and rejects absolute paths, URLs, and anything with a scheme', () => {
    const body = [
      'See docs/readme.md and CHANGELOG.md for details.',
      'Do not use /etc/passwd.md',
      'Or C:\\Windows\\evil.md',
      'Or ~/secrets.md',
      'Or ../../outside.md',
      'Or https://example.com/docs/readme.md',
      'Or ftp://mirror.example.com/spec.md',
    ].join('\n');

    const refs = repoMarkdownRefs(body);

    expect(refs).toEqual(['docs/readme.md', 'CHANGELOG.md']);
    expect(refs).not.toContain('/etc/passwd.md');
    expect(refs.some((r) => r.includes('Windows'))).toBe(false);
    expect(refs.some((r) => r.startsWith('~'))).toBe(false);
    expect(refs.some((r) => r.includes('..'))).toBe(false);
    expect(refs.some((r) => r.includes('example.com'))).toBe(false);
  });

  it('deduplicates and caps at MAX_REPO_MD_REFS', () => {
    const body = Array.from({ length: MAX_REPO_MD_REFS + 5 }, (_, i) => `doc-${i}.md`).join(' ');
    const refs = repoMarkdownRefs(body);
    expect(refs.length).toBe(MAX_REPO_MD_REFS);

    const dup = 'a.md a.md a.md';
    expect(repoMarkdownRefs(dup)).toEqual(['a.md']);
  });

  it('returns an empty array for an absent or empty body, and never throws', () => {
    expect(repoMarkdownRefs(undefined)).toEqual([]);
    expect(repoMarkdownRefs(null)).toEqual([]);
    expect(repoMarkdownRefs('')).toEqual([]);
  });
});

describe('externalLinkRefs', () => {
  it('extracts http(s) URLs for provenance only, deduplicated and capped at MAX_EXTERNAL_URL_REFS', () => {
    const body = Array.from(
      { length: MAX_EXTERNAL_URL_REFS + 5 },
      (_, i) => `https://example.com/doc-${i}`,
    ).join(' ');
    const refs = externalLinkRefs(body);
    expect(refs.length).toBe(MAX_EXTERNAL_URL_REFS);

    const dup = 'https://a.example http://a.example https://a.example';
    expect(externalLinkRefs(dup)).toEqual(['https://a.example', 'http://a.example']);
  });

  it('returns an empty array for an absent or empty body, and never throws', () => {
    expect(externalLinkRefs(undefined)).toEqual([]);
    expect(externalLinkRefs(null)).toEqual([]);
    expect(externalLinkRefs('')).toEqual([]);
  });
});
