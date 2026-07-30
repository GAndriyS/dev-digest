# Insights — DevDigest

Cross-cutting findings (2+ packages, repo process/tooling). Package-scoped ones
live in `<package>/INSIGHTS.md`. Maintained by the `engineering-insights` skill.

## Contract (applies to every INSIGHTS.md)

- **Append-only.** Never rewrite or delete; a correction is a new dated line
  next to the old one.
- **Entry format:** `- **YYYY-MM-DD** — insight, with evidence (file:line,
  error text, or measurement)`. One insight per bullet.
- **Pre-write read:** re-read the file before writing; an already-recorded
  insight is never written again.
- **Promotion:** an entry that changed the agent's behaviour twice → ONE line
  in the module's `CLAUDE.md → Conventions` (cap 7; the eighth evicts the least
  relevant back here). The full write-up stays in this file.
- **Prune** quarterly: drop entries about since-fixed bugs, merge duplicates,
  resolve contradictions in favour of the newer date. Near ~200 entries —
  split into domain files (ask first).

## What Works

## What Doesn't Work

## Codebase Patterns

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

- **2026-07-31** — Built the docs layer: three-section `CLAUDE.md` (Before
  answering / Conventions / Use when) at root + 4 packages, seeded docs/specs
  indexes, restructured all INSIGHTS.md to the seven-section format, and
  created the `engineering-insights` skill that maintains them. Fixed the
  Windows CLI-guard bug in db:migrate/db:seed along the way.

## Open Questions
