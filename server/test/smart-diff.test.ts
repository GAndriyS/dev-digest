/**
 * Smart Diff (L03) — pure classifier + assembler (`modules/smart-diff/helpers.ts`).
 * DB-free: no `Container`, no fastify, no Postgres — see `pulls-status.test.ts`
 * for the sibling pattern this follows.
 */
import { describe, it, expect } from 'vitest';
import { classifyPath, buildSmartDiff, type SmartDiffInputFile } from '../src/modules/smart-diff/helpers.js';
import { LOCK_FILES, ROLE_ORDER, SPLIT_TOO_BIG_LINES } from '../src/modules/smart-diff/constants.js';

describe('classifyPath — lock files', () => {
  it.each(LOCK_FILES)('classifies %s as boilerplate', (name) => {
    expect(classifyPath(name)).toBe('boilerplate');
  });

  it('classifies a lock file nested under a directory as boilerplate', () => {
    expect(classifyPath(`apps/web/${LOCK_FILES[0]}`)).toBe('boilerplate');
  });

  it('classifies a lock file under a directory that itself matches a wiring pattern as boilerplate, because LOCK_FILES is checked before WIRING_PATTERNS', () => {
    // `.github/workflows/**` is a WIRING_PATTERNS entry; the basename is still
    // an exact LOCK_FILES match, and that check runs first, unconditionally.
    expect(classifyPath(`.github/workflows/${LOCK_FILES[0]}`)).toBe('boilerplate');
  });
});

describe('classifyPath — boilerplate patterns', () => {
  it('classifies a file under a dist/ directory as boilerplate', () => {
    expect(classifyPath('dist/bundle.js')).toBe('boilerplate');
  });

  it('classifies a *.min.js file as boilerplate', () => {
    expect(classifyPath('assets/bundle.min.js')).toBe('boilerplate');
  });

  it('classifies a file under a __snapshots__/ directory as boilerplate', () => {
    expect(classifyPath('src/components/__snapshots__/Foo.test.ts.snap')).toBe('boilerplate');
  });
});

describe('classifyPath — wiring patterns', () => {
  it('classifies package.json as wiring', () => {
    expect(classifyPath('package.json')).toBe('wiring');
  });

  it('classifies tsconfig.json as wiring', () => {
    expect(classifyPath('tsconfig.json')).toBe('wiring');
  });

  it('classifies an index.ts barrel as wiring', () => {
    expect(classifyPath('src/index.ts')).toBe('wiring');
  });

  it('classifies a GitHub workflow file as wiring', () => {
    expect(classifyPath('.github/workflows/ci.yml')).toBe('wiring');
  });
});

describe('classifyPath — default', () => {
  it('classifies a business-logic path as core', () => {
    expect(classifyPath('src/services/payment-processor.ts')).toBe('core');
  });
});

describe('buildSmartDiff — group order', () => {
  it('emits groups in core, wiring, boilerplate order, with empty groups still present', () => {
    const files: SmartDiffInputFile[] = [
      { path: 'src/app.ts', additions: 10, deletions: 0 },
      { path: 'dist/bundle.js', additions: 5, deletions: 0 },
    ];

    const result = buildSmartDiff(files, new Map());

    expect(result.groups.map((g) => g.role)).toEqual([...ROLE_ORDER]);
    // No wiring file was given — the group must still be emitted, just empty.
    expect(result.groups.find((g) => g.role === 'wiring')!.files).toEqual([]);
    expect(result.groups.find((g) => g.role === 'core')!.files.map((f) => f.path)).toEqual(['src/app.ts']);
    expect(result.groups.find((g) => g.role === 'boilerplate')!.files.map((f) => f.path)).toEqual([
      'dist/bundle.js',
    ]);
  });
});

describe('buildSmartDiff — within-group order', () => {
  it('sorts by findings count desc, then changed lines desc, then path asc — a total order, pinned as an exact array', () => {
    // server/INSIGHTS.md:47-57 — pin with an exact array, `toContain` catches nothing.
    const files: SmartDiffInputFile[] = [
      { path: 'src/z.ts', additions: 1, deletions: 1 }, // 0 findings, 2 changed
      { path: 'src/a.ts', additions: 1, deletions: 1 }, // 0 findings, 2 changed — ties z on both, breaks on path
      { path: 'src/m.ts', additions: 50, deletions: 0 }, // 0 findings, 50 changed — beats a/z on changed lines
      { path: 'src/low.ts', additions: 1, deletions: 0 }, // 1 finding — beats everything regardless of size
    ];
    const findingsByPath = new Map([['src/low.ts', [5]]]);

    const result = buildSmartDiff(files, findingsByPath);
    const coreFiles = result.groups.find((g) => g.role === 'core')!.files;

    expect(coreFiles.map((f) => f.path)).toEqual(['src/low.ts', 'src/m.ts', 'src/a.ts', 'src/z.ts']);
  });
});

describe('buildSmartDiff — finding_lines', () => {
  it('is the exact sorted, deduped set of startLines for the file', () => {
    const files: SmartDiffInputFile[] = [{ path: 'src/dup.ts', additions: 1, deletions: 0 }];
    const findingsByPath = new Map([['src/dup.ts', [30, 10, 10, 20, 30]]]);

    const result = buildSmartDiff(files, findingsByPath);
    const file = result.groups.find((g) => g.role === 'core')!.files[0]!;

    expect(file.finding_lines).toEqual([10, 20, 30]);
  });

  it('is empty when the file has no findings', () => {
    const files: SmartDiffInputFile[] = [{ path: 'src/clean.ts', additions: 1, deletions: 0 }];

    const result = buildSmartDiff(files, new Map());
    const file = result.groups.find((g) => g.role === 'core')!.files[0]!;

    expect(file.finding_lines).toEqual([]);
  });
});

describe('buildSmartDiff — split threshold boundary', () => {
  it('is not too big at exactly SPLIT_TOO_BIG_LINES total changed lines', () => {
    const files: SmartDiffInputFile[] = [{ path: 'src/big.ts', additions: SPLIT_TOO_BIG_LINES, deletions: 0 }];

    const result = buildSmartDiff(files, new Map());

    expect(result.split_suggestion).toEqual({
      too_big: false,
      total_lines: SPLIT_TOO_BIG_LINES,
      proposed_splits: [],
    });
  });

  it('is too big at SPLIT_TOO_BIG_LINES + 1 total changed lines', () => {
    const files: SmartDiffInputFile[] = [
      { path: 'src/big.ts', additions: SPLIT_TOO_BIG_LINES + 1, deletions: 0 },
    ];

    const result = buildSmartDiff(files, new Map());

    expect(result.split_suggestion.too_big).toBe(true);
    expect(result.split_suggestion.total_lines).toBe(SPLIT_TOO_BIG_LINES + 1);
  });
});
