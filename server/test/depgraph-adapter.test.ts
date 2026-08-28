/**
 * depgraph adapter — the real dependency-cruiser wrapper against a tmpdir clone.
 *
 * Everything else stubs `buildEdges`, so the writer that fills `file_edges` had
 * no coverage at all. Two ways it degraded to an empty graph, both silent
 * because buildEdges swallows its failures: cruise resolves inputs as
 * `join(baseDir, path)`, so the absolute paths it used to be handed threw
 * ENOENT; and the paths it echoes back must match the walker's POSIX file set,
 * which a win32 `relative()` never does. An empty graph leaves decl_file
 * unresolved, and with it every blast caller and endpoint.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DepCruiseGraph } from '../src/adapters/depgraph/index.js';

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents);
}

describe('DepCruiseGraph.buildEdges', () => {
  let root: string;

  beforeEach(async () => {
    // `realpath` on purpose: on macOS `tmpdir()` is `/var/folders/…`, a symlink
    // to `/private/var/folders/…`. dependency-cruiser echoes back paths relative
    // to the REAL directory, which then match none of the file set we passed —
    // buildEdges swallows that and returns [], so both assertions below failed
    // on this machine only. Linux CI has no such symlink and never saw it.
    root = await realpath(await mkdtemp(join(tmpdir(), 'depgraph-')));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('resolves local import edges with POSIX-separated repo-relative paths', async () => {
    await writeFileAt(root, 'src/util.ts', `export function alpha() { return 1; }\n`);
    await writeFileAt(
      root,
      'src/caller.ts',
      `import { alpha } from './util.js';\nexport function caller() { return alpha(); }\n`,
    );

    const files = ['src/util.ts', 'src/caller.ts'];
    const edges = await new DepCruiseGraph().buildEdges(root, files);

    expect(edges).toContainEqual({ from: 'src/caller.ts', to: 'src/util.ts' });
    // The regression itself: any backslash here means the file set never matches.
    for (const e of edges) {
      expect(e.from).not.toContain('\\');
      expect(e.to).not.toContain('\\');
    }
  });

  it('reaches files under a root outside the process cwd', async () => {
    // The tmpdir root is not below cwd (and on Windows may be another drive):
    // handing cruise absolute paths made it stat `cwd + root + file` and throw.
    await writeFileAt(root, 'a/one.ts', `export const one = 1;\n`);
    await writeFileAt(root, 'b/two.ts', `import { one } from '../a/one.js';\nexport const two = one;\n`);

    const edges = await new DepCruiseGraph().buildEdges(root, ['a/one.ts', 'b/two.ts']);
    expect(edges).toEqual([{ from: 'b/two.ts', to: 'a/one.ts' }]);
  });

  it('returns [] for an empty file list without invoking cruise', async () => {
    expect(await new DepCruiseGraph().buildEdges(root, [])).toEqual([]);
  });

  it('skips imports of files outside the indexed set', async () => {
    await writeFileAt(root, 'src/util.ts', `export function alpha() { return 1; }\n`);
    await writeFileAt(root, 'src/caller.ts', `import { alpha } from './util.js';\n`);

    // util.ts deliberately omitted from the set — an unindexed target is not an edge.
    const edges = await new DepCruiseGraph().buildEdges(root, ['src/caller.ts']);
    expect(edges).toEqual([]);
  });
});
