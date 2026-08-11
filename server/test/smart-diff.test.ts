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

describe('classifyPath — index.ts wiring pattern (root-level barrel)', () => {
  it('classifies a root-level index.ts as wiring — the basename form matches at any depth, including the root', () => {
    // Regression: the full-path form '**/index.ts' compiles to
    // ^.*\/index\.ts$, which requires at least one '/' and never matches a
    // bare root-level 'index.ts'.
    expect(classifyPath('index.ts')).toBe('wiring');
  });

  it('still classifies a nested index.ts as wiring', () => {
    expect(classifyPath('src/index.ts')).toBe('wiring');
  });
});

describe('classifyPath — root-anchored boilerplate directories', () => {
  it('does not classify a hand-edited file nested under src/vendor/ as boilerplate', () => {
    // The canonical @devdigest/shared contract file — the most
    // review-critical file in this repo, per the finding.
    expect(classifyPath('server/src/vendor/shared/contracts/brief.ts')).not.toBe('boilerplate');
  });

  it('does not classify a hand-written file nested under scripts/build/ as boilerplate', () => {
    expect(classifyPath('scripts/build/release.ts')).not.toBe('boilerplate');
  });

  it('does not classify a file nested under packages/out/ as boilerplate', () => {
    expect(classifyPath('packages/out/index.ts')).not.toBe('boilerplate');
  });

  it('still classifies a root-level vendor/, build/, out/, or generated/ directory as boilerplate', () => {
    expect(classifyPath('vendor/some-lib.js')).toBe('boilerplate');
    expect(classifyPath('build/bundle.js')).toBe('boilerplate');
    expect(classifyPath('out/bundle.js')).toBe('boilerplate');
    expect(classifyPath('generated/client.ts')).toBe('boilerplate');
  });
});

describe('classifyPath — *.env* over-matching', () => {
  it('does not classify a file whose name merely contains "environment" as wiring', () => {
    expect(classifyPath('src/config.environment.ts')).not.toBe('wiring');
    expect(classifyPath('src/parse.environment.ts')).not.toBe('wiring');
    expect(classifyPath('test/setup.environment.ts')).not.toBe('wiring');
  });

  it('still classifies real dotenv files as wiring', () => {
    expect(classifyPath('.env')).toBe('wiring');
    expect(classifyPath('.env.local')).toBe('wiring');
    expect(classifyPath('config/production.env')).toBe('wiring');
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

describe('buildSmartDiff — split proposal groups by directory, not full path', () => {
  it('groups depth-2 files (a single directory segment) under that directory — the finding\'s worked example', () => {
    // Regression: grouping by the file's own first-two-path-segments made a
    // depth-2 file's key equal to its whole path, so every file became a
    // singleton group and got folded away by SPLIT_MIN_FILES_PER_GROUP.
    const perFile = Math.ceil((SPLIT_TOO_BIG_LINES + 1) / 5);
    const files: SmartDiffInputFile[] = [
      { path: 'server/app.ts', additions: perFile, deletions: 0 },
      { path: 'server/routes.ts', additions: perFile, deletions: 0 },
      { path: 'server/db.ts', additions: perFile, deletions: 0 },
      { path: 'client/page.tsx', additions: perFile, deletions: 0 },
      { path: 'client/nav.tsx', additions: perFile, deletions: 0 },
    ];

    const result = buildSmartDiff(files, new Map());

    expect(result.split_suggestion.too_big).toBe(true);
    expect(result.split_suggestion.proposed_splits.map((s) => s.name).sort()).toEqual([
      'client',
      'server',
    ]);
    const serverSplit = result.split_suggestion.proposed_splits.find((s) => s.name === 'server')!;
    expect(serverSplit.files).toEqual(['server/app.ts', 'server/db.ts', 'server/routes.ts']);
  });

  it('groups a file three or more segments deep by its first two segments, not its full directory path', () => {
    const perFile = Math.ceil((SPLIT_TOO_BIG_LINES + 1) / 2);
    const files: SmartDiffInputFile[] = [
      { path: 'server/src/modules/a.ts', additions: perFile, deletions: 0 },
      { path: 'server/src/platform/b.ts', additions: perFile, deletions: 0 },
    ];

    const result = buildSmartDiff(files, new Map());

    expect(result.split_suggestion.proposed_splits.map((s) => s.name)).toEqual(['server/src']);
  });
});

describe('buildSmartDiff — split names never collide', () => {
  it('renames the boilerplate "chore" split when a directory literally named chore/ already produced a split by that name', () => {
    const perFile = Math.ceil((SPLIT_TOO_BIG_LINES + 1) / 4);
    const files: SmartDiffInputFile[] = [
      { path: 'chore/one.ts', additions: perFile, deletions: 0 },
      { path: 'chore/two.ts', additions: perFile, deletions: 0 },
      { path: LOCK_FILES[0], additions: perFile, deletions: 0 },
      { path: LOCK_FILES[1], additions: perFile, deletions: 0 },
    ];

    const result = buildSmartDiff(files, new Map());
    const names = result.split_suggestion.proposed_splits.map((s) => s.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('chore');
    expect(names.filter((n) => n !== 'chore')).toEqual(['chore (boilerplate)']);
  });
});
