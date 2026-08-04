#!/usr/bin/env node
/**
 * PR self-review gate — the CI half.
 *
 * The local gate (`/pr-self-review` + scripts/pr-gate-check.mjs) is the thorough
 * one, but it cannot hold GitHub's Merge button: only a required check can. CI
 * has no LLM key here by design, so this enforces the subset a machine can
 * decide on its own, and the five existing workflows cover the rest
 * (typecheck / depcruise / check-ui-conventions / tests).
 *
 * What it checks, and why each one is here rather than in prose:
 *
 *   insights      — AGENTS.md: "Every PR body ends with an Insights section."
 *                   Enforced by convention alone until now, which means it was
 *                   enforced by whoever happened to remember.
 *   mirror        — @devdigest/shared exists twice and does not sync itself.
 *                   A wire-crossing change to one copy only is a silent drift.
 *   do-not-touch  — AGENTS.md names three paths that must never be edited:
 *                   runtime clones, applied migrations, the vendored UI kit.
 *   baseline      — scripts/pr-gate-baseline.json is a shrink-only ratchet.
 *                   Growing it re-permits a finding instead of fixing it.
 *
 * Run:  node scripts/pr-gate-ci.mjs --base <sha> [--body-file <path>]
 * Exit: 0 clean · 1 on any violation
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const BASE = argOf('--base');
const BODY_FILE = argOf('--body-file');

if (!BASE) {
  console.error('usage: node scripts/pr-gate-ci.mjs --base <sha> [--body-file <path>]');
  process.exit(1);
}

function git(gitArgs, { quiet = false } = {}) {
  return execFileSync('git', gitArgs, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // `git show <base>:<path>` writes "exists on disk, but not in <sha>" to
    // stderr for a file that is new in this PR. That is an expected branch here,
    // not an error worth printing into the CI log.
    stdio: quiet ? ['ignore', 'pipe', 'ignore'] : undefined,
  });
}

const changed = git(['diff', '--name-only', `${BASE}...HEAD`])
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

const violations = [];
const notes = [];

// --- do-not-touch (AGENTS.md) ------------------------------------------------
const FORBIDDEN = [
  { re: /^server\/clones\//, why: 'runtime clone checkouts are not source' },
  {
    re: /^server\/src\/db\/migrations\/.*\.sql$/,
    why: 'migrations are applied — add a new one instead of editing history',
  },
  { re: /^(client|server)\/src\/vendor\/ui\//, why: 'vendored UI kit — fix upstream, then re-vendor' },
];
for (const file of changed) {
  const hit = FORBIDDEN.find((f) => f.re.test(file));
  if (hit) violations.push(`do-not-touch: ${file} — ${hit.why}`);
}

// --- contract mirror ---------------------------------------------------------
// WARNING-level by design: a type used only by reviewer-core legitimately lives
// in the server copy alone. CI cannot tell the difference, so it reports and
// does not fail. The local gate asks the same question with the diff in hand.
const serverShared = changed.filter((f) => f.startsWith('server/src/vendor/shared/'));
const clientShared = changed.filter((f) => f.startsWith('client/src/vendor/shared/'));
if (serverShared.length && !clientShared.length) {
  notes.push(
    `contract-mirror: ${serverShared.length} file(s) changed under server/src/vendor/shared/ ` +
      `with no matching client change. If the change crosses the wire, mirror it into ` +
      `client/src/vendor/shared/ — that copy does not update itself.`
  );
} else if (clientShared.length && !serverShared.length) {
  violations.push(
    `contract-mirror: client/src/vendor/shared/ changed without the server copy. ` +
      `The server copy is canonical — edit it first, then mirror.`
  );
}

// --- baseline is shrink-only -------------------------------------------------
const BASELINE = 'scripts/pr-gate-baseline.json';
if (changed.includes(BASELINE)) {
  const countOf = (raw) => {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed.findings) ? parsed.findings.length : 0;
    } catch {
      return NaN;
    }
  };
  const after = countOf(readFileSync(BASELINE, 'utf8'));
  let before = 0;
  try {
    before = countOf(git(['show', `${BASE}:${BASELINE}`], { quiet: true }));
  } catch {
    before = 0; // file is new in this PR
  }
  if (Number.isNaN(after)) {
    violations.push(`baseline: ${BASELINE} is not valid JSON`);
  } else if (after > before) {
    violations.push(
      `baseline: ${BASELINE} grew ${before} → ${after}. It is a shrink-only ratchet — ` +
        `a new entry re-permits a finding instead of fixing it.`
    );
  } else if (after < before) {
    notes.push(`baseline: shrank ${before} → ${after}. Good.`);
  }
}

// --- PR body has an Insights section -----------------------------------------
if (BODY_FILE) {
  let body = '';
  try {
    body = readFileSync(BODY_FILE, 'utf8');
  } catch {
    body = '';
  }
  // A heading named Insights, at any level, anywhere in the body. AGENTS.md says
  // "ends with", but trailing bot/attribution footers get appended after it, so
  // requiring literal last-position would fail honest PRs.
  if (!/^#{1,6}\s*Insights\b/m.test(body)) {
    violations.push(
      `insights: the PR body has no "## Insights" section. AGENTS.md requires one — ` +
        `summarise what this branch appended to INSIGHTS.md, or state plainly that ` +
        `nothing was recorded. An empty sweep is a decision; an omission is not.`
    );
  }
} else {
  notes.push('insights: skipped (no --body-file given)');
}

// --- report ------------------------------------------------------------------
for (const n of notes) console.log(`note  ${n}`);
for (const v of violations) console.error(`error ${v}`);

if (violations.length) {
  console.error(`\n${violations.length} PR-gate violation(s).`);
  process.exit(1);
}
console.log(`pr-gate: clean (${changed.length} changed file(s) inspected)`);
