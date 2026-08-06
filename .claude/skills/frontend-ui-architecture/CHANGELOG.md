# Changelog — frontend-ui-architecture

All notable changes to this skill. Newest first.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
skill uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Versioning policy

The `metadata.version` field in [SKILL.md](SKILL.md) frontmatter is the source of
truth; the catalog row in [../README.md](../README.md) carries a matching
`vX.Y.Z` badge. Bump both and add an entry here in the **same commit** as the
change.

- **MAJOR** — guidance is reversed or removed, or the skill is restructured such
  that an agent that memorised the old version would now be wrong. Anything a
  consumer must re-read.
- **MINOR** — new rules, new sections, or a new reference file. Existing guidance
  still holds.
- **PATCH** — clarifications, rewording, typo and link fixes, or syncing the
  `In this repo` section with a convention change that the skill already
  described in principle.

## [1.1.0] — 2026-08-06

### Added

- **`no-component-internals-from-app`** in `client/.dependency-cruiser.cjs` — a
  route file may no longer reach past a shared component's `index.ts` into its
  internals.

### Fixed

- The skill's `What CI rejects` section claimed "no reaching past another
  component folder's `index.ts`" as machine-checked, but
  `no-sibling-component-internals` fires only *between* shared components: an
  import from `src/app/` straight into `src/components/<name>/helpers.ts` passed
  `pnpm arch` clean. An agent trusting the list would skip reviewing exactly that
  import. The rule was widened to match the prose rather than the prose narrowed,
  since no such import exists in the tree today — verified green on the real
  tree and red on a planted one.

## [1.0.0] — 2026-08-04

Initial release.

### Added

- **The placement ladder** — four levels (component file → component folder →
  feature/route folder → shared) with the proximity rule and the
  climb-one-rung-at-a-time policy.
- **Components** — where a component goes, the strip-the-domain test for "is this
  shared", split signals based on reasons-to-change rather than line count, and
  the component folder anatomy (aux files only when non-empty, colocated tests,
  recursive `_components/` nesting).
- **Constants** — placement by who knows the value's meaning; contract-derived
  values imported rather than redeclared; the case against a global
  `constants.ts`.
- **Helpers, utils, and business logic** — the domain-dependency split between
  helpers and utils, the purity requirement, and the three-destination table
  (pure functions / custom hooks / components).
- **Duplication and abstraction** — two-wait/three-look, abstract on shared
  reason-to-change, and explicit permission to inline a wrong abstraction back
  out.
- **Barrel files** — barrel as public API declaration; no wildcard or app-wide
  barrels; direct sibling imports inside a module to avoid cycles.
- **Next.js App Router** — colocation safety, private folders, route groups, thin
  pages, and the server/client boundary as a bundle-membership decision (push
  down, `children` inversion, serializable props).
- **In this repo (`client/`)** — dev-digest conventions codified: `_components/`
  PascalCase vs `src/components/` kebab-case, curated barrels, `styles.ts` as
  `CSSProperties` objects, `@devdigest/shared` contracts, vendored
  `@devdigest/ui`, API access via `src/lib/api.ts`, next-intl strings.
- **Reviewing an existing structure** — seven checks ordered by damage, with the
  requirement to report a destination rather than a diagnosis.
- [examples.md](examples.md) — fourteen good/bad pairs covering the most common
  placement mistakes, most of them taken from real `client/` code.
- [references.md](references.md) — every source used, grouped by topic, with a
  note on what each contributes.
- [README.md](README.md) — maintainer notes: scope boundary with
  `react-best-practices`, how to keep the repo section honest, and what was
  deliberately left out.
- [evals/trigger-queries.json](evals/trigger-queries.json) — 16 triggering
  queries (8 should-trigger, 8 near-misses against sibling skills). Prepared, not
  yet run against a live router.

Machine enforcement landed with the skill rather than after it:

- `client/.dependency-cruiser.cjs` — graph rules (cycles, cross-route imports,
  shared→app imports, component-internals, vendor leaves, orphans).
- `client/scripts/check-ui-conventions.mjs` — the two syntax rules a graph tool
  cannot see (`export *` in a barrel, `fetch()` outside `lib/api.ts`), with a
  shrinking `WILDCARD_BARREL_DEBT` ratchet for the four pre-existing barrels.
- `pnpm arch` in `client/package.json`, wired into the `Architecture boundaries`
  step of `.github/workflows/client.yml`.

Every rule was verified by planting a deliberate violation and confirming its
name in the output. The first run found one real orphan —
`RunReviewDropdown/styles.ts`, an empty placeholder kept "for convention parity"
— which was deleted.

Two sibling edits were required to keep triggering unambiguous:
`react-best-practices` gave up its "code organization" claim (body **and**
description) and had its Tailwind rule scoped to Tailwind projects, which this
repo is not.

### Notes

- The `styles.ts` `CSSProperties` convention documented here deliberately
  overrides the Tailwind guidance in `react-best-practices`, which does not match
  this codebase.
- Feature-Sliced Design informed the "shared must not know about features" rule,
  but its seven-layer taxonomy was not adopted — too heavy for this project.
