/**
 * Smart Diff classification constants (L03) — this module's published
 * surface (`no-cross-module-internals` lets any module import
 * `constants.ts`). Every threshold and pattern the classifier consults
 * lives here, so a behaviour change is a diff to this file, never a
 * literal buried in `helpers.ts`.
 *
 * Pattern syntax consumed by `matchesPattern` in `helpers.ts`:
 *   - starts AND ends with `/` (e.g. `/vendor/`) → ROOT-ANCHORED
 *                             directory-segment match: true only when this
 *                             exact segment is the path's FIRST directory.
 *                             Reserve this for directory names that are
 *                             ambiguous with hand-written source layout —
 *                             `vendor/`, `build/`, `out/`, `generated/` are
 *                             all legitimate names for a nested, hand-edited
 *                             folder (`server/src/vendor/shared`, a
 *                             `scripts/build/` release script, a
 *                             `packages/out/` package) and must not be
 *                             boilerplate just because the segment appears
 *                             somewhere downstream of `src/`.
 *   - ends with `/` (only) → directory-segment match: true when this exact
 *                             segment appears anywhere among the path's
 *                             directories (never the filename itself). Safe
 *                             for names that are unambiguous regardless of
 *                             depth — `dist/`, `coverage/`, `.next/`,
 *                             `node_modules/`, `__snapshots__/` — a package
 *                             never hand-authors a nested folder with one of
 *                             these exact names for source code.
 *   - starts with `/` (only) → basename glob, but ONLY at repo root (the path
 *                             contains no `/` at all) — e.g. `/*.yml`.
 *   - contains `/` (else)   → full-path glob, anchored start-to-end.
 *   - no `/` at all (else)  → basename glob, matched at ANY directory depth.
 *   - `*`  matches any run of non-`/` characters.
 *   - `**` matches any run of characters, including `/`.
 */

// --- Role classification -----------------------------------------------

/**
 * Exact basenames, checked FIRST and unconditionally, before either pattern
 * list below — a lock file is always `boilerplate` even when it also sits
 * inside a directory that matches a `WIRING_PATTERNS` entry (e.g. a lock
 * file dropped under `.github/workflows/`).
 */
export const LOCK_FILES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'npm-shrinkwrap.json',
  'Cargo.lock',
  'poetry.lock',
  'Gemfile.lock',
  'composer.lock',
  'go.sum',
  'Pipfile.lock',
] as const;

/**
 * Checked after `LOCK_FILES`; a match classifies the file as `boilerplate`.
 * `/vendor/`, `/build/`, `/out/`, `/generated/` are root-anchored (see the
 * pattern-syntax comment above) — these four names are also plausible
 * hand-authored directories nested under `src/` or a package root, and
 * boilerplate is the one role forced collapsed, so a false positive here
 * hides real source rather than merely mis-sorting it.
 */
export const BOILERPLATE_PATTERNS = [
  'dist/',
  'coverage/',
  '.next/',
  'node_modules/',
  '__snapshots__/',
  '*.snap',
  '*.min.js',
  '*.map',
  '*.generated.*',
  '*.pb.go',
  '/vendor/',
  '/build/',
  '/out/',
  '/generated/',
] as const;

/**
 * Checked after `BOILERPLATE_PATTERNS`; a match classifies the file as
 * `wiring`. Anything matching neither list is `core` — the default (see
 * `classifyPath` in `helpers.ts`). `*.config.{ts,js,mjs,cjs}` is expanded
 * into four literal entries — this module's tiny glob engine has no brace
 * expansion.
 */
export const WIRING_PATTERNS = [
  'package.json',
  'tsconfig*.json',
  '*.config.ts',
  '*.config.js',
  '*.config.mjs',
  '*.config.cjs',
  '.github/workflows/**',
  'Dockerfile*',
  'docker-compose*',
  '.env*',
  '*.env',
  'index.ts', // basename form — matches at any depth, INCLUDING repo root
  '/*.yml', // root only — a nested *.yml (e.g. under a fixtures dir) is core
  '/*.yaml',
] as const;

/** Fixed group order in the response, independent of insertion order. */
export const ROLE_ORDER = ['core', 'wiring', 'boilerplate'] as const;

// --- Split proposal --------------------------------------------------------

/** Total changed lines (additions+deletions) strictly above this is "too big". */
export const SPLIT_TOO_BIG_LINES = 400;
/** A candidate split group smaller than this many files is folded away, not proposed. */
export const SPLIT_MIN_FILES_PER_GROUP = 2;
/** Cap on proposed non-boilerplate splits (the "chore" boilerplate split is additional). */
export const MAX_PROPOSED_SPLITS = 4;
