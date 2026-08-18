import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { classifyAndRead, walkContextFiles } from '../src/modules/context/service.js';

/**
 * L05 — the walk + single-document guarded read. Real filesystem (temp dirs),
 * no Postgres — this is the "unit … symlink-guard, no container" line from
 * the plan's Constraints, not the DB-backed `context.it.test.ts`.
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

    const result = await walkContextFiles(root, ['specs', 'docs'], 2000);
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

    const result = await walkContextFiles(root, ['specs'], 2000);
    expect(result.files.map((f) => f.relPath)).toEqual(['specs/real.md']);
  });

  it('caps collected files at the limit while still counting the true total', async () => {
    const root = await tmp('devdigest-context-walk-');
    await mkdir(join(root, 'specs'), { recursive: true });
    for (let i = 0; i < 5; i++) {
      await writeFile(join(root, 'specs', `f${i}.md`), `# ${i}`);
    }
    const result = await walkContextFiles(root, ['specs'], 3);
    expect(result.files).toHaveLength(3);
    expect(result.total).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it('ignores a .md file outside every configured root', async () => {
    const root = await tmp('devdigest-context-walk-');
    await mkdir(join(root, 'random'), { recursive: true });
    await writeFile(join(root, 'random', 'x.md'), '# x');
    const result = await walkContextFiles(root, ['specs', 'docs'], 2000);
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

    const result = await walkContextFiles(root, ['specs'], 2000);
    expect(result.files.map((f) => f.relPath)).toEqual(['specs/real.md']);
    expect(result.files.some((f) => f.relPath.includes('escape'))).toBe(false);

    // The single-document guarded read must ALSO refuse the escaped path,
    // even though it never showed up in the listing above.
    const read = await classifyAndRead(root, 'specs/escape/secret.md', 20_000, ['specs']);
    expect('reason' in read).toBe(true);
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
    const result = await classifyAndRead(root, 'specs/a.md', 20_000, ['specs']);
    expect(result).toMatchObject({ content: '# hello' });
  });

  it('reports a missing document with a reason', async () => {
    const root = await tmp('devdigest-context-read-');
    const result = await classifyAndRead(root, 'specs/missing.md', 20_000, ['specs']);
    expect('reason' in result).toBe(true);
  });

  it('reports an over-limit document with a reason, without reading it', async () => {
    const root = await tmp('devdigest-context-read-');
    await mkdir(join(root, 'specs'), { recursive: true });
    await writeFile(join(root, 'specs', 'big.md'), 'x'.repeat(100));
    const result = await classifyAndRead(root, 'specs/big.md', 10, ['specs']);
    expect('reason' in result).toBe(true);
    if ('reason' in result) expect(result.reason).toMatch(/limit/);
  });

  /**
   * Fix pass 1, item 4: being inside the clone and ending in `.md` (the wire
   * contract's own checks) is not enough — a document genuinely inside the
   * clone but outside every CONFIGURED root must still be refused, or
   * `GET /repos/:id/context/doc?path=` reads files the listing never offered
   * (e.g. `node_modules/**`, skipped by the walk but not by a direct path).
   */
  it('rejects a document that is genuinely inside the clone but outside every configured root', async () => {
    const root = await tmp('devdigest-context-read-');
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'pkg', 'README.md'), '# vendored');
    const result = await classifyAndRead(root, 'node_modules/pkg/README.md', 20_000, ['specs', 'docs']);
    expect('reason' in result).toBe(true);
    if ('reason' in result) expect(result.reason).toMatch(/root/);
  });
});
