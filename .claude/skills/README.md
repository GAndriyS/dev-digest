# Skills

Reusable AI skills that provide specialized knowledge and workflows. Canonical location is `.claude/skills/` with a symlink at `.cursor/skills/ → ../.claude/skills` for Cursor compatibility. Shared with the team via version control.

## Catalog

| Skill | Scope | Description |
|-------|-------|-------------|
| [onion-architecture](onion-architecture/SKILL.md) `v2.0.0` | Backend | Layer boundaries for `server/` + `reviewer-core/`; enforced by `server/.dependency-cruiser.cjs` in CI, plus the blind spots it cannot see and two team conventions no file records. Ships its own [eval set](onion-architecture/evals/README.md) |
| [fastify-best-practices](fastify-best-practices/SKILL.md) | Backend | Fastify routes, plugins, JSON-schema validation, error handling |
| [drizzle-orm-patterns](drizzle-orm-patterns/SKILL.md) | Backend | Drizzle schema, queries, relations, transactions, migrations |
| [postgresql-table-design](postgresql-table-design/SKILL.md) | Backend | Postgres schema design, data types, indexing, constraints |
| [next-best-practices](next-best-practices/SKILL.md) | Frontend | Next.js App Router, RSC boundaries, data fetching, optimization |
| [react-best-practices](react-best-practices/SKILL.md) | Frontend | React anti-patterns, state management, hooks rules |
| [frontend-ui-architecture](frontend-ui-architecture/SKILL.md) `v1.1.0` | Frontend | Where code lives: component layout, constants, helpers, logic placement, duplication |
| [react-testing-library](react-testing-library/SKILL.md) | Frontend | General-purpose React Testing Library guide with Vitest |
| [zod](zod/SKILL.md) | Full-stack | Zod schema validation, parsing, error handling, type inference |
| [typescript-expert](typescript-expert/SKILL.md) | Full-stack | Type-level programming, performance, tooling, migrations |
| [security](security/SKILL.md) | Full-stack | OWASP Top 10:2025, auth, injection, uploads, secrets |
| [mermaid-diagram](mermaid-diagram/SKILL.md) | Shared | Mermaid diagrams in markdown (flowcharts, sequence, ERD, …) |
| [dependency-checker](dependency-checker/SKILL.md) `v1.0.0` | Meta | External npm + internal path-alias dependencies of all six packages: graph, per-package weight, P0/P1/P2/Info findings, prioritised summary. Facts come from [`scripts/deps-report.mjs`](../../scripts/deps-report.mjs); [eval set](../../evals/skills/dependency-checker) grades the report structure |
| [engineering-insights](engineering-insights/SKILL.md) | Meta | Captures session findings into per-module INSIGHTS.md (append-only learnings loop) |
| [pr-self-review](pr-self-review/SKILL.md) `v3.1.0` | Meta | Reviews the local diff with the routed skills before a PR is opened; run manually, CI enforces the mechanical half |
| [implement](implement/SKILL.md) `v1.1.0` | Meta | `/implement <plan>` — runs an approved plan: implementer → architecture-reviewer ∥ /code-review ∥ /security-review → fix loop → plan-verifier → doc-writer → /pr-self-review, with human gates, a shared handoff brief and a per-stage cost log in `.claude/sdd/` |
| [workflow-retro](workflow-retro/SKILL.md) `v0.1.0` | Meta | `/workflow-retro [slug] [--deep]` — retrospective of a multi-agent run from the current chat: agents, order, tokens, struggles, duplication, handoff losses, proposals; appends to `docs/retro/ledger/`. Manual only — no hook, not part of `/implement` |

## What Are Skills?

Skills are modular packages that extend the AI agent with specialized knowledge and workflows. Unlike rules (always applied) or agents (invoked for specific tasks), skills are loaded on-demand when the agent determines they're relevant.

### Skills vs Rules vs Commands vs Agents

| Type | Scope | Loaded | Purpose |
|------|-------|--------|---------|
| **Rules** (`.mdc`) | Project conventions | Always or by file pattern | Persistent guardrails |
| **Commands** (`.md`) | User actions | On `/command` invocation | Slash commands |
| **Skills** (`.md`) | Domain knowledge | On-demand by agent | Specialized knowledge |
| **Agents** (`.md`) | Workflows | Via Task tool | Subagent orchestration |

## Creating New Skills

Each skill has:

- `SKILL.md` — Main skill file with rules and conventions (required)
- `examples.md` — Code examples showing good/bad patterns (recommended)
- `references.md` — Sources and rationale (optional)
- `README.md` — Maintainer notes for humans: how to change the skill (optional)
- `CHANGELOG.md` — Version history (required once the skill declares a
  `metadata.version`, and for any skill backed by a check that can fail CI —
  a rule change is an architecture decision and needs a paper trail)
- `evals/` — The skill's own test set (optional): `evals.json` with the cases
  and `fixtures/` with the code they act on. It lives inside the skill folder so
  a skill delivered elsewhere arrives with its tests attached; the runner that
  executes it — with the skill and without it — is `skill-evals/` at the repo
  root. Fixtures must sit outside every package's `tsconfig` (this folder does)
  and must never name their own planted bug in a comment, or the case measures
  reading comprehension instead of the skill. See
  [onion-architecture/evals](onion-architecture/evals/README.md).

A skill that is enforced by tooling (e.g. [onion-architecture](onion-architecture/SKILL.md)
and its dependency-cruiser config) must keep the prose, the check, and the
version in sync in one PR. Prose alone decays; checks alone are unreadable.
