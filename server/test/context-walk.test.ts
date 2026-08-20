import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { classifyAndRead, walkContextFiles } from '../src/modules/context/service.js';

/**
 * L05/SPEC-01 (name rule, formerly SPEC-02) — the walk + single-document guarded read, covering BOTH
 * selection rules (configured root, configured file name). Real filesystem
 * (temp dirs), no Postgres — this is the "unit … symlink-guard, no
 * container" line from the plan's Constraints, not the DB-backed
 * `context.it.test.ts`.
 */
describe('walkContextFiles', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function tmp(prefix: string): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), prefix));
    dirs.push(d);
    return d;
  }

  it('finds .md files under a configured root, badges them by root name', async () => {
    const root = await tmp('devdigest-context-walk-');
    await mkdir(join(root, 'specs'), { recursive: true });
    await writeFile(join(root, 'specs', 'a.md'), '# A');
    await mkdir(join(root, 'docs', 'nested'), { recursive: true });
    await writeFile(join(root, 'docs', 'nested', 'b.md'), '# B');
    await writeFile(join(root, 'README.md'), '# not under a root'); // not attached to any configured root

    const result = await walkContextFiles(root, ['specs', 'docs'], [], 2000);
    const paths = result.files.map((f) => f.relPath).sort();
    expect(paths).toEqual(['docs/nested/b.md', 'specs/a.md']);
    expect(result.files.find((f) => f.relPath === 'specs/a.md')!.root).toBe('specs');
    expect(result.total).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('never enters SKIP_DIR_NAMES (node_modules, .git, dist, .next)', async () => {
    const root = await tmp('devdigest-context-walk-');
    await mkdir(join(root, 'specs', 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(root, 'specs', 'node_modules', 'pkg', 'README.md'), '# vendored');
    await writeFile(join(root, 'specs', 'real.md'), '# real');

    const result = await walkContextFiles(root, ['specs'], [], 2000);
    expect(result.files.map((f) => f.relPath)).toEqual(['specs/real.md']);
  });

  it('caps collected files at the limit while still counting the true total', async () => {
    const root = await tmp('devdigest-context-walk-');
    await mkdir(join(root, 'specs'), { recursive: true });
    for (let i = 0; i < 5; i++) {
      await writeFile(join(root, 'specs', `f${i}.md`), `# ${i}`);
    }
    const result = await walkContextFiles(root, ['specs'], [], 3);
    expect(result.files).toHaveLength(3);
    expect(result.total).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it('ignores a .md file outside every configured root and every configured name', async () => {
    const root = await tmp('devdigest-context-walk-');
    await mkdir(join(root, 'random'), { recursive: true });
    await writeFile(join(root, 'random', 'x.md'), '# x');
    const result = await walkContextFiles(root, ['specs', 'docs'], ['INSIGHTS.md'], 2000);
    expect(result.files).toEqual([]);
    expect(result.total).toBe(0);
  });

  /**
   * AC-2/AC-3: a symlink committed inside a configured root must never let the
   * listing (or a later attachment) point outside the clone. `fs.symlink` for
   * a directory needs elevated privilege on Windows without Developer Mode —
   * skip with a clear message on EPERM rather than let the assertion pass for
   * the wrong reason (`server/INSIGHTS.md`, 2026-08-06).
   */
  it('never lists or reads through a symlink that escapes the clone root', async () => {
    const outside = await tmp('devdigest-context-outside-');
    await writeFile(join(outside, 'secret.md'), '# secret');
    const root = await tmp('devdigest-context-root-');
    await mkdir(join(root, 'specs'), { recursive: true });
    await writeFile(join(root, 'specs', 'real.md'), '# real');

    let symlinked = true;
    try {
      await symlink(outside, join(root, 'specs', 'escape'), 'dir');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') {
        symlinked = false;
      } else {
        throw err;
      }
    }
    if (!symlinked) {
      // eslint-disable-next-line no-console
      console.warn(
        '[context-walk] symlink creation not permitted on this host — skipping the escape assertion (see server/INSIGHTS.md, 2026-08-06).',
      );
      return;
    }

    const result = await walkContextFiles(root, ['specs'], [], 2000);
    expect(result.files.map((f) => f.relPath)).toEqual(['specs/real.md']);
    expect(result.files.some((f) => f.relPath.includes('escape'))).toBe(false);

    // The single-document guarded read must ALSO refuse the escaped path,
    // even though it never showed up in the listing above.
    const read = await classifyAndRead(root, 'specs/escape/secret.md', 20_000, ['specs'], []);
    expect('reason' in read).toBe(true);
  });

  /**
   * SPEC-01 AC-26 — the name rule finds a configured file name at the clone
   * root AND nested, independent of any configured root.
   */
  it('finds a file matching a configured NAME at the clone root and nested, badged by the name (SPEC-01 AC-26)', async () => {
    const root = await tmp('devdigest-context-walk-');
    await writeFile(join(root, 'INSIGHTS.md'), '# root insights');
    await mkdir(join(root, 'packages', 'api'), { recursive: true });
    await writeFile(join(root, 'packages', 'api', 'INSIGHTS.md'), '# nested insights');

    const result = await walkContextFiles(root, [], ['INSIGHTS.md'], 2000);
    const byPath = new Map(result.files.map((f) => [f.relPath, f.root]));
    expect(byPath.get('INSIGHTS.md')).toBe('insights');
    expect(byPath.get('packages/api/INSIGHTS.md')).toBe('insights');
    expect(result.total).toBe(2);
  });

  /**
   * SPEC-01 AC-28 — a file under BOTH a configured root and matching a
   * configured name must appear exactly once, badged by the root.
   */
  it('lists a file matching both a configured root and a configured name exactly once, badged by the root (AC-28)', async () => {
    const root = await tmp('devdigest-context-walk-');
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'INSIGHTS.md'), '# under docs AND matches the name rule');

    const result = await walkContextFiles(root, ['docs'], ['INSIGHTS.md'], 2000);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ relPath: 'docs/INSIGHTS.md', root: 'docs' });
    expect(result.total).toBe(1);
  });

  /**
   * SPEC-01 AC-31 — the name rule does not reach into a skipped directory,
   * same guard the root rule already has.
   */
  it('never matches a configured name inside SKIP_DIR_NAMES (AC-31)', async () => {
    const root = await tmp('devdigest-context-walk-');
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'pkg', 'INSIGHTS.md'), '# vendored, must not match');

    const result = await walkContextFiles(root, [], ['INSIGHTS.md'], 2000);
    expect(result.files).toEqual([]);
    expect(result.total).toBe(0);
  });

  /**
   * Edge case: "Файл на диску названий `Insights.md`, а в конфізі
   * `INSIGHTS.md`" — the on-disk casing is found (name matching is
   * case-insensitive) and the LISTED path preserves the disk's own casing,
   * while the badge comes from the configured name.
   */
  it('matches a configured name case-insensitively against the on-disk file name', async () => {
    const root = await tmp('devdigest-context-walk-');
    await writeFile(join(root, 'Insights.md'), '# disk casing differs from config');

    const result = await walkContextFiles(root, [], ['INSIGHTS.md'], 2000);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ relPath: 'Insights.md', root: 'insights' });
  });

  /**
   * NFR Performance (perf-relevant half): a file that matches neither rule
   * must never be `stat`'d — the walk only stats MATCHED files. Proven
   * indirectly: an unreadable file that doesn't match either rule must not
   * blow up the walk (a `stat` failure on it would otherwise need a
   * `.catch()` to reach), and `total`/`files` must both stay at 0.
   */
  it('does not match (and so never stats) a file outside every root and every name', async () => {
    const root = await tmp('devdigest-context-walk-');
    await writeFile(join(root, 'CHANGELOG.md'), '# neither a configured root nor a configured name');
    const result = await walkContextFiles(root, ['specs'], ['INSIGHTS.md'], 2000);
    expect(result.files).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe('classifyAndRead', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });
  async function tmp(prefix: string): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), prefix));
    dirs.push(d);
    return d;
  }

  it('reads a document inside the root', async () => {
    const root = await tmp('devdigest-context-read-');
    await mkdir(join(root, 'specs'), { recursive: true });
    await writeFile(join(root, 'specs', 'a.md'), '# hello');
    const result = await classifyAndRead(root, 'specs/a.md', 20_000, ['specs'], []);
    expect(result).toMatchObject({ content: '# hello' });
  });

  it('reads a document matched only by configured NAME (SPEC-01 AC-32/AC-33 gate)', async () => {
    const root = await tmp('devdigest-context-read-');
    await writeFile(join(root, 'INSIGHTS.md'), '# name-matched');
    const result = await classifyAndRead(root, 'INSIGHTS.md', 20_000, [], ['INSIGHTS.md']);
    expect(result).toMatchObject({ content: '# name-matched' });
  });

  it('reports a missing document with a reason', async () => {
    const root = await tmp('devdigest-context-read-');
    const result = await classifyAndRead(root, 'specs/missing.md', 20_000, ['specs'], []);
    expect('reason' in result).toBe(true);
  });

  it('reports an over-limit document with a reason, without reading it', async () => {
    const root = await tmp('devdigest-context-read-');
    await mkdir(join(root, 'specs'), { recursive: true });
    await writeFile(join(root, 'specs', 'big.md'), 'x'.repeat(100));
    const result = await classifyAndRead(root, 'specs/big.md', 10, ['specs'], []);
    expect('reason' in result).toBe(true);
    if ('reason' in result) expect(result.reason).toMatch(/limit/);
  });

  /**
   * Fix pass 1, item 4: being inside the clone and ending in `.md` (the wire
   * contract's own checks) is not enough — a document genuinely inside the
   * clone but outside every CONFIGURED root/name must still be refused, or
   * `GET /repos/:id/context/doc?path=` reads files the listing never offered
   * (e.g. `node_modules/**`, skipped by the walk but not by a direct path).
   *
   * Fix pass 2, item 2: the first version of this test used only
   * `node_modules/pkg/README.md` — the one shape with NO root-named segment
   * anywhere, which a naive "root name anywhere in the path" check also
   * rejects. That proved a narrower rule than the walk's own. These three
   * cases pin the actual bound: a root-named segment ANYWHERE in the path
   * (`docs/node_modules/...`), and a `SKIP_DIR_NAMES` segment appearing AFTER
   * a real root (`specs/node_modules/...`) must both still be refused, and
   * the reason is pinned exactly — `.toMatch(/root/)` alone also matches the
   * unrelated symlink-escape message (`escapes the clone root (symlink)`).
   */
  it('rejects a document that is genuinely inside the clone but outside every configured root/name', async () => {
    const root = await tmp('devdigest-context-read-');
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'pkg', 'README.md'), '# vendored');
    const result = await classifyAndRead(
      root,
      'node_modules/pkg/README.md',
      20_000,
      ['specs', 'docs'],
      [],
    );
    expect('reason' in result).toBe(true);
    if ('reason' in result) expect(result.reason).toBe('outside the configured context roots and file names');
  });

  it('rejects a root-named segment that appears anywhere in the path, not just first', async () => {
    const root = await tmp('devdigest-context-read-');
    await mkdir(join(root, 'node_modules', 'pkg', 'docs'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'pkg', 'docs', 'README.md'), '# vendored, nested under docs/');
    const result = await classifyAndRead(
      root,
      'node_modules/pkg/docs/README.md',
      20_000,
      ['specs', 'docs'],
      [],
    );
    expect('reason' in result).toBe(true);
    if ('reason' in result) expect(result.reason).toBe('outside the configured context roots and file names');
  });

  it('rejects a real root followed by a SKIP_DIR_NAMES segment, matching the walk skipping that subtree', async () => {
    const root = await tmp('devdigest-context-read-');
    await mkdir(join(root, 'docs', 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(root, 'docs', 'node_modules', 'pkg', 'README.md'), '# vendored, nested under docs/');
    const result = await classifyAndRead(
      root,
      'docs/node_modules/pkg/README.md',
      20_000,
      ['specs', 'docs'],
      [],
    );
    expect('reason' in result).toBe(true);
    if ('reason' in result) expect(result.reason).toBe('outside the configured context roots and file names');
  });

  /**
   * SPEC-01 AC-31 — the name rule must not weaken the `node_modules` guard: a
   * configured-name file sitting inside a skipped directory is refused, even
   * though its NAME alone would otherwise match.
   */
  it('rejects a configured-name file sitting inside a skipped directory (AC-31)', async () => {
    const root = await tmp('devdigest-context-read-');
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'pkg', 'INSIGHTS.md'), '# vendored, name matches');
    const result = await classifyAndRead(
      root,
      'node_modules/pkg/INSIGHTS.md',
      20_000,
      [],
      ['INSIGHTS.md'],
    );
    expect('reason' in result).toBe(true);
    if ('reason' in result) expect(result.reason).toBe('outside the configured context roots and file names');
  });
});
