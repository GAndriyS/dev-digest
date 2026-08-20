# Insights — server

Findings scoped to the API (repo-intel entries tagged `[repo-intel]`).
Maintained by the `engineering-insights` skill, append-only. Entry format and
promotion rules → root `INSIGHTS.md`.

## What Works

- **2026-08-18** — A genuinely cancelled run can be driven from an integration
  test with no `vi.mock` and no container override: `container.runBus` is the
  process-wide singleton exported by `platform/sse.ts`, so the test calls the
  same `runBus.cancel(runId)` the `POST /runs/:id/cancel` route calls, using
  the runId the review POST returns. Pair it with `strategy: 'map-reduce'` and
  a **2-file** diff — `selectMode` (`reviewer-core/src/review/run.ts`) only
  multi-chunks when `diff.files.length > 1` — so there is a second
  `checkCancelled` checkpoint to abort on. Recipe in
  `test/reviews.it.test.ts` (`CancelOnSecondChunkProvider`). Caveat: arm the
  cancel from the provider's first call, not after the POST returns —
  `ReviewsService.runReview` starts the executor before responding.

- **2026-08-01** — The PR list syncs from GitHub on every read and is polled
  once a minute per open tab, so a repo GitHub 404s for (deleted, renamed,
  private to the token, or fixture data like the seeded `acme/payments-api`)
  burns two rate-limit units and ~3KB of log every minute, forever. Fixed with
  a TTL'd in-memory negative cache — `githubRepoAvailability` in
  `modules/pulls/github-availability.ts`, wired into both the list sync and the
  `GET /pulls/:id` detail refresh. Measured on the seeded repo: first call
  696ms, subsequent 7ms. In-memory and TTL'd on purpose — a 404 is a fact about
  right now (grant the token access and it flips), so it must not outlive the
  process or need anyone to clear a flag.

## What Doesn't Work

- **2026-08-19** — Grounding a model-authored **shell command** by "must appear
  verbatim in the file it cites" is too strict to ship: `npm install` is what a
  `package.json` *means*, never what it contains, so the rule silently emptied
  the whole `run_locally` section (caught by `onboarding.it.test.ts` AC-15, not
  by any unit test). What works is two gates instead of one: reject the unsafe
  *class* outright (`[|;&\`$><\n(){}]` — chaining, substitution, redirection,
  which is what every "download and run" shape needs), then accept either a
  verbatim match or one of a few fixed bootstrap shapes whose every identifier
  is checked against the cited file (`<pm> install`, `<pm> run <script>` with
  the script key present, `docker compose up <services>` with each service
  present) — `server/src/modules/onboarding/helpers.ts` `filterToSourcedCommands`.

- **2026-08-13** — `[repo-intel]` An adapter that catches its own failures and
  returns an empty result makes the whole degradation invisible downstream:
  `DepCruiseGraph.buildEdges` swallowed every error into `[]`, so the pipeline's
  `graphFailed` could never be set by a cruiser problem, `repo_index_state`
  stamped `full`, and `GET /pulls/:id/blast` answered "0 caller(s) across 0
  file(s)" with full confidence — the exact false claim the module promises
  never to make. A swallowed failure needs a downstream INVARIANT check, not
  just a try/catch: `pipeline/full.ts` now stamps `partial` +
  `stats.graphEmpty` when a repo walked more than one file and resolved zero
  edges. Any future adapter that degrades to an empty value needs the same
  treatment, because "empty" and "broken" are indistinguishable at the call site.

## Codebase Patterns

- **2026-08-18** — A pure function that restates a walk's acceptance rule
  drifts from it **twice** if you only test the accepted shapes.
  `modules/context/helpers.ts`'s `badgeFor` is the read/attach gate —
  `classifyAndRead` asks it before touching the disk, so "has a badge" IS "may
  be read" — and it diverged from `walkContextFiles` once on `SKIP_DIR_NAMES`
  and again on the `.md` extension, the second time despite a doc comment at
  the site warning about exactly this and despite a paired parity test. The
  parity test missed it because its fixture only carried files the walk
  *accepts*: the gap lives in paths that partially match (a real root segment,
  a file the rule still rejects — `specs/notes.txt`). Any edit to either side
  needs a fixture entry per **rejected-despite-partial-match** shape, not just
  per accepted one.

- **2026-08-18** — `loadConfig()` runs before Fastify and its logger exist — it
  computes `logLevel` itself — so there is no seam inside `platform/config.ts`
  to report a bad env value from. Config validation that must be *visible*
  plumbs a diagnostic field out on `AppConfig` and logs it from `app.ts` after
  the container is decorated (`contextFilesDropped` + the `app.log.warn` next to
  the existing "stale-run reaping failed" warning is the pattern). Do not add a
  logger to `config.ts`, and do not let a dropped entry stay silent — an env
  var that silently falls back to its default reads as "my setting is applied".

- **2026-08-18** — `AppConfig.cloneDir` can BE the do-not-touch path. The
  checked-in `server/.env` and `.env.example` set `DEVDIGEST_CLONE_DIR=./clones`,
  which is relative, so `loadConfig()` resolves it against `process.cwd()` —
  and every `pnpm db:*` script runs with cwd `server/`, making it exactly
  `server/clones`, the runtime-clone directory root `AGENTS.md` forbids
  touching. The L05 seed derived its fixture location from `config.cloneDir`
  and silently wrote two `.md` files in there. Anything that WRITES fixture or
  demo data must key its location on stable identity under a fixed root
  (`~/.devdigest/context-fixtures/<owner>/<repo>` is the L05 answer,
  `db/seed.ts`), never on a runtime-configurable path a real clone also uses —
  otherwise one config change either loses track of the output or clobbers a
  genuine checkout.

- **2026-08-13** — `[repo-intel]` `extractEndpoints` scanned line by line, so
  it only ever matched single-line route registrations — and every Fastify
  route in this repo that carries a schema puts its path on the line AFTER
  `app.get(`. Result: 11 of the server's route files were absent from
  `file_facts` entirely, and blast attributed 0 endpoints to changes it should
  have flagged (PR #8 went 0 → 2 endpoints on the fix alone). Fact extractors
  here must run their regexes over the whole file content with `matchAll`, and
  bound any multi-part pattern's window (`[\s\S]{0,200}?`) so a lone `method:`
  cannot pair with an unrelated `url:` further down
  (`adapters/codeindex/extract.ts`).

- **2026-08-13** — `pr_files` is populated as a side effect of `GET /pulls/:id`
  (`pulls/routes.ts:249-259`), not by import — so a PR the user has never opened
  has `files_count` set but **zero** `pr_files` rows, and any feature keyed on
  changed files sees an empty list. `repoIntel.getBlastRadius` answers an empty
  file list with `degraded: 'no_data'`, which reads as "the index is broken" and
  sends the reader off to re-index for nothing. Verified on PR #4 of
  `GAndriyS/dev-digest`: `degraded` before the detail fetch, `full` with 72
  symbols right after. Check `changedFiles.length === 0` first and report the
  missing file list as its own cause (`blast/service.ts` → `no_changed_files`).

- **2026-08-13** — `[repo-intel]` Precomputed `file_facts` cover **every**
  indexed file including specs, so attributing endpoints through the import
  graph hands a reviewer the routes that tests stand up. On PR #7 of
  `GAndriyS/dev-digest` this inflated one symbol's "impacted endpoints" from 10
  real routes to 23, burying them under `GET /agents/${ghost}/versions` and
  friends. `isJunkPath` (`repo-intel/service.ts`, already used for rank-driven
  samples) is the repo's filter for this — apply it to FACTS attribution only,
  never to the caller list: a spec calling the changed symbol is a real caller
  worth showing, its routes are not a real dependency.

- **2026-08-06** — Anything read out of `server/clones/**` is ATTACKER-CONTROLLED
  content: importing an arbitrary public repo is the product's normal flow, so a
  repo can commit `tsconfig.json -> ~/.devdigest/secrets.json` and any code that
  `join(clonePath, path)`s its way to a file will follow the link straight out of
  the clone. `..` is not the vector to worry about — git tree entries cannot
  contain it — the symlink is, and it defeats every check that reasons about how
  a path is SPELLED. `realpath` both sides and compare, and keep the separator in
  the prefix (`real.startsWith(root + sep)`), or `/clones/repo-evil` passes as
  inside `/clones/repo`. The conventions sampler does this in
  `readInsideClone`/`isInsideRoot`; any future clone reader must too. Note this
  degrades to harmless on a Windows clone without Developer Mode, where git
  materialises symlinks as text files — so the hole is invisible in local
  testing here and live in CI and on any Linux host.
- **2026-08-06** — When a matcher normalises BOTH a needle and a haystack, drop
  the same things from both sides or the strictness lands somewhere nobody
  intended. `locateSnippet` filtered blank lines out of the model's snippet but
  kept them in the file, so a snippet copied character-for-character across a
  blank line — exactly what the extraction prompt demands — could never match,
  and the honest rule was counted in `dropped_no_evidence`, the field the UI
  presents as "how much the model made up". The fix is to condense both sides and
  carry the ORIGINAL indices alongside, since the located line number is
  published as a GitHub deep-link. A test that only covers the inverse direction
  (a spurious blank in the needle) reports this as working.
- **2026-08-05** — Seeded PR #482 has `pr_files` rows but **no `patch` text**, so
  it is not reviewable offline: `diffFromPrFiles` skips patch-less rows, the
  review runs against an EMPTY diff, and the grounding gate then drops every
  finding for citing a file not in the diff. The result reads as "the agent
  found nothing" rather than as a broken fixture. Any offline review experiment
  needs a PR seeded WITH real unified-diff text (see PR #483 and
  `BREAKING_PR_FILES` in `db/seed.ts`), and its `@@` headers must be exact —
  `parseUnifiedDiff` numbers each hunk from the new-side START, so an off-by-one
  there silently drops findings the same way. Pin any such fixture with a test
  that asserts the EXACT line set; `toContain` on a contiguous band passes for
  any start within the band's width and catches nothing.

- **2026-08-11** — `modules/smart-diff/constants.ts`'s mini-glob DSL had one
  directory-segment form (`name/` → matches at ANY depth) and it was wrong for
  `vendor/`, `build/`, `out/`, `generated/`: these are common names for a
  hand-authored nested folder (`server/src/vendor/shared`, `scripts/build/`, a
  monorepo package's `out/`), and `BOILERPLATE_PATTERNS` runs before every
  other role check while `boilerplate` is the one role forced collapsed — a
  false positive here hides real source, it doesn't just mis-sort it. Fixed by
  adding a second, ROOT-ANCHORED form (`/name/` — matches only when `name` is
  the path's first directory) and using it for those four entries specifically;
  `dist/`, `coverage/`, `.next/`, `node_modules/`, `__snapshots__/` stay
  any-depth because no package hand-authors a nested folder with one of those
  exact names for source code. Anyone adding a new directory-name pattern to
  this file must ask the same question before picking `name/` vs `/name/`:
  could this segment name plausibly be a hand-written subfolder somewhere
  under `src/`? If yes, root-anchor it (`server/src/modules/smart-diff/helpers.ts`
  `matchesPattern`).

- **2026-07-31** — Course features cut from the starter were removed
  *surgically*: the computation usually survives and only persistence + display
  were stripped. Before building one, read the removal commit
  (`git log --oneline --all | grep -i remove`) — for run cost, `d45ab0d` and
  `58c6ac7` left `ReviewOutcome.costUsd`, `PriceBook`, and the provider's
  `usage.cost` hook fully intact, so the "feature" was ~6 small edits, not new
  pricing logic. `git show <commit> --stat` is the file-by-file worklist.

- **2026-08-01** — Third instance of the above, with a new tell: the cut can be
  disguised as a **design decision in a comment**. `modules/pulls/routes.ts:116`
  read "The per-severity FINDINGS breakdown is intentionally not surfaced on the
  list — findings live on the PR detail page", while the whole tally helper
  (`rollupSeverities` + `SeverityCounts`, `modules/pulls/status.ts:16-31`) sat
  fully written and unreferenced next to it, and `status.ts`'s own header
  comment still described the list as showing "a FINDINGS severity breakdown".
  Treat a lone justifying comment as a possible removal marker, not a binding
  constraint: grep the module's pure helpers for unreferenced exports before
  writing your own tally.

- **2026-08-20** — A second module cannot reach blast's facts at all:
  `src/modules/blast/` ships only `constants.ts`, `routes.ts`, `service.ts` — no
  `index.ts`, no `types.ts` — and `no-cross-module-internals`
  (`.dependency-cruiser.cjs:83-95`) publishes only `constants|types|index.ts`,
  so `blast/service.ts` is private and there is nothing legal left to import.
  The rule's own comment names the way out ("shared state belongs in the
  container"), and the repo already has the worked example: `ProjectContext` is
  an interface in `modules/context/types.ts:61`, implemented by `ContextService`
  (`modules/context/service.ts:181`), exposed as the `container.projectContext`
  lazy getter (`platform/container.ts:143-146`) with a test override slot on
  `ContainerOverrides` (`:55`). Any feature needing another module's facts adds
  that trio — interface in the owner's `types.ts`, getter on the container,
  override slot — rather than an import; a plan step that says "import blast's
  service" fails depcruise in CI, not at review.

## Tool & Library Notes

- **2026-08-19** — A Fastify route whose `schema.body` is a plain zod object
  rejects a **body-less** POST with 422, and `.optional()` does not fix it: with
  no `content-type` the validator is handed `null`, not `undefined`, so the
  error reads `Expected object, received null` (`fastify-type-provider-zod`
  `validatorCompiler` runs `schema.safeParse(data)` on whatever Fastify parsed).
  Use `.nullish()` and read `req.body?.field`
  (`server/src/modules/onboarding/routes.ts:40-50`). The trap is that every
  `app.inject({ payload: {} })` test passes — `payload: {}` serializes a real
  JSON body — so only a caller that sends nothing (curl, an MCP tool) hits it.

- **2026-07-31** — tsx watch restarts only on imported-module changes; editing
  `server/.env` does nothing until a manual restart, because config is read
  once at boot (`platform/config.ts`). Verified: `/settings/secrets-status`
  showed the new keys only after killing and restarting `pnpm dev`.

- **2026-08-11** — `pnpm exec depcruise` crashes hard, not gracefully, under
  Node 18: `SyntaxError: The requested module 'node:util' does not provide an
  export named 'styleText'` from `dependency-cruiser/.../cli-feedback.mjs`,
  with no mention of Node versions anywhere in the message. `.nvmrc` pins 22,
  but nvm's own `default` alias on this machine is 18, so a fresh shell's
  `node --version` silently disagrees with the repo's pin — `pnpm typecheck`
  and `vitest` both run fine under 18 (only depcruise's CLI feedback module
  needs the Node-22-only `styleText` export), so the first signal that node is
  wrong shows up on the boundary-check step, not the typecheck step run just
  before it. Fix: `nvm use 22` (or `source ~/.nvm/nvm.sh && nvm use 22`) before
  running depcruise, every server or client verification pass.

- **2026-08-13** — `dependency-cruiser`'s `cruise()` resolves every input path
  as `join(baseDir, path)` (`gatherInitialSources`, baseDir defaults to
  `process.cwd()`), so handing it ABSOLUTE paths makes it stat
  `cwd + /abs/path`, throw ENOENT, and — behind our try/catch — yield an empty
  graph on every platform. It also echoes `source`/`resolved` back in whatever
  form baseDir implies. Correct call: pin `baseDir` to the clone root and pass
  repo-relative POSIX paths; then `source`/`resolved` come back in exactly the
  form `walk.ts` produces and the file-set membership checks hit. Verified
  against the real clone: 0 → 768 edges, `references.decl_file` 0 → 1262
  resolved rows (`adapters/depgraph/index.ts`, covered by
  `test/depgraph-adapter.test.ts`). Separately, `relative()` returns backslashes
  on win32 — every path leaving an adapter must go through
  `.split(sep).join('/')`, the same normalisation `walk.ts:119` applies.

## Recurring Errors & Fixes

- **2026-08-19** — "I changed the seed's demo run log / trace and `pnpm db:seed`
  shows the old one" on a long-lived local database is stale state, not a bug.
  `seed.ts`'s demo `agent_runs` / `run_traces` insert keys off
  `(prId, agentId, source='local')` with `.onConflictDoNothing()`, so once ANY
  run — a real one from earlier manual testing included — occupies that slot
  for PR #482 / "General Reviewer", the fixture's trace never lands again and
  the trace drawer keeps showing the older run (here: two pre-L05 runs dated
  2026-08-05 with `specs_read: []`). Verify seed-format changes in an
  `*.it.test.ts` that calls the real `seed()` against a fresh testcontainers
  Postgres (`test/context.it.test.ts` does), not by eye on `devdigest-postgres`;
  idempotency is doing exactly what it should.

- **2026-08-18** — An integration test that does `waitForPrRuns(...)` and then
  `GET /runs/:id/trace` is load-sensitive and will flake: `run-executor.ts`
  calls `completeAgentRun(runId, { status: 'done' })` (~`:357`) several lines
  BEFORE `saveRunTrace(runId, trace)` (~`:405`), and `waitForPrRuns` polls only
  `agent_runs.status`, so it can return inside the window where the run is done
  and the `run_traces` row does not exist yet. The tell is an assertion on a
  trace field reading `undefined` (seen twice on `trace.specs_read`, once per
  ~6 full-suite runs, never reproducible in isolation) — not a 404, because the
  route returns a row-shaped default. Do not "fix" it by retrying the
  assertion: either wait for the `run_traces` row explicitly, or move the trace
  write ahead of the status update. Every sibling test using that pattern
  carries the same latent race.

- **2026-08-11** — Any server-side pre-work that resolves its provider via
  `resolveFeatureModel(container, workspaceId, '<feature>')` (L03's intent
  classifier is the first: `review_intent` defaults to `openrouter`) reaches a
  **REAL** provider in an integration test unless that specific provider key
  is also in `overrides.llm`, because `container.llm()` falls back through
  `secrets.get()` to `process.env`, and `server/.env` on a dev machine set up
  for manual verification (see the Verification plan's "run against a real
  provider" step) typically has real `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/
  `OPENROUTER_API_KEY` values. `reviews.it.test.ts`'s `appWith()` only mocked
  the AGENT's own provider; adding the intent pre-work call left 4/7 tests
  failing with `expected [] to have length 1` — not a timeout or a network
  error, but `waitForPrRuns`' 10s poll budget expiring while a real ~10s
  OpenRouter round-trip ran before the (mocked, near-instant) agent review
  even started. The tell: a console warning from the REAL `openai` SDK's
  `zodResponseFormat` helper (`Zod field … uses .optional() without
  .nullable()`) appearing in test stderr — that conversion only runs inside a
  real provider's `completeStructured`, never inside `MockLLMProvider`. Fix:
  mock every provider a review run's pre-work can reach, keyed by the
  OVERRIDE slot, not by the mock's own `.id` (`conventions.it.test.ts` already
  does this: `openrouter: new MockLLMProvider('openai', {...})`).

- **2026-07-31** — A CLI guard of the form
  ``import.meta.url === `file://${process.argv[1]}` `` never matches on Windows
  (backslash argv path vs `file:///E:/...` URL), so the script exits 0 having
  done nothing — a green exit with an empty database behind it. Fix applied in
  `src/db/migrate.ts` / `src/db/seed.ts`: compare against
  `pathToFileURL(process.argv[1]).href` (guard `process.argv[1]` first —
  `noUncheckedIndexedAccess` types it `string | undefined`). Any new tsx CLI
  entrypoint must use the same form.

- **2026-08-20** — Five server unit tests fail **on macOS only** and pass in CI,
  which reads for hours as "this branch broke something": 3 in
  `test/context-walk.test.ts` (clone-root classification) and 2 in
  `test/depgraph-adapter.test.ts` (POSIX path resolution, root outside cwd).
  Cause: both suites build fixtures with `mkdtemp(join(tmpdir(), …))`, and on
  macOS `os.tmpdir()` is `/var/folders/…` while `realpathSync` of it is
  `/private/var/folders/…` (`/var` is a symlink). The code under test realpaths
  its root and compares path prefixes — correctly, that check is the
  symlink-escape guard from the 2026-08-06 entry above — so the un-realpathed
  fixture path never matches and the test reads it as an escape. On Linux
  `/tmp` is real, both strings are equal, all 22 pass. Proof in one command:
  `cd server && TMPDIR=$(node -e "console.log(require('fs').realpathSync(require('os').tmpdir()))") pnpm exec vitest run test/depgraph-adapter.test.ts test/context-walk.test.ts`
  → 22 passed. **Do not "fix" the production prefix check** — the bug is in the
  fixtures. And do not let a red `--slice backend` on a Mac be attributed to the
  branch under review: check whether the failing suite uses `tmpdir()` first.
  This cost an entire SPEC-04 implementation run's worth of agents each
  re-encountering the same five reds and being told to ignore them.

## Session Notes

- **2026-08-13** — Audited Blast Radius against the L04 requirements after PR #8
  showed 76 symbols and 0 callers everywhere. The feature code met the spec; the
  INDEX under it was empty — `file_edges` had 0 rows for every repo, so
  `decl_file` was never resolved and every caller/endpoint query returned
  nothing. Two writer bugs (cruiser called with absolute paths; endpoint
  extraction line-by-line) plus a missing invariant check that let the broken
  index report `full`. After the fixes and a forced reindex, PR #8 shows 41
  callers across 7 files and 2 endpoints, MCP `get_blast_radius` matches the UI,
  and the route answers in ~3ms (pure Postgres reads). Server unit 354 and
  integration 58 green.

- **2026-08-13** — Built Blast Radius (L04 homework) end to end: the `blast/`
  module over `GET /pulls/:id/blast` plus an opt-in
  `POST /pulls/:id/blast/summary` (one model call, never on the GET), a
  per-symbol caller cap and a two-level reverse walk over `file_edges` inside
  repo-intel, the client's Blast tab, and the real `get_blast_radius` MCP tool.
  All lanes green (server unit 347, integration 58, client 275, mcp 67);
  `pnpm arch` and both dependency-cruiser configs clean. Two defects were found
  only by cross-checking the live map against the repo by hand, not by any
  test — see the two Codebase Patterns entries dated today.

- **2026-08-11** — Implemented the L03 intent layer end to end: contracts
  (`Intent`/`IntentSource`/`PrIntentRecord`), migration 0015, the `_shared`
  clone-fs promotion, the classifier (`intent.ts`), `flagOutOfScope`, the
  run-executor wiring, and `GET`/`POST /pulls/:id/intent`. All server/client
  lanes green (server unit 267, integration 45, client 221, reviewer-core 23).
  See the Recurring Errors entry above for the one non-obvious failure hit
  along the way.

## Open Questions
