# Insights — DevDigest

Cross-cutting findings (2+ packages, repo process/tooling). Package-scoped ones
live in `<package>/INSIGHTS.md`. Maintained by the `engineering-insights` skill.

## Contract (applies to every INSIGHTS.md)

- **Append-only.** Never rewrite or delete; a correction is a new dated line
  next to the old one. One exception: **Open Questions**, below.
- **Entry format:** `- **YYYY-MM-DD** — insight, with evidence (file:line,
  error text, or measurement)`. One insight per bullet.
- **Unique and consequential only.** An entry must change what a future session
  *does*, and must not restate something already here. Interesting-but-inert
  observations, and anything a code comment already explains, are left out —
  the default is to write nothing.
- **Pre-write read:** re-read the file before writing; an already-recorded
  insight is never written again.
- **Open Questions is a queue, not a record.** When a question is answered,
  **delete it** — never leave it annotated `(resolved)`. If the answer is an
  insight on its own terms, write it into the section it belongs to as a normal
  entry; if the decision now lives in the code or a spec, write nothing.
- **Promotion:** an entry that changed the agent's behaviour twice → ONE line
  in the module's `AGENTS.md → Conventions` (cap 7; the eighth evicts the least
  relevant back here). The full write-up stays in this file.
- **Prune** quarterly: drop entries about since-fixed bugs, merge duplicates,
  resolve contradictions in favour of the newer date. Near ~200 entries —
  split into domain files (ask first).

## What Works

## What Doesn't Work

## Codebase Patterns

## Tool & Library Notes

- **2026-08-02** — A repo added as an ADDITIONAL working directory never gets
  its `CLAUDE.md` auto-loaded: Claude Code walks up from the PRIMARY project
  folder only, and dev-digest has always been opened as a secondary cwd
  alongside `E:\repos\datasets-api`. So this repo's instructions have been inert
  in every such session — agents only ever saw them by reading the file on
  purpose. `ls ~/.claude/projects/` is the fast check: one directory per folder
  ever opened as primary, so a missing `E--repos-dev-digest` proves no session
  has had it in scope. Cost four failed verification rounds before this was
  spotted — check the primary cwd FIRST when memory appears not to load.
- **2026-08-02** — Claude Code strips HTML comments out of memory files before
  the model sees them. A `<!-- ... -->` line in `CLAUDE.md`/`AGENTS.md` is
  invisible: never put load-bearing instructions there, and never use one as a
  probe for whether memory loaded (an entire verification attempt was wasted on
  `<!-- CANARY -->` markers that could not have shown up). Confirmed in the same
  run that the `@AGENTS.md` import DOES resolve — a session with dev-digest as
  primary cwd reported `CLAUDE.md` as one line of content (`@AGENTS.md`, the
  comment above it gone) followed by the imported body of `AGENTS.md`.
- **2026-08-01** — Port 3001 is shared with another local project, and the two
  bind different stacks: `E:\repos\madiro-shoes\apps\api` listens on `::`
  (IPv6) while our Fastify listens on `0.0.0.0` (IPv4), so BOTH bind
  successfully — no EADDRINUSE, both log "Server listening". Windows resolves
  `localhost` to `::1` first, so `http://localhost:3001` reaches madiro-shoes
  and `http://127.0.0.1:3001` reaches DevDigest. The tell is the 404 body:
  `{"message":"Cannot GET /repos"}` is Express (theirs); Fastify says
  `Route GET:/repos not found`. `client/.env` points at `localhost:3001`, so
  when madiro-shoes is up the whole frontend loads nothing while the API looks
  perfectly healthy. Diagnose with
  `Get-NetTCPConnection -LocalPort 3001 -State Listen | Select LocalAddress,OwningProcess`
  — two rows means this. Curl `127.0.0.1`, never `localhost`, to test our API.

## Recurring Errors & Fixes

- **2026-08-01** — API goes silent: port still listening, TCP still accepted,
  but no response and — the discriminating symptom — no `incoming request` line
  in the log either, at 0% CPU (measure a delta; the cumulative figure looks
  busy). Fastify logs that line on receipt, before any handler or DB work, so
  its absence rules out the pool, the query, and the handler; a wedged pino
  write is what remains. The API's stdout is a pipe under `pnpm dev`, Node
  writes to pipes SYNCHRONOUSLY on Windows, and a consumer that stops draining
  blocks the process outright. Restarting the API clears it (a curl that had
  hung 25 min returned in the same second). Mechanism inferred, not measured;
  the symptom→restart loop is confirmed. Reduce the exposure at the source:
  log external-call failures through `errSummary()` from `platform/errors.ts`,
  never the raw error.

## Session Notes

- **2026-07-31** — Built the docs layer: three-section `CLAUDE.md` (Before
  answering / Conventions / Use when) at root + 4 packages, seeded docs/specs
  indexes, restructured all INSIGHTS.md to the seven-section format, and
  created the `engineering-insights` skill that maintains them. Fixed the
  Windows CLI-guard bug in db:migrate/db:seed along the way.

- **2026-07-31** — Lab 1b: restored run cost on three screens (PR-list column,
  runs timeline, trace drawer). Turned out to be a persistence + display
  restoration, not new pricing logic — the computation was never removed.
  Verified with a real OpenRouter run: `cost_usd = 0.0002213904` persisted and
  rendered as `$0.0002`.

- **2026-08-01** — Lab: per-severity finding counters (`feat/homework-01-findings`).
  Added `PrMeta.finding_counts` (both vendored contract copies) + one grouped
  IN-query in `GET /repos/:id/pulls`, and a shared `SeverityCounters` component
  mounted on PR rows and timeline run rows, with the filter held in `?severity=`
  so a list chip deep-links into a pre-filtered detail page. Verified by 14 new
  client tests, an integration test on real Postgres, and a live API response.
  Visual confirmation in the Browser pane stayed blocked — the pane was never
  displayed (see `client/INSIGHTS.md`).

## Open Questions

_None open._
