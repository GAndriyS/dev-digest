# DevDigest

Local-first AI pull-request review. Course starter template: import a PR, run an
agent review on it. Node 22 · TS 5.7 · Zod 3 · Fastify 5 + Drizzle/Postgres
(pgvector) · Next 15 + React 19.

## Before answering

Read the touched module's `INSIGHTS.md` before starting work (root `INSIGHTS.md`
for cross-cutting tasks); search `docs/` and `specs/` as needed. Working inside
a package — read its own `AGENTS.md` (`server/`, `client/`, `reviewer-core/`,
`e2e/`, `mcp/`).

## Conventions (not obvious from code)

- This is NOT a monorepo workspace: five independent packages, each with its own
  `package.json` **and lockfile**. `server/`, `client/` → **pnpm**;
  `reviewer-core/`, `e2e/`, `mcp/` → **npm**. Installing at the repo root does
  nothing. Cross-package code resolves via tsconfig path aliases, not published
  modules.
- Migrations are NOT applied on boot — `cd server && pnpm db:migrate`.
- `@devdigest/shared` exists **twice**: `server/src/vendor/shared` (canonical,
  also used by reviewer-core) and `client/src/vendor/shared` (trimmed copy, has
  already drifted). Edit the server copy, then mirror wire-crossing changes into
  the client copy — never edit only one.
- Contracts are Zod-first: one schema drives request validation **and** response
  serialization. Never hand-roll `Schema.parse(req.body)` in a handler.
- DB-backed tests must end in `.it.test.ts` — the unit and integration lanes
  split on that glob.
- `reviewer-core` is consumed as TypeScript **source**; it never emits JS, its
  `build` is a typecheck.
- Secrets live in `~/.devdigest/secrets.json` (mode 0600) with `process.env` as
  fallback. Never the database, never git.
- The DB schema ships every table for every course lesson — empty tables are
  expected, not a bug.
- Never `docker compose down -v` — it drops the `devdigest_pgdata` volume along
  with every imported repo and review.
- Agent instructions live in `AGENTS.md`; the `CLAUDE.md` next to it is a
  two-line `@AGENTS.md` import and holds no content — Claude Code reads only
  `CLAUDE.md`, so the pointer is what makes `AGENTS.md` reachable. Do not delete
  it, and never let the two diverge. It is an import rather than a symlink on
  purpose: git hands a symlink to a Windows clone without Developer Mode as a
  text file containing the word `AGENTS.md`, which loads as the whole ruleset.
- When prose and CI disagree, trust `.github/workflows/**`.
- Git is always in English — branch names, commit messages, PR titles and bodies.
- Every PR body ends with an **Insights** section summarising what the branch
  appended to `INSIGHTS.md` (or stating plainly that nothing was recorded). It
  puts the findings in front of the reviewer next to the diff that produced
  them, and makes an empty sweep a stated decision rather than an omission.
- Opening a PR goes through `/pr-self-review` — it reviews the diff with the
  routed skills and drafts the PR body including that Insights section. Invoke
  it by hand: auto-invocation is deliberately off (the working hook is parked in
  `.claude/settings.json.hook-example`). CI runs the mechanical half regardless.
- Do not touch: `server/clones/**` (runtime clone checkouts),
  `server/src/db/migrations/*.sql` (applied — add a new migration instead),
  `**/src/vendor/ui/**` (vendored UI kit — fix upstream, then re-vendor).

## Use when

- Whole-stack boot (`./scripts/dev.sh`), architecture, diagrams → read `README.md`
- Test strategy and CI lanes → read `TESTING.md`
- API / DB / adapters work → read `server/AGENTS.md`
- Web UI work → read `client/AGENTS.md`
- Review-engine work → read `reviewer-core/AGENTS.md`
- Browser e2e work → read `e2e/AGENTS.md`
- MCP-server / coding-agent tool work → read `mcp/AGENTS.md`
- Deep dives → read `docs/` · current work → read `specs/` · findings → read
  `INSIGHTS.md` · skills catalog → read `.claude/skills/README.md` · subagents
  catalog → read `.claude/agents/README.md`
- Specifying a feature before planning it → delegate to `spec-creator`; it writes
  the feature spec (EARS criteria with `AC-N` ids, edge cases, design review)
  to `specs/` or `<package>/specs/` and nowhere else. Template and naming →
  read `specs/README.md`.
- Planning a change before writing it → delegate to the `implementation-planner`
  subagent; it reviews the requirements (a spec in `specs/` or the request —
  it never writes specs, `spec-creator` does), asks whether the plan runs multi-agent or in a single
  pass, writes the plan to `.claude/plans/` (committed) and `implementer`
  executes it. Neither can call the next step — no agent here lists `Agent` in
  its `tools` allowlist, so the main session orchestrates.
- Building an approved plan → run `/implement .claude/plans/<slug>.md`; it
  drives implementer → architecture-reviewer ∥ /code-review → fix loop →
  plan-verifier → doc-writer → /pr-self-review, stops at the human gates and
  logs state + agent cost to `.claude/sdd/<slug>.md` (`--from` resumes in a
  new chat). `spec-creator` and `implementation-planner` are run by hand
  before it, never from it. `test-writer` is off the default chain (token
  budget) — delegate to it by hand when a feature needs a test pass. Why the
  order → read `.claude/agents/README.md`.
- Running a CI lane locally (any agent, any session) → `node scripts/verify.mjs
  --slice <frontend|backend|reviewer-core|mcp|integration>` — one line per
  gate, failure output only. Do not inline `tsc`/`depcruise`/`vitest` in
  prompts; the script mirrors `.github/workflows/**` and is the one place to
  keep in step with them.
- Captured a non-obvious finding or wrapping up a session → run
  `/engineering-insights` (recording nothing is a legitimate outcome). Subagents
  do not write `INSIGHTS.md`; they return insight candidates in their reports.
- Retrospective of a multi-agent run (agents, order, tokens, handoff losses,
  proposals) → the human runs `/workflow-retro [slug] [--deep]` by hand; it
  appends to `docs/retro/ledger/`. Never auto-invoked, never from `/implement`.
