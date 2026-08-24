import type { RepoIntel } from '../repo-intel/types.js';
import { MAX_FILE_BYTES, MAX_MANIFEST_DIRS, RUN_CONFIG_FILES, TASK_SCAN_FILES, TOP_FILES_N } from './constants.js';
import { scanTodoMarkers, siblingTestCandidates } from './helpers.js';
import type { FirstTaskSignal, OnboardingFacts, SampleFile } from './types.js';

/**
 * Onboarding tour generator — facts collection (A9).
 *
 * Module-private and testable WITHOUT Postgres: `read` is injected, so a unit
 * can point `collectFacts` at a temp directory + a fake `repoIntel` object
 * (AC-39/AC-40) instead of a real clone and a real DB-backed facade. The
 * service wires the real implementations (`container.repoIntel`,
 * `readInsideClone` bound to the `realpath`'d clone root).
 */

/** Bound reader — `readInsideClone(root, relPath, maxBytes)` with `root` closed over. */
export type ReadFn = (relPath: string, maxBytes: number) => Promise<string | null>;

export interface CollectFactsDeps {
  repoIntel: RepoIntel;
  /** The `realpath`'d clone root — unused directly here (kept for callers/tests that need it), reads go through `read`. */
  root: string;
  read: ReadFn;
}

/** First path segment of each entry, de-duplicated, order preserved (monorepo edge case). */
function uniqueFirstSegments(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const seg = p.split('/')[0];
    if (!seg || seen.has(seg)) continue;
    seen.add(seg);
    out.push(seg);
  }
  return out;
}

export async function collectFacts(repoId: string, deps: CollectFactsDeps): Promise<OnboardingFacts> {
  const { repoIntel, read } = deps;

  // One `getTopFilesByRank` call, sized to cover BOTH consumers below.
  // `TASK_SCAN_FILES` (20) is larger than `TOP_FILES_N` (12): fetching only
  // `TOP_FILES_N` and then `.slice(0, TASK_SCAN_FILES)` on that same
  // 12-length array was a no-op — the scan never saw files ranked 13-20.
  const [rankedFiles, criticalPaths] = await Promise.all([
    repoIntel.getTopFilesByRank(repoId, Math.max(TOP_FILES_N, TASK_SCAN_FILES)),
    repoIntel.getCriticalPaths(repoId),
  ]);
  // `facts.topFiles` (reading-path order, manifest-dir discovery,
  // critical-path link ordering) stays bounded to TOP_FILES_N — only the
  // first_tasks scan below is meant to look further down the rank.
  const topFiles = rankedFiles.slice(0, TOP_FILES_N);

  const manifestDirs = uniqueFirstSegments(topFiles).slice(0, MAX_MANIFEST_DIRS);
  const runCandidates: string[] = [
    ...RUN_CONFIG_FILES,
    ...manifestDirs.map((seg) => `${seg}/package.json`),
  ];
  const runReads = await Promise.all(
    runCandidates.map(async (path): Promise<SampleFile | null> => {
      const content = await read(path, MAX_FILE_BYTES);
      return content === null ? null : { path, content };
    }),
  );
  const runFiles: SampleFile[] = runReads.filter((f): f is SampleFile => f !== null);

  const scanFiles = rankedFiles.slice(0, TASK_SCAN_FILES);
  const taskSignals: FirstTaskSignal[] = [];
  for (const path of scanFiles) {
    const content = await read(path, MAX_FILE_BYTES);
    if (content !== null) taskSignals.push(...scanTodoMarkers(path, content));

    // A14 asked for a `maxBytes: 1` existence-only probe; `readInsideClone`
    // rejects anything OVER the byte cap, so `maxBytes: 1` would report every
    // real (non-empty) sibling test file as absent. Reusing `MAX_FILE_BYTES`
    // keeps the probe actually correct while adding no new read primitive —
    // deviation recorded in the implementation report.
    let hasSiblingTest = false;
    for (const candidate of siblingTestCandidates(path)) {
      const found = await read(candidate, MAX_FILE_BYTES);
      if (found !== null) {
        hasSiblingTest = true;
        break;
      }
    }
    if (!hasSiblingTest) taskSignals.push({ path, kind: 'missing_test', excerpt: '' });
  }

  return { topFiles, criticalPaths, runFiles, taskSignals };
}
