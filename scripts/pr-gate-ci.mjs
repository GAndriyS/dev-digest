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
 *                   One narrow exception: the vendored UI kit may be edited in
 *                   place when the PR body carries a `Vendor-update: <path>`
 *                   line naming each file. The rule is not relaxed by that line
 *                   — it is made VISIBLE. "fix upstream, then re-vendor" cannot
 *                   be verified by CI, but "the author stated this in the PR
 *                   body, next to the diff" can, and a reviewer can then judge
 *                   the claim. An undeclared edit still fails exactly as before.
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

/**
 * Changed paths with their git status letter (A added, M modified, D deleted,
 * R renamed). The status matters: "never edit an applied migration" must not
 * fire on a NEWLY ADDED one, which is exactly what the convention tells you to
 * write instead. A name-only diff cannot tell the two apart, so the rule used to
 * block every schema change it was meant to permit.
 */
const changedWithStatus = git(['diff', '--name-status', `${BASE}...HEAD`])
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [status, ...rest] = line.split('\t');
    // A rename is `R096<TAB>old<TAB>new` — the last field is the current path.
    return { status: status.charAt(0), file: rest[rest.length - 1] };
  })
  .filter((e) => e.file);

const changed = changedWithStatus.map((e) => e.file);
const statusOf = new Map(changedWithStatus.map((e) => [e.file, e.status]));

const violations = [];
const notes = [];

const body = BODY_FILE ? readBodyOrEmpty(BODY_FILE) : '';

function readBodyOrEmpty(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Paths named on `Vendor-update:` lines in the PR body. One line may name
 * several files (comma- or space-separated), and there may be several lines.
 * Backticks and a leading `./` are tolerated because PR bodies are written by
 * hand; a bare directory is NOT — the declaration has to be as specific as the
 * diff it excuses, or it degenerates into "vendor changes allowed".
 */
function declaredVendorUpdates(prBody) {
  const declared = new Set();
  for (const [, rest] of prBody.matchAll(/^[ \t]*Vendor-update:[ \t]*(.+)$/gim)) {
    for (const token of rest.split(/[\s,;]+/)) {
      const path = token.replace(/[`'"]/g, '').replace(/\\/g, '/').replace(/^\.\//, '');
      if (path.includes('/') && !path.endsWith('/')) declared.add(path);
    }
  }
  return declared;
}

// --- do-not-touch (AGENTS.md) ------------------------------------------------
const VENDOR_UI = /^(client|server)\/src\/vendor\/ui\//;
const FORBIDDEN = [
  { re: /^server\/clones\//, why: 'runtime clone checkouts are not source' },
  {
    re: /^server\/src\/db\/migrations\/.*\.sql$/,
    why: 'migrations are applied — add a new one instead of editing history',
    // Adding a migration IS the prescribed fix, so only an edit is a violation.
    addedIsFine: true,
  },
  { re: VENDOR_UI, why: 'vendored UI kit — fix upstream, then re-vendor' },
];
const declaredVendor = declaredVendorUpdates(body);
const acceptedVendor = [];
let sawUndeclaredVendor = false;
for (const file of changed) {
  const hit = FORBIDDEN.find((f) => f.re.test(file));
  if (!hit) continue;
  if (hit.addedIsFine && statusOf.get(file) === 'A') continue;
  // The only exception, and only for the vendored kit: clones and applied
  // migrations have no declaration that could make editing them correct.
  if (VENDOR_UI.test(file) && declaredVendor.has(file)) {
    acceptedVendor.push(file);
    continue;
  }
  if (VENDOR_UI.test(file)) sawUndeclaredVendor = true;
  violations.push(`do-not-touch: ${file} — ${hit.why}`);
}
if (acceptedVendor.length) {
  // Printed, not silent: the point of the exception is that the reviewer sees
  // which vendored files were edited in place and can check the claim.
  notes.push(
    `do-not-touch: ${acceptedVendor.length} vendored file(s) edited in place and declared ` +
      `in the PR body — ${acceptedVendor.join(', ')}. Review these against upstream.`
  );
}
if (sawUndeclaredVendor) {
  notes.push(
    `do-not-touch: a vendored UI file may be edited in place only when the PR body has a ` +
      `line "Vendor-update: <path>" naming it. Declaring it does not make the edit right — ` +
      `it puts the claim in front of the reviewer.`
  );
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
