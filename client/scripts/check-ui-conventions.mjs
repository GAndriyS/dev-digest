#!/usr/bin/env node
/**
 * Syntax-level UI-architecture checks for @devdigest/web.
 *
 * The companion to `.dependency-cruiser.cjs`. That tool reasons about the module
 * GRAPH — who imports whom — which covers most of
 * `.claude/skills/frontend-ui-architecture/SKILL.md`. Two of the skill's rules are
 * about what a file SAYS rather than what it links to, so no graph tool can see
 * them:
 *
 *   1. `export *` in a barrel. A wildcard re-export publishes every symbol a
 *      module happens to have, so internals become public by accident and
 *      renaming one is a breaking change. It also defeats tree-shaking and is the
 *      usual seed of an import cycle. A barrel should name what it supports.
 *   2. `fetch(` outside `src/lib/api.ts`, including the `window.` / `globalThis.`
 *      spellings. Tests mock fetch globally, so a component calling it directly
 *      silently bypasses the mock and the test passes while asserting nothing.
 *      Every request goes through lib/api.ts.
 *
 * Run:  node scripts/check-ui-conventions.mjs
 * Exit: 0 clean, 1 on any violation.
 *
 * GRANDFATHERED entries are debt, not policy. Shrink the list; never append.
 */

import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, posix, sep } from 'node:path';

const SRC = 'src';

/**
 * Vendored trees: copied in wholesale and fixed upstream, so their internal style
 * is not ours to police. `vendor/shared` mirrors the server contracts verbatim and
 * `vendor/ui` is a UI kit — both re-export wide on purpose.
 */
const VENDORED = /^src\/vendor\//;

/**
 * GRANDFATHERED — barrels that already used `export *` when the check was added
 * (2026-08-04). Each one publishes a whole module's surface, so nothing in these
 * folders can be renamed safely. Convert to named exports and delete the entry.
 */
const WILDCARD_BARREL_DEBT = new Set([
  'src/components/app-shell/index.ts',
  'src/components/page-shell/index.ts',
  'src/components/showcase/index.ts',
  'src/lib/hooks/index.ts',
]);

/** The one module allowed to call fetch. */
const API_CLIENT = 'src/lib/api.ts';

/** Strip comments and string/template literals so matches are real code. */
function stripNonCode(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      yield* walk(path);
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) {
      yield path.split(sep).join(posix.sep);
    }
  }
}

const violations = [];

for await (const file of walk(SRC)) {
  if (VENDORED.test(file)) continue;

  const code = stripNonCode(readFileSync(file, 'utf8'));

  if (/^\s*export\s+\*/m.test(code) && !WILDCARD_BARREL_DEBT.has(file)) {
    violations.push({
      rule: 'no-wildcard-barrel',
      file,
      detail:
        'a barrel declares a public API — replace `export *` with the named exports ' +
        'this module actually supports, so its internals stay free to move',
    });
  }

  // `.fetch(`/`fetchSomething(` are other things; require a call on its own.
  // The second pattern exists because the first CANNOT match `window.fetch(`:
  // it excludes a leading dot on purpose, so that `refetch(` and `.prefetch(`
  // stay quiet. Spelling the global out reaches the same function and bypasses
  // the same test mock, so the gate has to see it too.
  const callsFetch =
    /(^|[^.\w])fetch\s*\(/m.test(code) || /\b(?:window|globalThis|self)\s*\.\s*fetch\s*\(/m.test(code);
  if (file !== API_CLIENT && callsFetch) {
    violations.push({
      rule: 'fetch-only-in-api-client',
      file,
      detail:
        'call the API through src/lib/api.ts (usually via a hook in src/lib/hooks/) — ' +
        'tests mock fetch globally, so a direct call bypasses the mock and asserts nothing',
    });
  }
}

// A debt entry that no longer matches means the file was fixed or moved: drop it,
// otherwise the list quietly re-permits a violation someone reintroduces later.
const stale = [...WILDCARD_BARREL_DEBT].filter((file) => {
  try {
    return !/^\s*export\s+\*/m.test(stripNonCode(readFileSync(file, 'utf8')));
  } catch {
    return true;
  }
});

for (const file of stale) {
  violations.push({
    rule: 'stale-grandfather-entry',
    file,
    detail: 'no longer violates no-wildcard-barrel — remove it from WILDCARD_BARREL_DEBT',
  });
}

if (violations.length === 0) {
  const debt = WILDCARD_BARREL_DEBT.size;
  console.log(`ui-conventions: clean (${debt} grandfathered barrel${debt === 1 ? '' : 's'} left to fix)`);
  process.exit(0);
}

for (const { rule, file, detail } of violations) {
  console.error(`error ${rule}: ${file}\n    ${detail}`);
}
console.error(`\n${violations.length} UI-convention violation(s).`);
process.exit(1);
