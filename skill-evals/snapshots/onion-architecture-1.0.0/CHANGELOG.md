# Changelog

All notable changes to the `onion-architecture` skill. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[semver](https://semver.org/) as defined in `README.md`.

## [Unreleased]

### Added

- `evals/` — the skill's own test set: three cases, three planted boundary
  violations each, with fixtures that never name their own bug. Ships inside the
  skill folder so a delivered copy arrives with its tests; the runner lives in
  `skill-evals/` at the repo root.

### Measured

- First A/B run (2026-08-24, `claude-opus-5`, evidence in
  `skill-evals/baselines/onion-architecture-2026-08-24/`): **18/18 with the
  skill, 18/18 without it**, delta 0. The baseline run derived the same rules
  from `server/.dependency-cruiser.cjs` and `AGENTS.md`. No change to `SKILL.md`
  follows from this — it is a statement about the cases, which all sit on
  machine-enforced ground, not about the prose.

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
