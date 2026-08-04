#!/usr/bin/env node
/**
 * PR self-review gate — stamp validator.
 *
 * Wired as a PreToolUse hook on `gh pr create` (see .claude/settings.json). It
 * does NOT review anything: reviewing is what `/pr-self-review` does, and it is
 * slow. This only answers one question in milliseconds — "is there a fresh,
 * passing review for exactly this working tree?" — so the hook never adds
 * latency to unrelated work.
 *
 * Stamp: .git/pr-self-review.json, written by the skill. It lives inside .git/
 * so it is untracked by construction and cannot be committed by accident.
 *
 *   { head_sha, tree_hash, verdict: "PASS"|"BLOCKED",
 *     critical_count, mode: "blocking"|"report-only", created_at }
 *
 * Freshness is HEAD + working tree, not a timestamp: a review of a different
 * tree is worthless no matter how recent. `mode` is read from the STAMP rather
 * than from routing.md on purpose — the run that produced the verdict decides
 * how it is enforced, so flipping the mode mid-flight cannot retroactively
 * unblock a review that was made under blocking rules.
 *
 * Run:  node scripts/pr-gate-check.mjs   (reads the hook payload on stdin;
 *                                          with no stdin it just checks)
 * Exit: 0 allow · 2 block (stderr is fed back to the agent)
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const STAMP_PATH = '.git/pr-self-review.json';
const REVIEW_CMD = '/pr-self-review';

/** Matches `gh pr create` even when chained or prefixed (`cd x && gh pr create`). */
const GH_PR_CREATE = /(^|[;&|]|\s)gh\s+pr\s+create\b/;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function block(lines) {
  console.error(lines.join('\n'));
  process.exit(2);
}

// --- 1. Is this call even in scope? ------------------------------------------
// settings.json already narrows with `if: "Bash(gh pr create*)"`, but that only
// matches a command that STARTS with the prefix. Re-check here so a chained or
// wrapped invocation cannot slip past.
let payload = {};
try {
  const raw = readFileSync(0, 'utf8');
  if (raw.trim()) payload = JSON.parse(raw);
} catch {
  // No stdin (manual run) — fall through and validate.
}
const command = payload?.tool_input?.command ?? '';
if (payload.tool_name && !GH_PR_CREATE.test(command)) process.exit(0);

// --- 2. Read the stamp -------------------------------------------------------
let stamp;
try {
  stamp = JSON.parse(readFileSync(STAMP_PATH, 'utf8'));
} catch {
  block([
    `Blocked: no PR self-review has been run for this branch.`,
    `Run ${REVIEW_CMD} first — it reviews the diff with the repo's skills and`,
    `writes ${STAMP_PATH}. Opening a PR without it skips the gate entirely.`,
  ]);
}

// --- 3. Freshness: does the stamp describe THIS tree? ------------------------
const head = git(['rev-parse', 'HEAD']).trim();
// --untracked-files=all so a new unreviewed file invalidates the stamp; `git
// diff HEAD` alone would not see it.
const treeHash = createHash('sha256')
  .update(git(['status', '--porcelain=v1', '--untracked-files=all']))
  .update(git(['diff', 'HEAD']))
  .digest('hex')
  .slice(0, 16);

if (stamp.head_sha !== head) {
  block([
    `Blocked: the PR self-review is stale — HEAD moved since it ran.`,
    `  reviewed: ${String(stamp.head_sha).slice(0, 12)}`,
    `  current:  ${head.slice(0, 12)}`,
    `Re-run ${REVIEW_CMD}.`,
  ]);
}

if (stamp.tree_hash !== treeHash) {
  block([
    `Blocked: the PR self-review is stale — the working tree changed since it ran.`,
    `Uncommitted edits are part of what a PR would carry, so the review no longer`,
    `covers what you are about to open. Re-run ${REVIEW_CMD}.`,
  ]);
}

// --- 4. Verdict --------------------------------------------------------------
if (stamp.verdict !== 'PASS') {
  const n = stamp.critical_count ?? 0;
  if (stamp.mode === 'report-only') {
    // Adoption phase: findings are advisory, so surface them and let it through.
    console.error(
      `PR self-review found ${n} critical finding(s), but the review ran in ` +
        `report-only mode — not blocking. See .claude/reviews/.`
    );
    process.exit(0);
  }
  block([
    `Blocked: the PR self-review found ${n} critical finding(s).`,
    `Read .claude/reviews/ for the report. Fix them, or waive one with a stated`,
    `reason (see .claude/skills/pr-self-review/waivers.md), then re-run ${REVIEW_CMD}.`,
  ]);
}

process.exit(0);
