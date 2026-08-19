# Workflow retros

One ledger entry per multi-agent run, written by `/workflow-retro`
(`.claude/skills/workflow-retro/SKILL.md`) — **run by hand only**, never by a
hook or from another skill. Each entry records which agents ran, in what
order, at what token / tool-call / wall-clock cost, where they struggled, what
they duplicated or dropped between handoffs, and the proposals that came out
of it. Findings about *agents and workflow* live here; findings about *the
code* go through `/engineering-insights` into `INSIGHTS.md`.

Entries are append-only and never overwritten — a second retro of the same
slug on the same day gets a `-2` suffix. Headings are fixed so a later retro
with `--deep` can compute a **Delta** against an earlier one.

## Ledger

| Date | Slug | Workflow | Agents | Tokens | Entry | Headline |
|---|---|---|---|---|---|---|
| 2026-08-19 | l05-sdd-onboarding-generator | spec → plan (+cross-model review) → hand-driven /implement + demo | 26 spawns / 6 resumes | ≈2.5 M (≈1.60 M observed) | [entry](ledger/2026-08-19-l05-sdd-onboarding-generator.md) | 40/40 AC in 5 h 28 min, but the only CRITICAL was found at stage 6 in stage-2 code — move `/security-review` into stage 3 |
