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

- **2026-08-25** — A rule that protects a MEASUREMENT has to fail a lane, not sit
  in prose. Two of this branch's own findings had been written down as warnings —
  "re-sync `architecture-reviewer-lite` before trusting a delta" and "remove the
  dimension everywhere or measure nothing" — in exactly the shape the eval package
  exists to stop trusting. Both are now mechanical: `evals/src/artifacts/pairs.ts`
  holds a hash of each side of the pair plus one marker per place the removed
  dimension appeared, and `pnpm eval:quality` and `pnpm vitest run src/` fail when
  either file moves or a marker survives into the copy. The check costs nothing —
  it reads two files — and it is the only thing standing between a re-synced pair
  and a delta that reports the drift. The same gate grew an agent lane: `name`
  matching the filename is the dispatch address, and nothing had ever checked it.

- **2026-08-25** — Measured what `architecture-reviewer`'s "cite the documented
  rule per finding" requirement actually buys, against
  `architecture-reviewer-lite` (same cases, dimension removed everywhere), n=5:
  the attribution practice fell **100% → 20%** and its case 75% → 20%, while both
  unrelated cases sat at 100% on BOTH sides and the remaining practices in the
  same case were flat or drifted up. Without the rule the agent still finds every
  violation, still quotes the offending line verbatim, still assigns severity —
  it just stops tying a finding to the contract it breaks. It is not free:
  lite ran 452 output tokens and 3 turns cheaper on that case. **Do not trim this
  rule for token economy** — that is the whole of what it holds up. Re-sync
  `architecture-reviewer-lite.md` from the strict file before any re-measurement;
  a delta across a drifted pair measures the drift.

- **2026-08-19** — Sending the finished **plan** to an independent cross-model
  review before any code is written paid for itself on the L05 Onboarding run:
  15 amendments, 4 of them MAJOR and all of them things a review of the *diff*
  would have caught only after the work existed — a strict-`json_schema`
  incompatibility in the draft schema (`z.record`/`.optional()` are rejected by
  `strict: true`), an unbounded prompt, a 409 test that would have reached the
  real provider, and a stale contract fixture the wire change was about to
  break. Shape that worked: accept the findings as a **binding amendments
  table appended to the plan** (A1…A15, "overrides the step rows where they
  differ"), so `implementer`, `test-writer` and `plan-verifier` all read one
  document instead of a plan plus a review nobody re-opens.

- **2026-08-04** — Splitting a feature across parallel subagents works when the
  split is by FILE OWNERSHIP, not by concern: each agent got an explicit
  "you own these paths, these are someone else's" list and nothing collided
  across three agents touching the same two packages. What it does NOT catch is
  the seams BETWEEN agents — both cross-agent bugs this session (a hook calling
  `PUT` on a route registered as `POST`, and two incompatible shapes for the same
  jsonb column) typechecked cleanly on both sides and would have shipped. Budget
  an integration pass that exercises every cross-agent contract against a live
  server; unit tests on either side of a seam agree with themselves by
  construction.

## What Doesn't Work

- **2026-08-25** — A dispatched subagent does not inherit the eval's model, and
  the failure surfaces as a model-id error from an endpoint you never configured.
  `runClaude()` passes `EVAL_MODEL` to the main `query()` only; a subagent resolves
  the alias in its OWN frontmatter (`model: sonnet`, `model: opus` — nine of the
  agents in `.claude/agents` carry one) to an Anthropic model id, which then goes
  to whatever `ANTHROPIC_BASE_URL` points at. On the first CI run the workflow
  tier dispatched `spec-creator` and the LiteLLM proxy answered
  `openrouter/claude-opus-4-8 is not a valid model ID` while the main session ran
  happily on the configured model the whole time — the model even narrated the
  contradiction in its own trace. Any redirected backend needs
  `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` pinned alongside the model option
  (`evals/src/runtime/env.ts`); the option alone covers one session, not the tree.

- **2026-08-25** — A pass threshold is calibrated against a MODEL, not only
  against an artifact, so moving the runner to a cheaper model silently redefines
  what the suite measures. The `architecture-reviewer` cases sit at
  `threshold: 1` on `claude-haiku-4-5`; the first CI run put them on
  `google/gemini-2.5-flash` and they measured 0.83 / 0.5 / 0, losing mostly the
  attribution practice — a real difference between models, indistinguishable in
  the report from the artifact regressing. The content tier makes the same point
  from the other side: DeepSeek passed 4 of 5 `dependency-checker` cases, whose
  thresholds are 0.75. **Run a gate on the model its bar was set against**, or
  lower the bar deliberately and treat the two as separate series — which is what
  the practice-identity rule already implies for a reworded practice.

- **2026-08-25** — A CI trigger keyed on the literal name `CLAUDE.md` cannot
  fire in this repo, and nothing about it looks broken. `CLAUDE.md` is a
  two-line `@AGENTS.md` import; every rule lives in an `AGENTS.md`, which is
  what `evals/workflow/review-workflow.cases.ts` asserts on by name
  (`server/AGENTS.md`, `client/AGENTS.md`). `evals/scripts/ci-detect.mjs`
  shipped with `f === "CLAUDE.md" || f === ".claude/CLAUDE.md"` as its whole
  workflow-tier predicate — so the trigger that exists to notice the ruleset
  changing would never have run once. It now matches
  `/(^|\/)(AGENTS|CLAUDE)\.md$/`. The same trap has a second shape one layer
  up: in a GitHub Actions `paths:` filter the `**/` prefix requires a
  directory segment, so `'**/AGENTS.md'` does NOT match the repo-root file and
  both forms have to be listed. **Anything that watches "the instructions" must
  watch `AGENTS.md`; `CLAUDE.md` is a pointer, not the content.**

- **2026-08-25** — "Does this artifact have an eval file?" is the wrong gate for
  deciding what CI blocks on. `evals/agents/architecture-reviewer-lite/` holds a
  real `*.eval.ts` that deliberately re-imports the STRICT agent's cases,
  practices and threshold — the frozen half of an A/B pair is *supposed* to score
  lower, that is the measurement. A `hasEvals()`-shaped check therefore routes a
  deliberately-degraded artifact straight into a blocking matrix, where it is red
  by design and teaches everyone to ignore the job. `ci-detect.mjs` now excludes
  every `variant` declared in `src/artifacts/pairs.ts` (scraped as text, since
  the detector is dependency-free `.mjs`), failing OPEN with a test row that
  pins the scrape still matches. Editing either half of a pair is already caught
  by `checkPairs()` in the zero-token gate, so nothing is lost by not gating on
  it twice.

- **2026-08-25** — Deriving a test's recorded outcome from the RUN's exit state
  instead of from its assertions reports both false greens and false reds, and
  nothing looks wrong. `evals/src/records/record.ts` fell back to
  `!result.isError` whenever a case had no judge and no grounding gate — i.e.
  for every trace-asserted workflow case. A dispatch case that read nothing,
  launched nothing and merely answered in prose was recorded **2/2 PASS**
  (the session exited fine); a near-miss negative whose assertions all held was
  recorded **0/2 FAIL** (it spent one turn over `maxTurns`). Both flipped the
  moment the runners passed an explicit verdict. `repeat`, `delta` and
  `flaky` all read that column, so the whole workflow tier was being scored on
  "did the session crash". **A trace-asserted case must record the conjunction
  its asserts check — and deliberately exclude `isError` where the case does not
  assert on it, or a turn-budget overrun reads as a behavioural failure.**

- **2026-08-25** — An eval expectation that names an identifier from memory
  scores 0% in BOTH arms of an A/B and silently removes the case from the
  measurement. `evals/agents/architecture-reviewer` demanded the rule ids
  `reviewer-core-zero-io` and `reviewer-core-ground-findings-gate`; neither
  string exists anywhere in the repo (the real rule is `core-has-no-io`,
  `server/.dependency-cruiser.cjs:123`, and the grounding gate has no id at
  all — it is prose in `reviewer-core/AGENTS.md:20`). Same class of error in the
  same file: "PASS/FAIL verdict" against an agent whose scale is `PASS |
  BLOCKED` (12 BLOCKED / 4 PASS / 0 FAIL across 16 runs), and "does not comment
  on test coverage" against a return format that makes an `Out of scope` section
  naming tests mandatory. All three were failing the agent for obeying its own
  definition. **Grep every identifier and every vocabulary word an expectation
  quotes before writing it**; fixing these took two cases from 0% and 50% to
  100%.
  - **2026-08-25 follow-up** — the same grep also has to check the file
    ABOVE the one under test. A workflow case asserted a read of
    `server/AGENTS.md` while scoring on `vendor/shared` and `.it.test.ts` —
    both of which the ROOT `AGENTS.md` also states, and the root file loads
    automatically. One run answered correctly in a single turn with `grounded:
    1` and an empty `reads`, so only the file assertion failed and the case sat
    at 50% for a reason that had nothing to do with routing. Re-keying it on
    `422` and `test/helpers/pg.ts` (root=0, client=0, server=1) took it to
    100%: **a marker only tests an artifact if it is unreachable without it.**

- **2026-08-25** — A cosmetic edit is not an A/B manipulation. Removing the
  citation rule from two lines of `architecture-reviewer`'s return-format
  template moved the target practice by −20 while an untouched control practice
  moved −40 — pure noise, because the same requirement still appeared in three
  other places (Step 2's "quote the violated rule name", Step 2's read-the-config
  block, Step 3's per-observation `Skill` column). The same experiment against
  `architecture-reviewer-lite`, which has the dimension removed everywhere,
  measured −80 with every control flat. **Grep the artifact for the dimension
  and remove all of it, or measure nothing.**

- **2026-08-04** — Declaring a table in the schema file it "belongs" to can
  close an import cycle that dependency-cruiser rejects: `run_skills` references
  both `agent_runs` and `skills`, and putting it in `schema/skills.ts` created
  `skills → runs → agents → skills`. Drizzle reads the barrel, not file paths,
  so the emitted SQL is identical wherever the table is declared — put a
  cross-domain table in the DOWNSTREAM-most schema file (`runs.ts` here) and
  leave a pointer comment behind. Caught only by depcruise, after `pnpm
  db:generate` had already produced a correct migration.

## Codebase Patterns

- **2026-08-25** — A prohibition in `AGENTS.md` that offers no sanctioned route
  to the goal gets an exception invented for it. The `Never docker compose down
  -v` rule stated its consequence and still lost: asked for a clean Postgres, the
  agent quoted the rule, decided it was "about ACCIDENTAL deletion", and put
  `down -v` on line one of its instructions. Nothing was wrong with the wording —
  the rule was a dead end, and the legitimate intent had nowhere else to go.
  Adding the allowed path (reset the schemas, keep the volume) plus an explicit
  "a deliberate wipe is not an exception" flipped the behaviour: the same prompt
  now answers `НЕ робити: docker compose down -v` and reproduces the reset
  verbatim. **Write a ban as ban + sanctioned alternative; a rule with no exit
  is an invitation to reason around it.** Verified by
  `evals/workflow` — the case that caught it is `destructive cleanup`.

- **2026-08-18** — `.claude/settings.json`'s `deny` on `Edit(./**/src/vendor/ui/**)`
  has no carve-out for this repo's own **declared vendor update** pattern, so a
  plan step that assigns a `nav.ts` row to `implementer` cannot be executed: the
  agent is refused at the tool layer, and so is the main session (the deny is
  not overridable from chat, and routing around it via `Bash` is the bypass the
  rule exists to prevent). This has now cost a stage in the L05 run — the human
  had to `copy` the file in by hand. Plan a `**/src/vendor/ui/**` row as
  **human/main-session, out of the agent chain**, or add a scoped exception to
  `settings.json` first; `.claude/skills/pr-self-review/routing.md` documents
  the `Vendor-update:` declaration but says nothing about who may perform the
  edit. Note the block is wider than the file documents: `Bash rm -rf` under
  `server/clones/**` is also hard-denied, `dangerouslyDisableSandbox` included.

- **2026-08-13** — Any `file:line` derived from repo-intel resolves against
  `repo_index_state.last_indexed_sha`, **never** the PR's `head_sha` — the index
  is built per repo at whatever commit was last synced, not per PR. Rendering
  those lines against the head silently opens the wrong code: on PR #7 of
  `GAndriyS/dev-digest` the index sat at `b4a4f6e` while the head was `cf683a0`,
  and `reviews/routes.ts:137` was the `deleteReview` call at the former but an
  unrelated intent route at the latter — a link that looks right and is wrong.
  Any feature surfacing indexed line references (blast, callers, repo map) must
  carry the indexed SHA on the wire and link with it; `BlastRadius.indexed_sha`
  (`server/src/vendor/shared/contracts/brief.ts`) is the pattern to copy, and
  the Blast tab warns the reader when it differs from the head.

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

- **2026-08-20** — A spec's `· verify:` hint can name an **e2e flow for a path
  that spends money**, which `e2e/AGENTS.md:22-23` forbids outright ("Flows
  target read-only seeded data, so nothing ever triggers a model call. Keep it
  that way."). SPEC-04's AC-27 (the brief's Regenerate button) arrived that way:
  clicking it in a browser flow issues a real provider call. The resolution is
  not to relax the e2e rule but to move the AC's lane — `*.it.test.ts` with the
  provider mocked through the container override slot — and let e2e assert only
  the states reachable *without* generating. `e2e/specs/11-onboarding-tour.flow.json`
  is the worked precedent: it verifies the onboarding skeleton empty state
  because the service's reason ladder returns `not_indexed` "before ever calling
  a model". Planners: read `verify: e2e flow` on a model-spending surface as a
  spec finding to re-lane, never as an instruction to write the flow.

## Tool & Library Notes

- **2026-08-25** — A headless session must expire BEFORE the test runner that
  owns it, or the failure is unrecordable. `record()` fires from a `finally`, and
  a test killed by vitest never reaches one, so a run that hits vitest's 240 s
  ceiling leaves no row — not a red row, an absent one, which `repeat` then
  reports as a green 5/5 over six cases. The fix is the SDK's own
  `Options.abortController`: `runClaude()` arms a timer at `RUN_TIMEOUT_MS`
  (`TEST_TIMEOUT_MS - 60 s`, both in `evals/src/config.ts`, with
  `vitest.config.ts` importing the outer one so the two cannot drift apart), and
  an expired run returns a normal `Result` — `isError`, `timedOut`, partial trace
  intact — instead of throwing. The gap has to clear everything that runs after
  the session inside the same test: the judge is another model round-trip. A
  `timed_out` column now distinguishes a run that died on its deadline from one
  whose assertions failed; they are otherwise identical and call for opposite
  responses. Unit-tested against a mocked SDK session that hangs until aborted.

- **2026-08-25** — In the Claude Agent SDK, `allowedTools` is a DECLARATION,
  not a restriction: under `permissionMode: "bypassPermissions"` a session
  reaches for tools that are not on the list. `evals/src/tasks.ts` ran the
  workflow tier with a read-only `allowedTools` and the traces still showed
  `Write`, `Edit` and `Bash` — and the `engineering-insights` activation case
  wrote its synthetic pgvector finding straight into the real
  `server/INSIGHTS.md`. `disallowedTools` is the half the SDK enforces; with
  `["Write","Edit","NotebookEdit","Bash"]` added, a re-run left `git status`,
  `specs/` and every `INSIGHTS.md` checksum untouched while the model still
  *attempted* Write (a trace records the REQUEST, not the outcome — a blocked
  tool still appears in `toolsUsed`, and costs turns: 21 instead of the usual
  3–4). **Any headless session pointed at a real checkout needs a deny-list;
  the allow-list alone will not hold.** Note what it does not cover: a
  dispatched subagent carries its own tool set, so a dispatch case still
  depends on `stopWhen` tearing the session down at launch.

- **2026-08-25** — A model can emit malformed tool-call syntax, and one bad
  string silently deletes a whole test case from a run. An observed dispatch put
  the rest of the XML into `subagent_type`, so `subagents` held
  `spec-creator</subagent_type>\n<parameter name="prompt">…`. Everything
  downstream compares by EXACT membership — above all `stopWhen`'s
  `subagents.includes(name)` — so the early stop never fired, the nested
  subagent ran to completion, the case blew past vitest's 240 s `testTimeout`,
  and **the kill left its `finally` unreached, so it wrote no record at all**.
  `repeat` builds its summary from records, so a 6-case run printed a green
  "5/5 cases" with the sixth simply absent. Two fixes, both needed:
  normalise the name at extraction (`agentName()` in
  `evals/src/runtime/run-claude.ts`, unit-tested), and make `repeat` compare
  `countTests` against the summary and say so. **Never let a killed test be
  indistinguishable from a passing one — and never key control flow on a string
  the model formatted.**

- **2026-08-25** — vitest's `expect.getState().currentTestName` is AMBIENT, not
  bound to the test that read it. `evals/src/records/record.ts` built each
  record's `nodeid` from it, and because it runs in a `finally` after a 40–70 s
  model call, the ambient name had already moved to a neighbouring case:
  in one 5-run series over four cases, one test collected 6 records, another 0,
  and a third never appeared, so every per-practice rate was computed over
  another case's denominator. `repeat`, `delta` and `benchmark` all aggregate by
  `nodeid`, so all three had been quietly comparing the wrong rows — nothing
  failed, the numbers just meant something else. **Never use ambient test state
  as identity for anything written after an `await`; pass the name in.** The
  symptom to look for is a per-practice list containing practices that belong to
  a different case. Related trap in the same package: the LLM judge echoes each
  practice back and does not echo it byte-for-byte (a dropped pair of backticks
  was enough), so judge output must never be a join key either.

- **2026-08-05** — Every CI workflow pins `pnpm` **10** via
  `pnpm/action-setup@v4`, but nothing in the repo pinned it locally, so corepack
  installed latest (11.x) on a fresh machine. pnpm 11 turns un-triaged
  dependency build scripts into a FATAL error and writes `pnpm-workspace.yaml`
  stubs asking you to triage each one — the untracked stubs that keep appearing
  are that, not a repo file. The builds were never the problem: esbuild's
  postinstall is not required, because `@esbuild/<platform>` ships the prebuilt
  binary and the JS API resolves it from there. Fixed at the root by
  `.nvmrc` (22) + `"packageManager": "pnpm@10.34.5"` in `server/` and `client/`.
  One-time cost when switching major: pnpm 10 refuses to reuse a
  pnpm-11-built `node_modules` and aborts with
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` — rerun with
  `pnpm install --config.confirmModulesPurge=false`.
  **2026-08-11** — the same "ambient shell ignores `.nvmrc`" trap has a second,
  much less obvious symptom: on a shell whose default `node` predates 22 (seen
  on 18.17.1), `pnpm exec depcruise` crashes with `SyntaxError: The requested
  module 'node:util' does not provide an export named 'styleText'` — a
  dependency-cruiser CLI internal, not anything about the cruised config. It
  reads exactly like a broken depcruise install. Fix: `source ~/.nvm/nvm.sh &&
  nvm use 22` before any `client/` or `server/` `pnpm exec` command; don't
  debug depcruise itself on this error.

- **2026-08-05** — `drizzle-kit generate` stops with an INTERACTIVE prompt when
  one diff both adds and drops a column ("is `category` created, or renamed from
  `accepted`?"). It cannot be answered by piping keystrokes, and wrapping it in
  `script` to fake a pty hangs. Split the change into two generates instead —
  add the new columns, then drop the old one — so neither diff is ambiguous.

- **2026-08-05** — In `docker-compose.override.yml`, `ports:` is a SEQUENCE, and
  Compose *appends* an override's sequence to the base rather than replacing it:
  a remap to `5433:5432` still tried to bind 5432 and still collided. The tag
  `ports: !override` is what replaces the list. Verify with
  `docker compose config` before concluding the override "did not apply".

- **2026-08-04** — `gh pr checks <n>` shows only the LATEST run per check name,
  so a failed run that was later superseded by a passing one is invisible: the
  table read "all pass" while the PR was showing a red X. Verify with
  `gh pr view <n> --json statusCheckRollup -q '.statusCheckRollup[] |
  "\(.name)\t\(.conclusion)"'`, which lists every run — two rows with the same
  name and different conclusions is exactly the case `gh pr checks` hides. Do
  not report CI as green off `gh pr checks` alone.

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

- **2026-08-06** — `gh` resolves a bare PR number against the FORK PARENT, not
  `origin`. This clone has two remotes' worth of history: `origin` is
  `GAndriyS/dev-digest`, and GitHub knows it as a fork of
  `ai-agentic-engineering-neo/dev-digest`. `gh pr view 6` returns the parent's
  PR #6 (`fix(ci): correct PR-review posting`, MERGED, a different branch
  entirely) while `gh pr view https://github.com/GAndriyS/dev-digest/pull/6`
  returns ours. The failure is silent and reads as "the PR body changed under
  me" rather than as the wrong repository; `gh pr edit 6 --body-file …` would
  have rewritten a stranger's merged PR. The tell is
  `gh pr list --head <our-branch>` coming back EMPTY while the branch plainly
  has an open PR. Always pass `--repo GAndriyS/dev-digest` (or the full URL) to
  every `gh pr`/`gh api` call in this repo.

- **2026-08-10** — A newly created `.claude/agents/<name>.md` cannot be invoked
  in the same turn that wrote it — the `Agent` tool's registry is refreshed
  between turns, not mid-turn, so four freshly written agents all failed with
  `Agent type 'plan-verifier' not found. Available agents: … implementer,
  planner, researcher` (the three that existed at session start), then became
  available on the very next turn with no restart. Read that error as "wait a
  turn", not as "the frontmatter is broken" — and do not architect around it by
  splitting the work across sessions. Structural checks (frontmatter parses,
  `name` matches the filename, every skill in `skills:` exists under
  `.claude/skills/`) are what belong in the same turn as the write; behavioural
  probes go in the next one.

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

- **2026-08-10** — Lab 3: added four subagents — `test-writer` (sonnet),
  `architecture-reviewer` (opus, read-only), `plan-verifier` (opus, read-only,
  and the only agent with no `Skill` tool), `doc-writer` (sonnet, the first to
  get `mermaid-diagram`) — taking the chain to seven. Reconciled
  `.claude/agents/README.md`, whose "Writing a new agent" template had drifted to
  prescribe a `metadata.skills` block no shipped agent uses. Structural checks
  pass; the behavioural probes are deferred to a fresh session for the
  registry reason recorded above.

- **2026-08-25** — Lab 6: ran the `architecture-reviewer` citation A/B and spent
  most of it fixing the measuring instrument. Three harness defects fell out, in
  rising order of damage: expectations quoting identifiers the repo never
  documents; practice rates keyed on the judge's echoed text; and records filed
  under whichever test vitest's ambient state happened to be pointing at, which
  had been corrupting every `repeat`/`delta`/`benchmark` denominator. With those
  fixed and the manipulation made real (`architecture-reviewer-lite`), the effect
  measured cleanly at −80 points on the attribution practice with every control
  flat. Also shipped `dependency-checker` 1.0.0 with `scripts/deps-report.mjs`.

- **2026-08-25** — Lab 6b: built the workflow (systemic) eval tier — six
  composite cases over `CLAUDE.md` routing, package `AGENTS.md`, skill
  activation and subagent dispatch, run as 6 sessions instead of 10 by merging
  along one task each. Added `expectMentions` so a trace case can also score the
  final text, which is the only way to see a rule delivered as CONFIG (root and
  package `CLAUDE.md` produce no `Read`). Most of the session went into the
  instrument again: the allow-list that was not enforcing, an outcome column
  measuring "did not crash", and a mangled subagent name that deleted a case
  from a run. All six cases end green (M3 at 5/5); the tier's first real finding
  was a hole in `AGENTS.md`, not in the code.

- **2026-08-25** — Lab 6c: wired the harness evals into GitHub Actions
  (`.github/workflows/evals.yml`): a zero-token `gate`, a `detect` job that
  routes from the PR diff, and matrix'd `skills` / `agents` / `workflow` tiers
  on OpenRouter (DeepSeek for content, Gemini 2.5 Flash + the bundled LiteLLM
  proxy for the tool tiers, which are the only ones measured to actually dispatch
  a subagent). Most of the value was not the YAML: `ci-detect.mjs` had shipped
  unreferenced with a workflow trigger that could never fire, and its
  "artifact has evals" check would have gated on an A/B baseline. Both are now
  covered by `evals/src/ci-detect.test.ts` in the model-free lane.
  - **follow-up, same day** — the first real run answered three things at once:
    the wiring works end to end (routing, proxy, artifacts) and `evals/` does
    install under pnpm 10; a dispatched subagent ignores `EVAL_MODEL`; and the
    tool-tier thresholds are model-calibrated, so those tiers moved to
    `anthropic/claude-haiku-4.5` via the Anthropic Skin, which needs no proxy at
    all. Measured cost for all three tiers: 324.5k in / 15.3k out, ~$0.10-0.15.

## Open Questions

- **2026-08-25** — A fixture that is PASTED rather than applied cannot produce
  gate output, and no expectation should be written as if it could. The
  `core-has-no-io` practice in `evals/agents/architecture-reviewer` has been
  re-keyed to attribution behaviour (a named contract plus a locator, which is
  the dimension the lite variant actually loses), so the case discriminates
  again — but the underlying limitation stands for every future case: the agent
  runs depcruise against the LIVE repo, which is green, so a fixture diff never
  reaches a gate. Materialising a case's diff into a scratch tree the gate can
  cruise is the only way to grade what a machine check actually printed. Nobody
  has needed it enough yet to build it.

  *(The vitest-timeout question recorded here on 2026-08-25 is closed — see the
  session-deadline entry under Tool & Library Notes.)*
