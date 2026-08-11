import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep as pathSep } from 'node:path';

/**
 * Guarded reader for repo clone working trees — shared across modules that
 * read attacker-influenced paths out of a clone (originally `conventions`,
 * now also `reviews`' intent classifier).
 *
 * PROMOTED from `modules/conventions/{helpers.ts,service.ts}` (pure move, no
 * behaviour change) because `no-cross-module-internals`
 * (`.dependency-cruiser.cjs:82-97`) only lets a module import another
 * module's `constants.ts` / `types.ts` / `index.ts`, or `modules/_shared/` —
 * a private service method or a helper wasn't reachable from `reviews`.
 *
 * `server/INSIGHTS.md:24-36` — anything under `server/clones/**` is
 * attacker-controlled; the vector is the SYMLINK, not `..`. Git tree entries
 * cannot contain `..`, so the reachable attack is a committed
 * `tsconfig.json -> ~/.devdigest/secrets.json`-style symlink: `realpath`
 * collapses it before the file is opened, and `isInsideRoot` compares the
 * resolved path against the resolved clone root WITH the separator kept in
 * the prefix — without it, `/clones/repo-evil` would pass as being inside
 * `/clones/repo`.
 */

/**
 * Is `real` the clone root itself, or something beneath it?
 *
 * Both paths must already be resolved (`realpath`), because the whole point is
 * to judge where a file physically IS rather than how it was spelled. The
 * separator in the prefix is not decoration: without it `/clones/repo-evil`
 * passes as being inside `/clones/repo`.
 */
export function isInsideRoot(root: string, real: string, sep = pathSep): boolean {
  return real === root || real.startsWith(root + sep);
}

/**
 * Read one file living inside `root` (an already-`realpath`'d clone root), or
 * `null` for anything that is not a plain file there — including a path that
 * escapes `root` via a symlink, one over `maxBytes`, or one that simply
 * cannot be read.
 */
export async function readInsideClone(
  root: string,
  relPath: string,
  maxBytes: number,
): Promise<string | null> {
  const real = await realpath(resolve(root, relPath)).catch(() => null);
  if (real === null) return null;
  if (!isInsideRoot(root, real)) return null;

  const info = await stat(real).catch(() => null);
  if (info === null || !info.isFile() || info.size > maxBytes) return null;

  return readFile(real, 'utf8').catch(() => null);
}
