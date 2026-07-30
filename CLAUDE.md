# DevDigest

Local-first AI pull-request review. Course starter template: import a PR, run an
agent review on it. Node 22 · TS 5.7 · Zod 3 · Fastify 5 + Drizzle/Postgres
(pgvector) · Next 15 + React 19.

## Before answering

Read the touched module's `INSIGHTS.md` before starting work (root `INSIGHTS.md`
for cross-cutting tasks); search `docs/` and `specs/` as needed. Working inside
a package — read its own `CLAUDE.md` (`server/`, `client/`, `reviewer-core/`,
`e2e/`).

## Conventions (not obvious from code)

- This is NOT a monorepo workspace: four independent packages, each with its own
  `package.json` **and lockfile**. `server/`, `client/` → **pnpm**;
  `reviewer-core/`, `e2e/` → **npm**. Installing at the repo root does nothing.
  Cross-package code resolves via tsconfig path aliases, not published modules.
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
- When prose and CI disagree, trust `.github/workflows/**`.
- Git is always in English — branch names, commit messages, PR titles and bodies.
- Do not touch: `server/clones/**` (runtime clone checkouts),
  `server/src/db/migrations/*.sql` (applied — add a new migration instead),
  `**/src/vendor/ui/**` (vendored UI kit — fix upstream, then re-vendor).

## Use when

- Whole-stack boot (`./scripts/dev.sh`), architecture, diagrams → read `README.md`
- Test strategy and CI lanes → read `TESTING.md`
- API / DB / adapters work → read `server/CLAUDE.md`
- Web UI work → read `client/CLAUDE.md`
- Review-engine work → read `reviewer-core/CLAUDE.md`
- Browser e2e work → read `e2e/CLAUDE.md`
- Deep dives → read `docs/` · current work → read `specs/` · findings → read
  `INSIGHTS.md` · skills catalog → read `.claude/skills/README.md`
- Captured a non-obvious finding or wrapping up a session → run
  `/engineering-insights` (recording nothing is a legitimate outcome)
