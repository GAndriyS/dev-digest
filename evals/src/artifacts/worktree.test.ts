/**
 * Model-free check that fixture materialization actually yields what the agent cases assume:
 * the diff is applied, `git diff` shows it verbatim, the gates' inputs exist. Uses real git
 * against this repo's HEAD — a few hundred ms, no tokens.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { EVALS_DIR, REPO_ROOT } from "./paths.js";
import { materializedWorktree } from "./worktree.js";

// The real cases file's fixtures — the test must break when they do.
const CASES_URL = pathToFileURL(
  join(EVALS_DIR, "agents", "architecture-reviewer", "architecture-reviewer.cases.ts"),
).href;

const gitOut = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

describe("materializedWorktree", () => {
  test("applies the checkout diff onto the pre-image; git diff shows it; cleanup deregisters", () => {
    const ws = materializedWorktree(CASES_URL, "checkout-service.diff");
    try {
      // The violation the case greps for is IN the tree, not just in the prompt.
      const domain = readFileSync(join(ws.cwd, "server/src/modules/checkout/domain/checkout.ts"), "utf8");
      expect(domain).toContain("FastifyReply");
      // The applied change is the ONLY uncommitted delta — `git diff` is the fixture diff.
      const diff = gitOut(ws.cwd, "diff");
      expect(diff).toContain("+import type { FastifyReply }");
      expect(diff).toContain("+  private repo = new PgCheckoutRepository();");
      // The node_modules SYMLINKS show as untracked (`node_modules/` in .gitignore matches only
      // directories) — everything else must be exactly the applied modifications.
      const status = gitOut(ws.cwd, "status", "--porcelain")
        .split("\n")
        .filter(Boolean)
        .filter((l) => !l.includes("node_modules"));
      expect(status.every((l) => l.startsWith(" M"))).toBe(true);
      // node_modules symlinked so depcruise/tsc can actually run (skipped if never installed).
      if (existsSync(join(REPO_ROOT, "server", "node_modules"))) {
        expect(existsSync(join(ws.cwd, "server", "node_modules"))).toBe(true);
      }
    } finally {
      ws.cleanup();
    }
    expect(existsSync(ws.cwd)).toBe(false);
    // Deregistered from the main repo, not just deleted — a stale registration blocks pruning.
    expect(gitOut(REPO_ROOT, "worktree", "list")).not.toContain(ws.cwd);
  });

  test("reviewer-core fixture: pre-image files exist only in the worktree, gate targets intact", () => {
    const ws = materializedWorktree(CASES_URL, "reviewer-core-gate.diff");
    try {
      const run = readFileSync(join(ws.cwd, "reviewer-core/src/pipeline/run.ts"), "utf8");
      expect(run).toContain('import { readFileSync } from "node:fs"');
      expect(run).not.toContain("groundFindings");
      // The contract the attribution practice points at is reachable in-tree.
      expect(existsSync(join(ws.cwd, "reviewer-core/AGENTS.md"))).toBe(true);
      expect(existsSync(join(ws.cwd, "server/.dependency-cruiser.cjs"))).toBe(true);
      // The overlay never leaks into the real repo.
      expect(existsSync(join(REPO_ROOT, "reviewer-core/src/pipeline"))).toBe(false);
    } finally {
      ws.cleanup();
    }
  });
});
