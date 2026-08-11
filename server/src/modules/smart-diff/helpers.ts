import type { SmartDiff, SmartDiffFile, SmartDiffGroup, SmartDiffRole, ProposedSplit } from '@devdigest/shared';
import {
  LOCK_FILES,
  BOILERPLATE_PATTERNS,
  WIRING_PATTERNS,
  ROLE_ORDER,
  SPLIT_TOO_BIG_LINES,
  SPLIT_MIN_FILES_PER_GROUP,
  MAX_PROPOSED_SPLITS,
} from './constants.js';

/**
 * Pure Smart Diff classifier + assembler (L03). Side-effect free — no
 * `Container`, no fastify import, no DB. `service.ts` is the only place in
 * this module that touches Postgres; this file takes plain data in and
 * returns the wire shape (`SmartDiff`) out.
 */

// ============================================================ Path classification

const LOCK_FILE_SET: ReadonlySet<string> = new Set(LOCK_FILES);

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

/** Minimal glob → RegExp: `*` = any run of non-`/` chars, `**` = any run of
 *  any chars (incl. `/`). No brace expansion, no character classes — the
 *  patterns in `constants.ts` never need them. */
function globToRegExp(glob: string): RegExp {
  let src = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      src += '.*';
      i++;
    } else if (c === '*') {
      src += '[^/]*';
    } else if ('.+^${}()|[]\\'.includes(c!)) {
      src += '\\' + c;
    } else {
      src += c;
    }
  }
  return new RegExp(`^${src}$`);
}

/** See the pattern-syntax doc comment at the top of `constants.ts`. */
function matchesPattern(path: string, pattern: string): boolean {
  if (pattern.endsWith('/')) {
    const dir = pattern.slice(0, -1);
    const dirs = path.split('/');
    dirs.pop(); // drop the filename — only directory segments count
    return dirs.includes(dir);
  }
  if (pattern.startsWith('/')) {
    return !path.includes('/') && globToRegExp(pattern.slice(1)).test(path);
  }
  if (pattern.includes('/')) {
    return globToRegExp(pattern).test(path);
  }
  return globToRegExp(pattern).test(basename(path));
}

/** `LOCK_FILES` first (unconditional) → `BOILERPLATE_PATTERNS` →
 *  `WIRING_PATTERNS` → `core` default. Path-only: a `null` patch never
 *  reaches this function, so it classifies identically either way. */
export function classifyPath(path: string): SmartDiffRole {
  if (LOCK_FILE_SET.has(basename(path))) return 'boilerplate';
  if (BOILERPLATE_PATTERNS.some((p) => matchesPattern(path, p))) return 'boilerplate';
  if (WIRING_PATTERNS.some((p) => matchesPattern(path, p))) return 'wiring';
  return 'core';
}

// ============================================================ Diff assembly

/** The subset of a `pr_files` row the builder needs — kept local so this
 *  file never imports the DB schema (mirrors the plan's "no Container" rule
 *  for this module: the Drizzle row shape is `service.ts`'s concern). */
export interface SmartDiffInputFile {
  path: string;
  additions: number;
  deletions: number;
}

/**
 * Groups `files` by classified role (fixed `ROLE_ORDER`, empty groups still
 * emitted), attaches `finding_lines` from `findingsByPath` (already
 * deduped/sorted by the caller — see below), and computes the split
 * suggestion. Within a group: findings-count desc → changed-lines desc →
 * path asc — a total order, so the sort has no ties to resolve arbitrarily.
 */
export function buildSmartDiff(
  files: SmartDiffInputFile[],
  findingsByPath: Map<string, number[]>,
): SmartDiff {
  const byRole = new Map<SmartDiffRole, SmartDiffFile[]>();
  for (const role of ROLE_ORDER) byRole.set(role, []);

  for (const file of files) {
    const role = classifyPath(file.path);
    const rawLines = findingsByPath.get(file.path) ?? [];
    const findingLines = [...new Set(rawLines)].sort((a, b) => a - b);
    byRole.get(role)!.push({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      finding_lines: findingLines,
    });
  }

  const groups: SmartDiffGroup[] = ROLE_ORDER.map((role) => ({
    role,
    files: sortGroup(byRole.get(role)!),
  }));

  return { groups, split_suggestion: proposeSplits(files) };
}

function sortGroup(files: SmartDiffFile[]): SmartDiffFile[] {
  return [...files].sort((a, b) => {
    const findingsDiff = b.finding_lines.length - a.finding_lines.length;
    if (findingsDiff !== 0) return findingsDiff;
    const changedA = a.additions + a.deletions;
    const changedB = b.additions + b.deletions;
    const changedDiff = changedB - changedA;
    if (changedDiff !== 0) return changedDiff;
    return a.path.localeCompare(b.path);
  });
}

// ============================================================ Split proposal

function firstTwoSegments(path: string): string {
  return path.split('/').slice(0, 2).join('/');
}

/**
 * `total_lines` = Σ(additions+deletions) over ALL files (every role, not
 * just core). `too_big` is strict `>` (see `SPLIT_TOO_BIG_LINES`'s comment).
 * When too big: group non-boilerplate files by their first two path
 * segments, drop groups under `SPLIT_MIN_FILES_PER_GROUP`, cap at
 * `MAX_PROPOSED_SPLITS`, then append one "chore" split for the boilerplate
 * files (uncapped, present only when boilerplate files exist).
 */
function proposeSplits(files: SmartDiffInputFile[]): SmartDiff['split_suggestion'] {
  const totalLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  const tooBig = totalLines > SPLIT_TOO_BIG_LINES;
  if (!tooBig) {
    return { too_big: false, total_lines: totalLines, proposed_splits: [] };
  }

  const nonBoilerplate = files.filter((f) => classifyPath(f.path) !== 'boilerplate');
  const boilerplate = files.filter((f) => classifyPath(f.path) === 'boilerplate');

  const byPrefix = new Map<string, string[]>();
  for (const f of nonBoilerplate) {
    const prefix = firstTwoSegments(f.path);
    const list = byPrefix.get(prefix) ?? [];
    list.push(f.path);
    byPrefix.set(prefix, list);
  }

  const proposedSplits: ProposedSplit[] = [...byPrefix.entries()]
    .filter(([, paths]) => paths.length >= SPLIT_MIN_FILES_PER_GROUP)
    .sort(([nameA, a], [nameB, b]) => b.length - a.length || nameA.localeCompare(nameB))
    .slice(0, MAX_PROPOSED_SPLITS)
    .map(([name, paths]) => ({ name, files: [...paths].sort() }));

  if (boilerplate.length > 0) {
    proposedSplits.push({ name: 'chore', files: boilerplate.map((f) => f.path).sort() });
  }

  return { too_big: true, total_lines: totalLines, proposed_splits: proposedSplits };
}
