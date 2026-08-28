# Changelog

All notable changes to the `onion-architecture` skill. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[semver](https://semver.org/) as defined in `README.md`.

## [2.0.0] — 2026-08-24

Major because the skill now changes verdicts: it says no to migrations that
previous versions passed.

### Added

- **Team decisions the code cannot tell you** — two conventions that are not
  recoverable from any file in the repo and that contradict what the surrounding
  schema suggests: `reviews` is closed for new columns (per-review data goes in
  its own `review_id`-keyed table), and new foreign keys are `ON DELETE
  RESTRICT` with the owning service deleting children explicitly.
- `evals/` — the skill's own test set (cases, fixtures, assertions), inside the
  skill folder so a delivered copy arrives with its tests. Runner in
  `skill-evals/` at the repo root.

### Measured

Evidence in `skill-evals/baselines/onion-architecture-2026-08-24-case7-v2-vs-v1.1.0/`,
`claude-opus-5`, 5 runs per configuration, graded by an independent agent.

- **v2.0.0 100% (45/45) vs v1.1.0 60% (27/45)**, delta **+0.40**. Three
  discriminating assertions split 5/5 vs 0/5 (Fisher p≈0.008 each) while every
  control stayed 25/25 — a targeted gap, not a weaker reviewer.
- The failure mode the numbers hide: v1.1.0 did not stay silent. It reframed the
  widened `reviews` table as a cross-module write (correct, but a different fix
  that leaves the columns in place), and on foreign keys three of five runs
  actively proposed new `ON DELETE CASCADE` — the surrounding schema argues for
  it, which is exactly why the convention had to be written down.
- Costs 12% fewer tokens and 13% less wall clock than v1.1.0; zero false
  findings on either side.

## [1.1.0] — 2026-08-24 · superseded by 2.0.0 the same day

### Added

- **Blind spots — where the config is silent**: outbound `fetch` in
  `reviewer-core`, `import type { FastifyRequest }` in a service, another
  module's tables read through `container.db`, and a cache built from a secret
  that `invalidateSecretCaches()` never clears.

### Measured — and the bump was not earned

- Against v1.0.0 on the blind-spot cases: **17/17 vs 17/17**, delta 0
  (`…-v1.1.0-vs-v1.0.0/`). On the secret-cache case at 5 runs a side: **45/45 vs
  45/45**, no assertion split either way (`…-case6-5x/`). v1.0.0 reached every
  mechanism on its own by reading `server/.dependency-cruiser.cjs` and
  `container.ts`, often quoting the rule comments verbatim.
- Recorded here rather than quietly re-numbered: on the evidence this was a
  wording release, and a version number that claims more than the measurement
  supports is how a changelog stops being useful.
- One real defect it introduced: the new text cited a route that does not exist
  (`PUT /settings/secrets`; the only caller is `POST /settings/test-connection`,
  `modules/settings/routes.ts:84`). Eight of ten runs took it on faith, two
  checked the file and silently corrected it. A skill saves the reader a lookup,
  so a confident wrong locator is worse than none — fixed before 2.0.0.

## [1.0.0] — 2026-08-04

## [1.0.0] — 2026-08-04

### Added

- `SKILL.md` — the dependency rule and the ring→folder map for `server/` and
  `reviewer-core/`; ports and adapters; the composition root; Zod validation at
  the edge; the reviewer-core iron rule; testing seams; new-module checklist.
- `examples.md` — nine good/bad pairs taken from real code in this repo.
- `references.md` — the articles behind each rule.
- `server/.dependency-cruiser.cjs` — machine enforcement of the same boundaries,
  wired into the `typecheck` job of `.github/workflows/server-unit.yml`. Rules:
  `no-circular`, `no-orphans` (warn), `routes-through-service`,
  `service-stays-http-agnostic`, `no-direct-adapter-clients`,
  `no-cross-module-internals`, `infrastructure-points-inward`,
  `db-schema-is-leaf`, `core-has-no-io`, `core-does-not-import-server`,
  `not-to-dev-dep`, `no-deprecated-core`.

### Notes

Adopted on an existing codebase, so two exception lists were grandfathered
rather than fixed up front: the four layerless modules (`polling`, `pulls`,
`settings`, `workspace`) and the two adapters that read `repo-intel` constants.
Both are marked `GRANDFATHERED` in the config and are meant to shrink.
