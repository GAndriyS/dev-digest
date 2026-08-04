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

- **2026-08-04** — Generic skills vendored into `.claude/skills/` can carry rules
  that contradict this repo and an agent will follow them silently, because
  nothing cross-checks a skill against the conventions in `AGENTS.md`. Live
  example: `react-best-practices` said "use utility classes for all styling — no
  inline `style={}` objects", while `client/` styles exclusively with colocated
  `styles.ts` exporting `CSSProperties` objects — an agent applying the skill
  would rewrite working code into Tailwind that this codebase does not use. Its
  `Code Organization` section likewise pointed at `utils/` and `components/ui/`,
  neither of which exists here. When adding or updating a skill, diff its claims
  against the touched package's `AGENTS.md` and scope every conflicting rule in
  place ("applies only to Tailwind projects", + link to the skill that owns the
  topic) — the conflicting rule is the finding, and leaving it unscoped is how
  the next session gets it wrong.
- **2026-08-04** — Skill versioning convention: `metadata.version` (nested, not a
  top-level `version:` key) in SKILL.md frontmatter is the source of truth, the
  catalog row in `.claude/skills/README.md` carries a matching `` `vX.Y.Z` ``
  badge, and a `CHANGELOG.md` in the skill directory records the bump — all three
  move in the same commit. `onion-architecture` and `frontend-ui-architecture`
  are the reference implementations; the older skills predate this and carry no
  version at all, so absence of a version does not mean "v1".

## Tool & Library Notes

- **2026-08-04** — `skills-lock.json` tracks ONLY skills vendored from upstream
  GitHub repos; hand-written ones (`engineering-insights`, `react-best-practices`,
  `mermaid-diagram`, `security`, `react-testing-library`, and now
  `frontend-ui-architecture`) are deliberately absent. Do not add a lock entry
  for a locally authored skill, and do not read the lock file as an inventory of
  what is installed — it still lists `architecture-patterns` and
  `github-workflow-automation`, neither of which exists under `.claude/skills/`
  any more. `Get-ChildItem .claude/skills` is the only reliable inventory.

- **2026-08-04** — dependency-cruiser: putting `node_modules` in `options.exclude`
  drops every npm package out of the graph, so any rule that names one
  (`fastify`, `drizzle-orm`, `octokit`) passes while looking green — the run
  reports zero violations and the boundary is not enforced at all. Use
  `doNotFollow: { path: '(^|/)node_modules/' }` instead: the packages stay as
  graph nodes, their internals are not traversed. Caught only because a
  deliberate `import { FastifyInstance } from 'fastify'` in a probe service did
  NOT trip `service-stays-http-agnostic`. Always verify a new rule by planting a
  violation and seeing its name in the output; a clean run proves nothing on its
  own. Rules matching npm packages must target the resolved path
  (`node_modules/fastify/`), not the bare specifier (`^fastify$`) — only Node
  core modules keep their bare name.
- **2026-08-04** — dependency-cruiser: `to: { circular: true, dependencyTypesNot:
  ['type-only'] }` does not exclude type-only edges from a cycle — that filter
  applies to the direct dependency, not to the links inside the cycle, so every
  service naming its `Container` type reported a false cycle
  (`repo-intel/service.ts → platform/container.ts → repo-intel/service.ts`, all
  of them `import type`). The working form is `viaOnly: { dependencyTypesNot:
  ['type-only'] }`, which matches only cycles whose every edge survives to
  runtime. Four of five reported cycles in `server/src` were this false positive.
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

- **2026-08-04** — Lab 2: authored the `frontend-ui-architecture` skill (v1.0.0)
  from web research — placement ladder, component/constants/helpers/logic
  placement, AHA-style duplication rules, App Router + server/client boundary,
  plus a section codifying `client/`'s actual conventions. Sources kept in the
  skill's `README.md`. De-conflicted `react-best-practices`, which contradicted
  the repo on styling and pointed at folders that do not exist.

- **2026-08-04** — Lab 2: authored the `onion-architecture` skill (v1.0.0) for the
  backend packages, plus `server/.dependency-cruiser.cjs` enforcing the same
  boundaries in the `typecheck` job of `server-unit.yml`. The skill documents the
  architecture the repo already had rather than proposing a new one. All twelve
  rules verified by planting deliberate violations; the codebase passes with two
  grandfathered exception lists (four layerless modules, two adapters reaching
  into `repo-intel` constants) and one `no-orphans` warning on the dead
  `platform/model-router.ts`.

## Open Questions

_None open._
