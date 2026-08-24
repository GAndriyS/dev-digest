#!/usr/bin/env node
/**
 * verify.mjs — run a package's CI lane locally and print only what matters.
 *
 * Why this exists: every agent in .claude/agents/ used to inline the lane
 * commands and read the FULL output of tsc + depcruise + vitest after every
 * edit. On a 40-file test suite that is thousands of tokens of "✓ passed" per
 * run, repeated four to five times per feature (implementer, test-writer,
 * architecture-reviewer, plan-verifier, /pr-self-review). This script runs the
 * same commands CI runs (copied from .github/workflows/*.yml — keep them in
 * step) and prints ONE line per gate, plus the verbatim tail of a gate's
 * output only when it FAILED.
 *
 * It is a repo-root script on purpose: server/package.json is skip-worktree in
 * some checkouts, which is why CI inlines the commands instead of calling
 * `pnpm test:unit`. Nothing here depends on the package scripts that can drift.
 *
 * Usage:
 *   node scripts/verify.mjs --slice backend
 *   node scripts/verify.mjs --slice frontend --slice backend
 *   node scripts/verify.mjs --slice backend --only test/reviews     # vitest filter
 *   node scripts/verify.mjs --slice frontend --tests-only           # skip tsc/depcruise
 *   node scripts/verify.mjs --slice integration                     # needs Docker + migrated DB
 *   node scripts/verify.mjs --slice backend --tail 120              # more failure context
 *
 * Slices (same vocabulary as .claude/skills/pr-self-review/routing.md):
 *   frontend      client/      typecheck · depcruise · check-ui-conventions · vitest   (client.yml)
 *   backend       server/      typecheck · depcruise (incl. ../reviewer-core/src) · vitest unit  (server-unit.yml)
 *   reviewer-core reviewer-core/ typecheck · vitest                                    (reviewer-core.yml)
 *   mcp           mcp/         typecheck · vitest                                      (mcp.yml)
 *   integration   server/      vitest *.it.test.ts — self-skips without Docker         (server-integration.yml)
 *
 * Exit: 0 when every gate passed · 1 when any gate failed · 2 on bad arguments.
 * Output is ANSI-free (FORCE_COLOR=0) so it can be pasted into a report as-is.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const slices = [];
let only = null;
let testsOnly = false;
let tail = 60;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--slice') slices.push(args[++i]);
  else if (a === '--only') only = args[++i];
  else if (a === '--tests-only') testsOnly = true;
  else if (a === '--tail') tail = Number(args[++i]);
  else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
  else { console.error(`unknown argument: ${a}`); usage(); process.exit(2); }
}

const KNOWN = ['frontend', 'backend', 'reviewer-core', 'mcp', 'integration'];
if (slices.length === 0 || slices.some((s) => !KNOWN.includes(s)) || !Number.isFinite(tail)) {
  usage();
  process.exit(2);
}

function usage() {
  console.error('usage: node scripts/verify.mjs --slice <' + KNOWN.join('|') + '> [--slice ...] [--only <vitest filter>] [--tests-only] [--tail N]');
}

// ---------------------------------------------------------------- helpers

const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: process.env.CI ?? '1' };

/** Run a command; return {code, output, secs}. Never throws. */
function run(cmd, cwd) {
  const t0 = Date.now();
  const r = spawnSync(cmd, { cwd: join(ROOT, cwd), env, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const output = ((r.stdout ?? '') + (r.stderr ?? '')).replace(/\x1b\[[0-9;]*m/g, '');
  const code = r.status ?? (r.error ? 127 : 1);
  return { code, output, secs, error: r.error };
}

/**
 * Install a package's npm deps only when they are missing or stale.
 * `npm ci` is NOT a no-op: it deletes node_modules and reinstalls every time,
 * which is a minute of wall-clock and a screen of output per run.
 */
function ensureNpmDeps(pkg) {
  const dir = join(ROOT, pkg);
  const marker = join(dir, 'node_modules', '.package-lock.json');
  const lock = join(dir, 'package-lock.json');
  const stale = !existsSync(marker) || (existsSync(lock) && statSync(lock).mtimeMs > statSync(marker).mtimeMs);
  if (!stale) return { name: `${pkg} deps`, cmd: '(node_modules up to date)', skip: true };
  return { name: `${pkg} deps`, cwd: pkg, cmd: 'npm ci --no-audit --no-fund' };
}

const vitest = (base) => (only ? `${base} ${JSON.stringify(only)}` : base);
const DOT = '--reporter=dot';

// ---------------------------------------------------------------- lanes

/** Each gate: {name, cwd, cmd, test?: boolean}. `test` gates are the only ones kept under --tests-only. */
const LANES = {
  frontend: () => [
    { name: 'client typecheck', cwd: 'client', cmd: 'pnpm typecheck --pretty false' },
    { name: 'client depcruise', cwd: 'client', cmd: 'pnpm exec depcruise src --config .dependency-cruiser.cjs' },
    { name: 'client ui-conventions', cwd: 'client', cmd: 'node scripts/check-ui-conventions.mjs' },
    { name: 'client tests', cwd: 'client', cmd: vitest(`pnpm exec vitest run ${DOT}`), test: true },
  ],
  backend: () => [
    ensureNpmDeps('reviewer-core'),
    { name: 'server typecheck', cwd: 'server', cmd: 'pnpm typecheck --pretty false' },
    { name: 'server depcruise', cwd: 'server', cmd: 'pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs' },
    { name: 'server unit tests', cwd: 'server', cmd: vitest(`pnpm exec vitest run ${DOT} --exclude "**/*.it.test.ts"`), test: true },
  ],
  'reviewer-core': () => [
    ensureNpmDeps('reviewer-core'),
    { name: 'reviewer-core typecheck', cwd: 'reviewer-core', cmd: 'npm run --silent typecheck -- --pretty false' },
    { name: 'reviewer-core tests', cwd: 'reviewer-core', cmd: vitest(`npm test --silent -- ${DOT}`), test: true },
  ],
  mcp: () => [
    ensureNpmDeps('mcp'),
    { name: 'mcp typecheck', cwd: 'mcp', cmd: 'npm run --silent typecheck -- --pretty false' },
    { name: 'mcp tests', cwd: 'mcp', cmd: vitest(`npm test --silent -- ${DOT}`), test: true },
  ],
  integration: () => [
    ensureNpmDeps('reviewer-core'),
    { name: 'server integration tests', cwd: 'server', cmd: vitest(`pnpm exec vitest run ${DOT} .it.test`), test: true },
  ],
};

// ---------------------------------------------------------------- main

let failed = 0;
const summary = [];

for (const slice of slices) {
  console.log(`## slice: ${slice}`);
  for (const gate of LANES[slice]()) {
    if (gate.skip) { console.log(`[SKIP] ${gate.name} ${gate.cmd}`); continue; }
    if (testsOnly && !gate.test && !gate.name.endsWith('deps')) { console.log(`[SKIP] ${gate.name} (--tests-only)`); continue; }
    const { code, output, secs, error } = run(gate.cmd, gate.cwd);
    if (code === 0) {
      const counts = output.match(/Tests?\s+\d+ (passed|failed|skipped)[^\n]*/)?.[0] ?? '';
      console.log(`[PASS] ${gate.name} (${secs}s) ${counts}`.trimEnd());
      summary.push(`PASS ${gate.name}`);
    } else {
      failed++;
      console.log(`[FAIL] ${gate.name} (exit ${code}, ${secs}s) — cd ${gate.cwd} && ${gate.cmd}`);
      if (error) console.log(`       spawn error: ${error.message}`);
      const lines = output.trimEnd().split('\n');
      const shown = lines.slice(-tail);
      if (lines.length > shown.length) console.log(`       … ${lines.length - shown.length} earlier line(s) omitted (--tail ${tail})`);
      for (const l of shown) console.log('       ' + l);
      summary.push(`FAIL ${gate.name} (exit ${code})`);
    }
  }
}

console.log('');
console.log(failed === 0 ? `verify: all ${summary.length} gate(s) passed` : `verify: ${failed} gate(s) FAILED — ${summary.filter((s) => s.startsWith('FAIL')).join('; ')}`);
process.exit(failed === 0 ? 0 : 1);
