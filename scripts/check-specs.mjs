#!/usr/bin/env node
/**
 * Spec lint — the mechanical half of specs/README.md.
 *
 * `spec-creator` is prompt-enforced: nothing stops it (or a human) from
 * reusing a Spec ID, skipping a template heading, or forgetting the backlog
 * row. This script turns those rules into a deterministic check so a spec that
 * `implementation-planner` and `plan-verifier` will cite by `SPEC-NN` / `AC-N`
 * actually carries unique, greppable ids.
 *
 * Scope: `SPEC-NN-*.md` under specs/ and <package>/specs/. The `L0N-*.md`
 * files predate the id scheme and are exempt; e2e/specs/*.flow.json are
 * browser flows, not specs, and are ignored by the glob.
 *
 * Checks (all sourced from specs/README.md — keep the two in step):
 *   - `Spec ID: SPEC-NN` present, unique across every folder, and matching
 *     the file name prefix; file name ends in a `-DD-MM-YYYY` creation date
 *     (`SPEC-NN-<slug>-DD-MM-YYYY.md`)
 *   - `Status:` is one of draft | approved | implemented
 *   - `Source:` and `Supersedes:` lines present
 *   - every template heading present, in order
 *   - `AC-N` ids unique and strictly ascending (retired numbers may be skipped),
 *     each carrying a `(← <source>)` trace tag and a `· verify: <surface>` hint
 *   - a row in the specs/README.md Backlog links the file
 *
 * Run:  node scripts/check-specs.mjs
 * Exit: 0 clean · 1 findings (one line per finding on stderr)
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename, relative, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const PACKAGES = ['server', 'client', 'reviewer-core', 'e2e', 'mcp'];
const STATUSES = new Set(['draft', 'approved', 'implemented']);
const HEADINGS = [
  '## Problem and user',
  '## Goals / Non-goals',
  '## User stories',
  '## Acceptance criteria (EARS)',
  '## Edge cases',
  '## Non-functional requirements',
  '## Inputs and provenance',
  '## Untrusted inputs',
  '## Design review',
  '## Open questions',
];

const folders = ['specs', ...PACKAGES.map((p) => `${p}/specs`)]
  .map((f) => join(ROOT, f))
  .filter((f) => existsSync(f));

const files = folders.flatMap((dir) =>
  readdirSync(dir)
    .filter((n) => /^SPEC-\d{2}-.+\.md$/.test(n))
    .map((n) => join(dir, n)),
);

const findings = [];
const seenIds = new Map();
const backlog = readFileSync(join(ROOT, 'specs/README.md'), 'utf8');

for (const file of files) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  const text = readFileSync(file, 'utf8');
  const say = (msg) => findings.push(`${rel}: ${msg}`);

  const idMatch = text.match(/^Spec ID: (SPEC-\d{2})\s*$/m);
  if (!idMatch) say('missing `Spec ID: SPEC-NN` line');
  else {
    const id = idMatch[1];
    if (!basename(file).startsWith(`${id}-`)) say(`file name does not start with ${id}-`);
    if (seenIds.has(id)) say(`Spec ID ${id} already used by ${seenIds.get(id)}`);
    else seenIds.set(id, rel);
  }

  const dated = basename(file).match(/-(\d{2})-(\d{2})-(\d{4})\.md$/);
  if (!dated) say('file name does not end in a `-DD-MM-YYYY.md` creation date (SPEC-NN-<slug>-DD-MM-YYYY.md)');
  else {
    const [, dd, mm] = dated;
    if (Number(dd) < 1 || Number(dd) > 31 || Number(mm) < 1 || Number(mm) > 12)
      say(`creation date ${dd}-${mm}-${dated[3]} is not day-month-year`);
  }

  const status = text.match(/^Status: (\S+)/m);
  if (!status) say('missing `Status:` line');
  else if (!STATUSES.has(status[1])) say(`Status "${status[1]}" is not draft | approved | implemented`);

  if (!/^Source: \S/m.test(text)) say('missing `Source:` line');
  if (!/^Supersedes: \S/m.test(text)) say('missing `Supersedes:` line');

  let cursor = 0;
  for (const h of HEADINGS) {
    const at = text.indexOf(`\n${h}`, cursor);
    if (at === -1) say(`missing heading "${h}" (or out of order)`);
    else cursor = at + 1;
  }

  const acLines = [...text.matchAll(/^- (AC-(\d+)) —(.*)$/gm)].map((m) => [m[1], Number(m[2]), m[3]]);
  if (acLines.length === 0) say('no `- AC-N — …` lines under Acceptance criteria');
  let last = 0;
  for (const [label, n, rest] of acLines) {
    if (n <= last) say(`${label} is not strictly ascending after AC-${last}`);
    last = Math.max(last, n);
    if (!/\(← .+?\)/.test(rest)) say(`${label} has no \`(← <source>)\` trace tag`);
    if (!/· verify: \S/.test(rest)) say(`${label} has no \`· verify: <surface>\` hint`);
  }

  const linkTarget = rel.startsWith('specs/') ? rel.slice('specs/'.length) : `../${rel}`;
  if (!backlog.includes(`](${linkTarget})`)) say(`no Backlog row in specs/README.md links ${linkTarget}`);
}

if (findings.length) {
  for (const f of findings) console.error(`✗ ${f}`);
  console.error(`\n${findings.length} spec finding(s) — see specs/README.md`);
  process.exit(1);
}
console.log(`✓ ${files.length} spec(s) checked`);
