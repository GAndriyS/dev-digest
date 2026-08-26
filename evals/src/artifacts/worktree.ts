/**
 * Materialize a fixture diff into a REAL git worktree, so a tool-using agent under eval reviews
 * an applied change the way production does — `git diff` shows exactly the fixture diff, and the
 * machine gates (tsc, depcruise) can actually run against the tree.
 *
 * Why this exists (measured 2026-08-26): the architecture-reviewer fixtures used to arrive as
 * diffs PASTED into the prompt against files the repo does not contain. The agent — correctly —
 * checked the working tree, found no target, and refused to review; and the one fixture that DID
 * pass did so only because its files happened to be lying around as untracked scratch. A pasted
 * diff also makes any rule-id practice unreachable: depcruise runs against the live repo, which
 * is green, so the rule name (`core-has-no-io`) appears in no tool output and citing it becomes a
 * memory test. Materializing turns both problems into non-problems: the target exists, the gate
 * fires, the evidence is in the tree.
 *
 * Mechanics per case run:
 *   1. `git worktree add --detach <tmp> HEAD` — the current commit, never the dirty tree, so a
 *      half-edited session cannot leak into the measurement.
 *   2. Copy the case's `fixtures/tree/` overlay (pre-image files the diff needs as context) and
 *      commit it, so step 3's apply lands as the ONLY uncommitted change.
 *   3. `git apply` the fixture diff — `git diff` in the worktree now prints it verbatim.
 *   4. Symlink each package's real `node_modules` (gitignored, so absent from a fresh worktree) —
 *      without this, "run the gate" degrades to "read the config" and the reachability point of
 *      the whole exercise is lost. Missing installs are skipped, not fatal: in CI only `evals/`
 *      installs, and the agent falls back to reading configs, which still works.
 *
 * cleanup() must run in a `finally`: a leaked worktree keeps a lock entry in the main repo's
 * .git/worktrees until someone prunes it.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT } from "./paths.js";

export interface Workspace {
  /** Absolute path of the materialized tree — pass as `cwd` to the task. */
  cwd: string;
  /** Remove the worktree and its registration. Always call from a `finally`. */
  cleanup: () => void;
}

const git = (cwd: string, ...args: string[]): void => {
  execFileSync("git", ["-C", cwd, ...args], { stdio: ["ignore", "pipe", "pipe"] });
};

// Symlinked so the gates can run; skipped when the package was never installed here.
const PACKAGES = ["server", "client", "reviewer-core", "e2e", "mcp", "evals"];

/**
 * Build a worktree with `fixtures/tree/` committed and `fixtures/<diffName>` applied on top.
 * Pass `import.meta.url` of the cases file, same convention as fixtureReader.
 */
export function materializedWorktree(metaUrl: string, diffName: string): Workspace {
  const fixtures = join(dirname(fileURLToPath(metaUrl)), "fixtures");
  const parent = mkdtempSync(join(tmpdir(), "eval-worktree-"));
  const dir = join(parent, "tree");

  const cleanup = (): void => {
    // Removal can race a dying session that still holds a file open; prune covers the remainder.
    try {
      git(REPO_ROOT, "worktree", "remove", "--force", dir);
    } catch {
      /* fall through to prune */
    }
    try {
      git(REPO_ROOT, "worktree", "prune");
    } catch {
      /* best effort */
    }
    rmSync(parent, { recursive: true, force: true });
  };

  try {
    git(REPO_ROOT, "worktree", "add", "--detach", dir, "HEAD");
    const tree = join(fixtures, "tree");
    if (existsSync(tree)) {
      cpSync(tree, dir, { recursive: true });
      git(dir, "add", "-A");
      // -c identity: CI runners have no git user configured. The message is deliberately mundane —
      // the agent under eval reads `git log`, and a commit that says "fixture" is contamination.
      git(
        dir,
        "-c", "user.email=dev@devdigest.local",
        "-c", "user.name=DevDigest",
        "commit", "-q", "-m", "chore: scaffold pending modules",
      );
    }
    git(dir, "apply", join(fixtures, diffName));
    for (const pkg of PACKAGES) {
      const src = join(REPO_ROOT, pkg, "node_modules");
      const dst = join(dir, pkg, "node_modules");
      if (existsSync(src) && existsSync(join(dir, pkg)) && !existsSync(dst)) symlinkSync(src, dst);
    }
  } catch (err) {
    cleanup();
    throw err;
  }

  return { cwd: dir, cleanup };
}
