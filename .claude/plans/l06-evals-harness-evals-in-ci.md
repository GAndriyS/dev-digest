# Plan: Wire the harness evals into GitHub Actions on pull requests

**Branch:** L06-Evals · **Slices:** meta · **Spec:** none (delegation-stated requirements) · **Mode:** single-agent · **Supersedes:** none

## Context read

Every line below was re-read in the working tree for this plan; nothing in the
delegation had drifted except where **Requirements review** says so.

- `AGENTS.md:16-20` — six independent packages, six lockfiles; `evals/` is **pnpm**.
  Installing at the repo root does nothing.
- `AGENTS.md:21-27` — `evals/` "is **not** part of any CI slice — `scripts/verify.mjs`
  does not know it"; `pnpm.onlyBuiltDependencies` called dead under pnpm 11, the
  approval said to live in `evals/pnpm-workspace.yaml`.
- `AGENTS.md:52-57` — root `CLAUDE.md` is a two-line `@AGENTS.md` import holding no
  content. This is the fact that makes the shipped detector's `CLAUDE.md` trigger inert.
- `AGENTS.md:58` — when prose and CI disagree, `.github/workflows/**` wins.
- `AGENTS.md:60-63` — every PR body ends with an **Insights** section.
- `AGENTS.md:81-87` — the model-free eval lanes are `pnpm eval:quality` and
  `pnpm vitest run src/`; model-backed `pnpm eval*` lanes spend budget and are run by
  hand, "never as a side effect of another task".
- `AGENTS.md:116-120` + `scripts/verify.mjs:63,106` — `verify.mjs` knows
  `frontend|backend|reviewer-core|mcp|integration` and has **no** `evals` slice. Grep for
  `evals` in that file returns nothing.
- `.claude/skills/pr-self-review/routing.md` § Slices — `.claude/**`, `*.md` and
  "anything else" → **`meta`**; `meta` gets no skill review. § Skill map — no skill maps
  to `meta`, so every **Skills** cell below is `—` by the map, not by omission.
- `.github/workflows/mcp.yml:10-24` — `on.pull_request.paths` + `permissions: contents:
  read` + `concurrency: <name>-${{ github.ref }}` + `cancel-in-progress`.
- `.github/workflows/client.yml:35-37` — `pnpm/action-setup@v4` with **`version: 10`**;
  same in `e2e-web.yml:45-47`, `server-unit.yml:45-47,84-86`, `server-integration.yml:41-43`.
  `client/package.json:5` and `server/package.json:6` pin `packageManager: pnpm@10.34.5`;
  `evals/package.json` has **no** `packageManager` field; `evals/pnpm-lock.yaml:1` is
  `lockfileVersion: '9.0'`.
- `.github/workflows/pr-gate.yml:30-33,52-62` — `fetch-depth: 0` for merge-base diffs, and
  the rule that attacker-controlled text is written to a file, never interpolated into a
  shell. Note it *does* interpolate `github.event.pull_request.base.sha` (a machine-made
  40-hex SHA) directly at line 68.
- `evals/scripts/ci-detect.mjs:47-70` — the mapping; `runWorkflow` matches only
  `f === "CLAUDE.md"`, `f === ".claude/CLAUDE.md"`, `^\.claude/agents/.+\.md$`,
  `^evals/workflow/`, `^evals/src/`.
- `evals/scripts/ci-detect.mjs:72-79` — outputs are appended to `$GITHUB_OUTPUT`, or
  printed as `k=v` on stdout when that var is unset (which is what makes local verification
  possible without any harness).
- `evals/src/runtime/dispatch.ts:13-17` — content tier goes direct to OpenRouter under
  `EVAL_BACKEND=openrouter`; the header comment states tool tiers do **not** use it.
- `evals/src/runtime/env.ts:29-35` — throws `"EVAL_BACKEND=openrouter but
  OPENROUTER_API_KEY is not set"`; `ANTHROPIC_BASE_URL` comes from `OPENROUTER_BASE_URL`.
- `evals/src/config.ts:9-11,40-42` — `EVAL_MODEL` default `claude-haiku-4-5` (an Anthropic
  ID), `EVAL_JUDGE_MODEL` default `claude-sonnet-5`, `MAX_TURNS` 8,
  `TEST_TIMEOUT_MS` **240000** (4 min per test), `RUN_TIMEOUT_MS = TEST_TIMEOUT_MS - 60s`.
  These two numbers are what the `timeout-minutes` below are derived from.
- `evals/vitest.config.ts:8` — `include: ["**/*.eval.ts", "src/**/*.test.ts"]`. The
  model-free lane is exactly `src/**/*.test.ts`; a new test placed there costs no tokens.
- `evals/README.md:164-174` — the measured table: `google/gemini-2.5-flash` dispatches a
  subagent, `deepseek/deepseek-chat` and `openai/gpt-4.1-mini` do not.
- `evals/README.md:176-186` — the two tool-tier caveats: rate-limit degradation under load
  (run sequentially, keep CI concurrency low) and `activation` cases being behaviour-shaped
  ("indicative, not blocking" on non-Anthropic models).
- `evals/README.md:115` — the gotcha: always set `EVAL_MODEL` with
  `EVAL_BACKEND=openrouter`, the default is an Anthropic ID OpenRouter will not find.
- `evals/README.md:191-246` — the illustrative "Wiring it into GitHub Actions (per-PR)"
  block. Its `paths:` is `['evals/**', '.claude/**', 'CLAUDE.md']` — no `**/AGENTS.md`.
- `evals/README.md:608-618` — the "Which change → which run" table; row 3 is
  "`CLAUDE.md` / activation / dispatch → `pnpm eval:workflow`".
- `evals/src/artifacts/pairs.ts:48-53` — the A/B pair: `source: "architecture-reviewer"`,
  `variant: "architecture-reviewer-lite"`, plus `sourceSha`/`variantSha`.
- `evals/agents/architecture-reviewer-lite/architecture-reviewer-lite.eval.ts:1-9` — the
  variant is graded on the **strict** agent's cases and threshold. It is a baseline that is
  *supposed* to score lower.
- `evals/src/skill-quality.ts:141-151` — `eval:quality` also runs `checkPairs()` and exits
  non-zero on any skill, agent or pair failure. Zero tokens.
- `evals/src/artifacts/paths.ts:14` + `evals/.gitignore:2` — `RESULTS_DIR = evals/results`,
  gitignored; `record.ts:19-20,85-88` writes `records.jsonl` and `outputs/<run>/*.md`.
- `evals/tsconfig.json` — `include: ["src","skills","agents","workflow","vitest.config.ts"]`,
  **no `allowJs`**, `scripts/` not included. This is what decides where the detector test goes.
- `INSIGHTS.md:6-27` — append-only, dated-bullet format; subagents never write it.
- `.claude/plans/README.md` — plan shape; a plan is never overwritten.

**Insight candidates for the main session** (I cannot write `INSIGHTS.md`; see
**Recommendations R4** for the proposed lines): the DeepSeek-cannot-dispatch measurement,
the `CLAUDE.md`-is-only-an-import detector trap, and the pnpm-version/build-approval
mismatch below.

## Requirements review

No spec exists for this (`rg -l 'Spec ID:' specs */specs` → `SPEC-01..04`, none about CI or
evals). The requirements are the delegation's, quoted below. They are sharp enough to plan
against — a spec would add nothing a plan can use here, so I do **not** recommend routing
this back to `spec-creator`.

| # | Requirement (verbatim) | Verdict | How the plan handles it |
|---|---|---|---|
| U-1 | "a skill changed → CI checks whether that skill has evals and runs them" | clear | Step 4 `detect` + `skills` matrix; `skipped_skills` renders a visible SKIP line (Step 4d) |
| U-2 | "`CLAUDE.md` changed → the general/systemic workflow eval run fires" | **conflicts** — with `AGENTS.md:52-57`: root `CLAUDE.md` is a 2-line import that essentially never changes, so the literal trigger is inert. Resolved by D-3 | Step 1 broadens the predicate to any-depth `AGENTS.md`/`CLAUDE.md`; Step 4 mirrors it into `paths:` |
| U-3 | "an agent changed → the general workflow check with that agent fires" | clear | Already in the detector (`^\.claude/agents/.+\.md$` sets `run_workflow`); Step 1 only excludes `README.md`, Step 4 wires it |
| U-4 | "everything must be runnable on OpenRouter, with an option somewhere in the job parameters to switch the model" | clear | Step 4 job-level `env` + `workflow_dispatch` inputs (D-2) |
| D-1 | One workflow `.github/workflows/evals.yml` with jobs `gate` / `detect` / `skills` / `agents` / `workflow`; `workflow` non-blocking with the reason as a comment | clear | Step 4. See S-2 for the day-one *required-check* set, which is a separate switch from `continue-on-error` |
| D-2 | Job-level `env` is the single place a default is edited; content tier `deepseek/deepseek-chat`, tool tiers `google/gemini-2.5-flash` + proxy; both `EVAL_MODEL` and `EVAL_JUDGE_MODEL` per job; `workflow_dispatch` inputs resolved as `${{ inputs.x \|\| 'default' }}` | clear | Step 4b/4c; the split is backed by `evals/README.md:164-174` |
| D-3 | Fix `ci-detect.mjs` `runWorkflow` to `/(^\|\/)(AGENTS\|CLAUDE)\.md$/`; mirror into `paths:` | clear | Step 1 + Step 2 (test) + Step 4 (`paths:`) |
| D-4 | `paths:` a superset of everything the detector routes on | clear | Step 4a — `.claude/**`, `**/AGENTS.md`, `**/CLAUDE.md`, `evals/**`, `.github/workflows/evals.yml` |
| D-5 | `fetch-depth: 0` + `git diff --name-only base.sha...HEAD`, no third-party action | clear | Step 4b; base SHA passed through `env:` rather than interpolated inline |
| D-6 | Fork PRs: guard the three model-backed jobs on `head.repo.full_name == github.repository`, `gate` runs for everyone; decide how the skip reads | clear (S-3 settles the reading) | Step 4a/4b; the skip is *named* in the job name and *explained* in `gate`'s step summary |
| D-7 | `fail-fast: false`, `max-parallel: 1` on tool-tier matrices, `timeout-minutes`, `concurrency: evals-${{ github.ref }}` `cancel-in-progress` | clear | Step 4; timeouts derived from `TEST_TIMEOUT_MS=240000` × case count |
| D-8 | Proxy lifecycle: `up -d` → `proxy:wait` → tier → `if: failure()` logs → `if: always()` down | clear | Step 4c |
| D-9 | `pnpm/action-setup@v4` (version 10 — verify), node 22, `cache: pnpm`, `cache-dependency-path: evals/pnpm-lock.yaml`, `--frozen-lockfile`, `defaults.run.working-directory: evals` | clear — **verified: 10** is what every other workflow pins, and the lockfile is `9.0`. But see R3: the esbuild build approval is version-sensitive | Step 4a; R3 records the trap and its early signal |
| D-10 | Every job writes `$GITHUB_STEP_SUMMARY`; SKIP lines visible there; upload `evals/results/**` (7 days) | clear | Step 4d; `results/` confirmed gitignored and append-only |
| D-11 | Docs in the same PR: root `AGENTS.md:21-22` correction, `evals/README.md` CI section + "which change → which run" table, `INSIGHTS.md` via `/engineering-insights` | clear | Steps 5, 6, 7 |
| S-1 | Settle the verification strategy; no step may spend model tokens locally | clear | **Verification plan** below; every command in it is model-free |
| S-2 | Blocking on day one, or `continue-on-error` first and promote — "give a recommendation, not a menu" | clear | Settled in **Decisions taken** (planner's call): `gate` is the only *required* check on day one; `skills`/`agents` ship red-on-failure but unlisted in branch protection |
| S-3 | How a skipped-because-fork job should read in the checks list | clear | Settled in **Decisions taken** |
| S-4 | A rough per-PR cost figure, labelled an estimate | clear | **Cost estimate** under Step 4; derived from list prices × `MAX_TURNS=8`, not measured |

## Decisions taken

**Mode — single-agent, one pass** (*human-answered*: "EXECUTION MODE: single-pass
(single-agent). Do not ask about multi-agent vs single-pass — it is decided."). Every
**Executor** cell reads `single pass`; each step's verification is inlined in its row.

D-1 … D-11 above are recorded *human-answered*, verbatim from the delegation's "Decisions
already made (do NOT re-open these in the plan)". No interview was run: the mode was stated
and no requirement met the interview bar.

The four **S-** items were explicitly delegated to me to settle. They are marked
*default-assumed (planner's call under S-n)* — no human has seen them yet:

- **S-2 — the ramp.** `gate` is the only check added to branch protection on day one.
  `skills` and `agents` ship **without** `continue-on-error`, so a real failure is red and
  visible; they simply are not *required*, so a throttled OpenRouter run cannot hold the
  merge button. Promote them into branch protection after two consecutive triggered runs
  come back green; the criterion goes into the file as a dated comment. This is strictly
  better than `continue-on-error: true` as a ramp, because a job-level `continue-on-error`
  reports the whole job as **success** — it turns a genuine harness regression green, which
  is the failure mode the ramp is supposed to avoid. `workflow` keeps
  `continue-on-error: true` as decided in D-1, since it is expected to be red for reasons
  that are not regressions.
- **S-3 — how a fork skip reads.** Job-level `if:` (grey "skipped" in the checks list),
  plus two things so nobody has to hover over it: the job **name** carries the reason
  (`skills (model-backed · same-repo PRs only)`), and `gate` — which always runs — writes
  one line into `$GITHUB_STEP_SUMMARY` on a fork PR: `fork PR: model-backed eval tiers
  skipped (OPENROUTER_API_KEY is not available to forks)`. The summary is the place a
  human already looks; a grey check is not.
- **S-1** and **S-4** are answered in **Verification plan** and under Step 4 respectively.

**R1 (A/B variant exclusion) is planned as Step 3 but is NOT a human decision** — see
**Recommendations**. Strike Step 3 and the R1 rows of Step 2's test table if it is declined;
nothing else in the plan depends on it.

## Settled during execution (2026-08-25, human-answered)

- **R1 — accepted.** A/B variants are excluded from the blocking `agents` matrix. Step 3 is
  implemented: `ci-detect.mjs` scrapes `variant: "<name>"` out of `src/artifacts/pairs.ts` as
  text (it stays dependency-free `.mjs`, so it cannot import the TS), fails **open** if the
  scrape finds nothing, and `src/ci-detect.test.ts` pins that the real `pairs.ts` is still
  scrapeable — the fail-open is only safe while something notices it firing.
- **Models — settled, and the split is per tier, not per repo.** Content tier
  (`skills`): `deepseek/deepseek-chat` under test, judged by `google/gemini-2.5-flash`, direct
  to OpenRouter with no proxy. Tool tiers (`agents`, `workflow`): `google/gemini-2.5-flash`
  under test, judged by `deepseek/deepseek-chat`, through the LiteLLM proxy. Task and judge are
  different families in **both** tiers — the same self-preference argument the package already
  makes for its default judge. All three are overridable per run via `workflow_dispatch`
  (`content_model`, `tool_model`, `judge_model`), resolved once in the `detect` job and passed
  down as job outputs so no default is written twice.
- **Skip behaviour — explicitly confirmed as a requirement, and hardened beyond the plan.** The
  detector now emits a `SKIP <tier> <name> (<reason>)` line per skipped artifact and writes them
  into `` itself, rather than leaving the YAML to reconstruct them. Two
  reasons exist: `no evals` and `A/B baseline`.

## Recommendations

- **R1 — exclude A/B *variant* artifacts from the `agents` matrix. Default: as requested
  (run it, and accept a job that is red by design).** *What:* the detector should route
  `architecture-reviewer-lite` to `skipped_agents` with the reason `(A/B baseline)` rather
  than into the blocking matrix. *Why:* the delegation describes
  `evals/agents/architecture-reviewer-lite/` as "eval.ts only — the A/B counterpart", but
  that file **is** a `*.eval.ts`, so `hasEvals("agents","architecture-reviewer-lite")`
  returns `true` and the shipped detector routes it into the matrix
  (`evals/scripts/ci-detect.mjs:31-35,58`). That eval grades the deliberately-degraded copy
  against the strict agent's own cases and threshold
  (`agents/architecture-reviewer-lite/architecture-reviewer-lite.eval.ts:1-9`) — it is a
  *baseline*, and scoring lower is the measurement, not a regression. Editing either side of
  the pair is **already** caught, for free and with a precise message, by `checkPairs()` in
  the zero-token `gate` job (`src/skill-quality.ts:141-151`). *If accepted:* Step 3 exists
  and Step 2's table gains two rows; if declined, delete Step 3 and expect the `agents` job
  to go red whenever the lite artifact is touched.
- **R2 — the `agents` catalog is not an agent. Default: as requested.** `.claude/agents/README.md`
  matches both the agent-name matcher (`^\.claude/agents/([^/]+)\.md$` → the name `README`,
  which lands in `skipped_agents`) and the `runWorkflow` predicate
  (`^\.claude/agents/.+\.md$`), so a docs-only edit to the catalog fires the model-backed
  workflow tier and prints a nonsense `SKIP README (no evals)` line. Folded into Step 1 as
  part of "fix the detector's routing"; it is one `basename !== "README.md"` guard.
- **R3 — pin pnpm 10 deliberately, and check the build approval on the first run.
  Default: as requested (`version: 10`).** `AGENTS.md:21-27` says
  `pnpm.onlyBuiltDependencies` is "dead config under pnpm 11" and that the live approval is
  `allowBuilds` in `evals/pnpm-workspace.yaml` — but every workflow in this repo pins
  `version: 10` (`client.yml:35-37` et al), `server`/`client` pin `pnpm@10.34.5`, and
  `evals/pnpm-lock.yaml` is `lockfileVersion: '9.0'`. Under pnpm 10 it is the *other* key
  (`onlyBuiltDependencies`, still present in `evals/package.json:34-36`) that grants the
  esbuild build, and `pnpm-workspace.yaml` carries no `packages:` field. So exactly one of
  the two approvals is live depending on the version, and the repo has never installed
  `evals/` on pnpm 10 in CI. Pin 10 for consistency with the rest of `.github/workflows/**`;
  the early signal is in the install log — `Ignored build scripts: esbuild`, or a vitest
  start-up failure about esbuild's binary. *If it fires:* add
  `"packageManager": "pnpm@10.34.5"` to `evals/package.json` and keep both approval keys.
  Either outcome is an insight candidate (the `AGENTS.md` line is written as if pnpm 11 were
  the only reality).
- **R4 — insight lines to propose to `/engineering-insights` (Step 7).** I cannot write
  `INSIGHTS.md`; these are drafts for the human to run through the skill, and the skill's
  pre-write read may legitimately reject any of them:
  - `- **2026-08-25** — Tool-tier evals need a model that actually dispatches: measured,
    google/gemini-2.5-flash does, deepseek/deepseek-chat and openai/gpt-4.1-mini do the work
    inline instead (evals/README.md:164-174). Putting DeepSeek on evals.yml's agents/workflow
    jobs produces systemic red that is a model signal, not a harness regression — the content
    tier is where DeepSeek belongs.`
  - `- **2026-08-25** — A CI trigger keyed on "CLAUDE.md changed" is inert in this repo:
    CLAUDE.md is a 2-line @AGENTS.md import (AGENTS.md:52-57) and the rules live in
    AGENTS.md — which is what evals/workflow/review-workflow.cases.ts asserts on by name.
    ci-detect.mjs shipped with that literal predicate and would never have fired; it now
    matches /(^|\/)(AGENTS|CLAUDE)\.md$/.`
- **R5 — do not add an `evals` slice to `scripts/verify.mjs`. Default: as requested (no
  change).** Tempting, since `verify.mjs` is "the one place to keep in step with"
  `.github/workflows/**` (`AGENTS.md:116-120`) — but three of the five jobs here spend real
  budget, and `verify.mjs` is run reflexively by agents. A slice that bills tokens breaks
  the contract in `AGENTS.md:81-87` that model-backed lanes never run as a side effect. The
  `gate` job's three commands are the model-free subset, and Step 6 documents them in
  `evals/README.md` rather than putting them behind a `--slice` that invites the other two.

## Constraints that bind this change

- **Does anything cross the wire?** No. Neither copy of `@devdigest/shared` is touched; no
  HTTP contract changes. (There *is* an internal contract — the detector's step outputs —
  pinned under **Contract & migration impact**.)
- **Contracts are Zod-first.** Not affected — no request or response schema in this change.
- **Migrations.** None. No SQL, no `server/src/db/**`.
- **Test lane.** No `*.it.test.ts` and no DB. The analogous rule *does* bind here:
  `evals/vitest.config.ts:8` splits on `**/*.eval.ts` (model-backed) vs `src/**/*.test.ts`
  (model-free). The new detector test must be `evals/src/ci-detect.test.ts` — anything named
  `*.eval.ts` would land in a billing lane.
- **Package manager per step.** Only `evals/` → **pnpm**, pinned to 10 (see R3). No root
  install exists to add anything to.
- **`reviewer-core` never emits JS.** Not affected — not touched.
- **Do-not-touch paths.** None touched: no `server/clones/**`, no applied migration, no
  `**/src/vendor/ui/**`.
- **Layering.** Not affected — `server/.dependency-cruiser.cjs` governs `server/`, and
  `evals/` has no dependency-cruiser config. The only internal boundary that binds is
  `evals/src/artifacts/paths.ts` owning the `.claude/**` locations; Step 3 reads
  `src/artifacts/pairs.ts` rather than re-listing the pair, which keeps that single source.
- **Slice.** Everything here is `meta` per `routing.md` (`.claude/**`, `*.md`, and
  "anything else" — which is where `evals/**` and `.github/workflows/**` land). `meta` maps
  to no skill, so every **Skills** cell is `—` by the map.

## Steps

| # | Change | Files / seams | Slice | Satisfies | Depends on | Executor | Skills the executor applies | Verification |
|---|--------|---------------|-------|-----------|------------|----------|-----------------------------|--------------|
| 1 | Fix the detector's routing and make it importable: broaden `runWorkflow` to `/(^\|\/)(AGENTS\|CLAUDE)\.md$/` (any depth, either name) while keeping the existing `^evals/workflow/` and `^evals/src/` rules; exclude `.claude/agents/README.md` from both the agent-name matcher and the agent rule (R2); extract the pure mapping as an exported `detectSuites({ changed, hasEvals })` and put the env-read/`$GITHUB_OUTPUT`-write behind a main-module guard so importing the file has no side effects. Stays plain `.mjs`/no-deps on purpose — the `detect` job then needs no install | `evals/scripts/ci-detect.mjs` (rewrite in place; keep the header comment and update the mapping lines it documents) | meta | U-2, U-3, D-3, R2 | — | single pass | — | `CHANGED_FILES=$'server/AGENTS.md' node scripts/ci-detect.mjs` prints `run_workflow=true` (outputs go to stdout when `$GITHUB_OUTPUT` is unset — `ci-detect.mjs:73`); then Step 2's test |
| 2 | Unit-test the detector in the **model-free** lane: add `"allowJs": true` to the evals tsconfig so a TS test may import the `.mjs`, and add a table-driven test over `detectSuites` | `evals/tsconfig.json` (+`allowJs`; `scripts/` needs no `include` entry — the relative import pulls it in), new `evals/src/ci-detect.test.ts` | meta | D-3, S-1 | 1 | single pass | — | `cd evals && pnpm exec vitest run src/` and `pnpm typecheck` |
| 2a | …test rows, each an explicit `CHANGED_FILES` list → expected outputs: `server/AGENTS.md` → `run_workflow=true`; `client/AGENTS.md` → true; root `CLAUDE.md` → true; `.claude/agents/doc-writer.md` → `agents=[]` (no evals) + `skipped_agents="doc-writer"` + `run_workflow=true`; `.claude/skills/dependency-checker/SKILL.md` → `skills=["dependency-checker"]`; `.claude/skills/zod/SKILL.md` → `skills=[]` + `skipped_skills="zod"`; `evals/src/runtime/env.ts` → `run_workflow=true`; `.claude/agents/README.md` → **no** agent, **no** workflow run (R2); `README.md` (root) → nothing; a file list containing a space or a quote → no crash | `evals/src/ci-detect.test.ts` | meta | D-3, S-1, R2 | 2 | single pass | — | same command as Step 2 |
| 3 | *(R1 — strike this step if R1 is declined)* Route A/B **variant** artifacts to `skipped_agents` with the reason `(A/B baseline)` instead of into the blocking matrix. Single-source the list by reading `evals/src/artifacts/pairs.ts` as text and scraping `variant: "<name>"`; fail **open** (exclude nothing) if the scrape finds none, and pin that with a test row asserting `architecture-reviewer-lite` is found | `evals/scripts/ci-detect.mjs`, `evals/src/ci-detect.test.ts`, reads `evals/src/artifacts/pairs.ts:48-53` (unchanged) | meta | R1 | 1, 2 | single pass | — | test rows: `.claude/agents/architecture-reviewer-lite.md` → `agents=[]`, `skipped_agents` contains it; `.claude/agents/architecture-reviewer.md` → `agents=["architecture-reviewer"]` |
| 4 | Write the workflow. Sub-steps 4a–4e below are one file, written once | new `.github/workflows/evals.yml` | meta | U-1…U-4, D-1, D-2, D-4…D-10 | 1, 2, (3) | single pass | — | `actionlint .github/workflows/evals.yml` if the binary is present; otherwise a careful read against `mcp.yml`/`pr-gate.yml`. Truly validated only by the first PR that opens against it |
| 4a | Skeleton: `on.pull_request.paths` = `.claude/**`, `**/AGENTS.md`, `**/CLAUDE.md`, `evals/**`, `.github/workflows/evals.yml`; `workflow_dispatch` with inputs `content_model`, `tool_model`, `force_workflow_tier` (boolean); `permissions: contents: read`; `concurrency: evals-${{ github.ref }}` + `cancel-in-progress: true`; `defaults.run.working-directory: evals`; a reusable setup block (`actions/checkout@v4`, `pnpm/action-setup@v4` `version: 10`, `actions/setup-node@v4` node 22 + `cache: pnpm` + `cache-dependency-path: evals/pnpm-lock.yaml`, `pnpm install --frozen-lockfile`). A header comment states why the file exists, why `verify.mjs` does not own it (R5), and what each job costs | `.github/workflows/evals.yml` | meta | D-4, D-7, D-9, U-4 | — | single pass | — | as Step 4 |
| 4b | `gate` job — no fork guard, `timeout-minutes: 10`: `pnpm typecheck`, `pnpm eval:quality`, `pnpm exec vitest run src/`. Zero tokens; this is the one intended to become a required check. On a fork PR it appends the S-3 explanation line to `$GITHUB_STEP_SUMMARY`. `detect` job — `needs: []`, `fetch-depth: 0`, **no install** (the detector is dependency-free): one step computes `CHANGED_FILES` from `git diff --name-only "$BASE_SHA"...HEAD` with the base SHA passed via `env: BASE_SHA: ${{ github.event.pull_request.base.sha }}` (never inline in a command position — `pr-gate.yml:52-62`), keeps the file list in a shell variable/`$RUNNER_TEMP` file and never echoes it into a command, then runs `node scripts/ci-detect.mjs`; `outputs:` re-exports `skills`, `agents`, `run_workflow`, `skipped_skills`, `skipped_agents`. On `workflow_dispatch` there is no base SHA — treat `CHANGED_FILES` as empty and let `force_workflow_tier` decide | `.github/workflows/evals.yml` | meta | D-1, D-5, D-6, D-10, S-3 | 4a | single pass | — | as Step 4; `gate`'s three commands are runnable locally (see **Verification plan**) |
| 4c | `skills` job — `needs: [detect]`, `if:` same-repo **and** `needs.detect.outputs.skills != '[]'`, `strategy: {fail-fast: false, matrix: {name: ${{ fromJSON(needs.detect.outputs.skills) }}}}`, `timeout-minutes: 25`. Env: `EVAL_BACKEND: openrouter`, `OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}`, `EVAL_MODEL`/`EVAL_JUDGE_MODEL` = `${{ inputs.content_model \|\| 'deepseek/deepseek-chat' }}`. **No proxy and no `OPENROUTER_BASE_URL`** — the content tier goes direct (`dispatch.ts:13-17`). Run `pnpm exec vitest run "skills/$NAME"` with `env: NAME: ${{ matrix.name }}`, never the raw expression in the command | `.github/workflows/evals.yml` | meta | U-1, D-1, D-2 | 4b | single pass | — | as Step 4 |
| 4d | `agents` job — same shape as 4c over `detect.outputs.agents`, plus `max-parallel: 1` (README's throttling caveat, `evals/README.md:176-179`), `timeout-minutes: 30`, and the tool-tier env: `EVAL_MODEL`/`EVAL_JUDGE_MODEL` = `${{ inputs.tool_model \|\| 'google/gemini-2.5-flash' }}` **and** `OPENROUTER_BASE_URL: http://localhost:4000`. Proxy lifecycle around the run: `docker compose -f proxy/docker-compose.yml up -d` → `pnpm proxy:wait` → the tier → `if: failure()` `docker compose … logs --tail 100` → `if: always()` `down`. `workflow` job — same env and proxy block, `if: needs.detect.outputs.run_workflow == 'true' \|\| inputs.force_workflow_tier` (string compare — the output is the literal `"true"`/`"false"`), `continue-on-error: true`, `timeout-minutes: 40`, running `pnpm eval:workflow`. The `continue-on-error` carries an inline comment naming the reason and its source: `evals/README.md:180-186`, the 2026-08-25 measurement that `activation` cases are behaviour-shaped and a capable non-Anthropic model may do the action directly instead of invoking the `Skill` tool — a red merge blocker for that trains the team to ignore red | `.github/workflows/evals.yml` | meta | U-2, U-3, D-1, D-2, D-7, D-8 | 4c | single pass | — | as Step 4 |
| 4e | Observability in all five jobs: a final `if: always()` step appending a short block to `$GITHUB_STEP_SUMMARY` (tier, model actually used, pass/fail, and for `detect` the routing decision **including** one `SKIP <name> (no evals)` line per entry in `skipped_skills`/`skipped_agents` — and per R1 `SKIP <name> (A/B baseline)`); `actions/upload-artifact@v4` of `evals/results/**` with `retention-days: 7` and `if-no-files-found: ignore` on the three model-backed jobs. `results/` is gitignored and append-only (`evals/.gitignore:2`, `record.ts:7`), so publishing it is safe — but the executor must confirm no step summary or artifact path echoes a raw changed-file name into a shell | `.github/workflows/evals.yml` | meta | D-10 | 4d | single pass | — | as Step 4 |
| 5 | Correct root `AGENTS.md:21-27`. The precise correction: `verify.mjs` still does not know `evals/` (verified — its slice list has no `evals`), but "not part of any CI slice" is now false. Rewrite to say the harness evals run in their own workflow, `.github/workflows/evals.yml`, on PRs that touch `.claude/**`, an `AGENTS.md`/`CLAUDE.md` or `evals/**`; the zero-token `gate` job is the required check and the model-backed tiers are budget-spending, matrix-routed by `evals/scripts/ci-detect.mjs`. Keep it to the existing bullet's size — the Conventions list is a cap-7 promotion target, not a place for a paragraph | `AGENTS.md` (the `evals/` bullet, lines 21-27) | meta | D-11 | 4 | single pass | — | read-back: the bullet must not contradict the file written in Step 4 (`AGENTS.md:58` — CI wins) |
| 6 | Rewrite `evals/README.md` "### Wiring it into GitHub Actions (per-PR)" (line ~191, through the Notes block at ~246): replace the illustrative YAML with a pointer to the real `.github/workflows/evals.yml`, the job list and what each costs, the model-switch knob (job `env` for the default, `workflow_dispatch` inputs `content_model`/`tool_model`/`force_workflow_tier` for a one-off), the `EVAL_MODEL`-must-be-a-slug gotcha (already at :115 — cross-reference, do not restate), the fork caveat (no `OPENROUTER_API_KEY` on forks → only `gate` runs), and the required-check ramp from S-2. Then update "Which change → which run" (:608-618): the `CLAUDE.md` row becomes `CLAUDE.md` / **any `AGENTS.md`** / activation / dispatch, and a row is added for what CI does automatically | `evals/README.md` | meta | D-11 | 4, 5 | single pass | — | read-back against the workflow file; every command quoted must exist in `evals/package.json` scripts |
| 7 | Insight sweep: run `/engineering-insights` in the main session with R4's drafts as input (the skill decides what is worth recording and re-reads the file first — `INSIGHTS.md:6-27`). Then the PR body's **Insights** section (`AGENTS.md:60-63`) states what was appended, or plainly that nothing was | root `INSIGHTS.md` (written by the skill, not by hand) | meta | D-11 | 5, 6 | single pass | — | `/engineering-insights`'s own output; append-only format check |
| 8 | Human actions outside the repo, in this order: (i) add `OPENROUTER_API_KEY` to repo **Actions** secrets (Settings → Secrets and variables → Actions); (ii) open the PR and let it run; (iii) once green, add **only** `evals / gate` to branch protection as a required check; (iv) after two consecutive triggered green runs, add `skills` and `agents` (S-2). Nothing in the repo can do these | — (GitHub settings) | meta | D-2, S-2 | 4 | single pass (human action) | — | the first PR is the verification — see **Verification plan** |

**Cost estimate (S-4) — an estimate, not a measurement.** Derived from published list
prices × `MAX_TURNS=8` (`config.ts:11`) and the current case counts (5 skill cases, 4 agent
cases, 6 workflow sessions); no run has been billed yet. Per PR that triggers a tier:
`skills` (DeepSeek, 5 cases + judge) **≈ $0.01–0.03**; `agents` (Gemini 2.5 Flash via the
proxy, 4 multi-turn sessions with file reads) **≈ $0.05–0.15**; `workflow` (6 live-repo
sessions, the heaviest) **≈ $0.15–0.35**. Worst case, all three fire: **≈ $0.2–0.5 per PR**.
A typical PR touching one skill stays under **$0.05**. Wall clock: `gate` ~2 min, `skills`
~5–20, `agents` ~10–25, `workflow` ~15–30 (bounded by the `timeout-minutes` above, which
come from 4 min/test × case count). Replace these figures with the first real run's
`evals/results/records.jsonl` — it persists per-run token counts.

## Execution

**Single-agent — one pass.** Steps in numerical order; each step's verification is the last
column of its own row, run before moving on. No handoffs, no delegation, no implementation
report.

The order is not negotiable at its head: **Steps 1–3 (the detector) come before Step 4 (the
workflow)**, because a workflow built on a detector that misroutes is worse than no
workflow — it spends budget on the wrong tier and stays quiet on the right one. Steps 5–7
(docs) come after Step 4 so they describe a file that exists rather than one that is
planned. Step 8 is the human's, and step (iii) of it happens only after the first PR run is
green.

Reviews the human runs by hand afterwards, since no chain runs them here: `/code-review` on
the diff, and `/pr-self-review` before opening the PR (it drafts the body including the
**Insights** section `AGENTS.md:60-63` requires). `/security-review` is worth the tokens on
this one despite the small diff — it is a CI workflow that handles a secret and consumes
git-derived file names.

## Contract & migration impact

**Nothing crosses the wire; no migration.** Neither `@devdigest/shared` copy is touched and
there is no SQL in this change.

There *is* one internal contract, and it is exactly the kind that two sides implement
differently when it is left implicit: **the five step outputs of `ci-detect.mjs`**, produced
by Step 1/3 and consumed by Step 4. Pinned per field:

| Output | Producer writes | Consumer reads | Meaning, per value |
|---|---|---|---|
| `skills` | `JSON.stringify(string[])` — bare artifact names, no path, sorted | `fromJSON(...)` as a matrix vector, **and** a string compare `!= '[]'` as the job `if:` | `[]` means "no skill with evals changed" → the job must be *skipped*, not run empty. A name is the directory name under both `.claude/skills/<name>/` and `evals/skills/<name>/` — the same token in both trees, which is what makes `vitest run skills/$NAME` valid |
| `agents` | same shape | same | `[]` → skip. A name is the basename of `.claude/agents/<name>.md` **and** the directory `evals/agents/<name>/`. Never `README` (R2), never an A/B variant (R1) |
| `run_workflow` | `String(boolean)` — the literal `"true"` or `"false"` | `needs.detect.outputs.run_workflow == 'true'` — a **string** compare; there are no booleans in step outputs | `"true"` → run the workflow tier. `workflow_dispatch` bypasses it via `force_workflow_tier` |
| `skipped_skills` | space-separated names, `""` when none | rendered into `$GITHUB_STEP_SUMMARY` as one `SKIP <name> (no evals)` line each | A **deliberate skip, not a failure**: the artifact changed and has no `*.eval.ts`. It must never turn a job red, and must never be silent either |
| `skipped_agents` | same | same, plus `SKIP <name> (A/B baseline)` if R1 is accepted | Two distinct reasons share one field — "no evals written" vs "excluded on purpose". The summary line must say which, or the two read identically to a reviewer and someone will "fix" the baseline by writing evals for it |

Second variant-shaped field, same treatment: **`EVAL_MODEL` means different things per
job.** On `skills` (content tier) it is any OpenAI-compatible OpenRouter slug and needs no
proxy. On `agents`/`workflow` (tool tiers) it must be a slug that actually *dispatches*
(`google/gemini-2.5-flash` — measured, `evals/README.md:164-174`) and, unless it is an
`anthropic/*` slug served by OpenRouter's Anthropic Skin, it requires `OPENROUTER_BASE_URL`
pointed at the LiteLLM proxy. Putting the content-tier default on a tool tier produces
systemic red that is a model signal, not a harness regression; putting a tool-tier default
on the content tier merely costs more. The workflow file states this per job in a comment,
not once at the top.

## Verification plan

`evals/` is **not** a `verify.mjs` slice (`scripts/verify.mjs` has no `evals` in its slice
list, and R5 recommends keeping it that way), so there is no `node scripts/verify.mjs
--slice …` line to write. What applies instead, all of it **model-free** (S-1 — no step
here spends a token):

- `cd evals && pnpm typecheck` — covers Steps 1–3, including the `allowJs` change.
- `cd evals && pnpm eval:quality` — the static gate over skills, agents and the A/B pair
  hashes. Zero tokens (`src/skill-quality.ts`).
- `cd evals && pnpm exec vitest run src/` — the model-free lane
  (`vitest.config.ts:8` → `src/**/*.test.ts`); this is where the new detector test runs.
- Detector against synthetic inputs, in a **Bash** shell (Git Bash on this machine; the
  `VAR=… cmd` prefix is not PowerShell syntax), from `evals/`, with `$GITHUB_OUTPUT` unset
  so the outputs print to stdout (`ci-detect.mjs:73`). At minimum:
  `CHANGED_FILES=$'server/AGENTS.md' node scripts/ci-detect.mjs` → `run_workflow=true`;
  `CHANGED_FILES=$'.claude/skills/zod/SKILL.md' node scripts/ci-detect.mjs` →
  `skills=[]` + `skipped_skills=zod`;
  `CHANGED_FILES=$'.claude/skills/dependency-checker/SKILL.md' …` →
  `skills=["dependency-checker"]`;
  `CHANGED_FILES=$'evals/src/runtime/env.ts' …` → `run_workflow=true`;
  `CHANGED_FILES=$'.claude/agents/README.md' …` → no agent, no workflow run.
  These duplicate Step 2a on purpose — the test proves the function, this proves the CLI
  wrapper and the main-module guard still work after the refactor.
- `actionlint .github/workflows/evals.yml` **if the binary is available** (it is not vendored
  here; `gh extension install rhysd/actionlint` or the Docker image are the usual routes). If
  it is not, say so in the PR body rather than claiming the YAML was linted.
- Repo-wide PR gates, which run on this branch like any other: `node scripts/pr-gate-ci.mjs`
  and `node scripts/check-specs.mjs` (both via `/pr-self-review` or the `pr gate` workflow,
  which has no `paths:` filter by design).
- **The honest limit:** none of the above executes the workflow. GitHub Actions YAML —
  `fromJSON` on an empty matrix, the `needs` graph, the fork `if:`, the secret binding, the
  proxy's health under a runner's network — is only truly validated by **the first pull
  request that opens against the merged file**. Plan for the first PR to be the test: keep it
  small, expect one or two red-then-fixed iterations on the workflow file itself, and do not
  add anything to branch protection (Step 8 iii) until a run has actually gone green.

## Out of scope / left to reviewers

- Adding an `evals` slice to `scripts/verify.mjs` (R5 — deliberately not done).
- Writing evals for any artifact that currently has none. Every skill except
  `dependency-checker` and every agent except `architecture-reviewer` will produce a
  `SKIP … (no evals)` line; that is the designed behaviour, not a gap this change closes.
- Running any model-backed tier locally to "prove" the wiring — barred by S-1 and by
  `AGENTS.md:81-87`.
- Caching the LiteLLM image, retry/backoff on OpenRouter throttling, `push`-to-`main` runs,
  and scheduled/nightly full-suite runs. All are defensible later; none is required by U-1…U-4.
- Branch-protection changes and the Actions secret (Step 8 — human, outside the repo).
- `/code-review`, `/security-review`, `/pr-self-review` and the PR itself.

## Risks

| Risk | Cheapest early signal |
|---|---|
| pnpm 10 vs the `allowBuilds`/`onlyBuiltDependencies` split (R3) leaves esbuild unbuilt and vitest cannot start in **every** job | The `pnpm install --frozen-lockfile` log line `Ignored build scripts: esbuild`, seen in `gate` — the first and cheapest job — before any tokens are spent |
| An empty dynamic matrix (`fromJSON('[]')`) behaves differently from the `if:` guard expected, and `skills`/`agents` either error or run with a blank name | The `if: needs.detect.outputs.skills != '[]'` guard is what makes this a non-issue; the signal is the first PR that changes only `evals/src/**` — both matrices must show as *skipped*, and `workflow` must run |
| OpenRouter throttling degrades a tool-tier run to a single turn and the `agents` job goes red for a reason that is not a regression (`evals/README.md:176-179`) | `max-parallel: 1` is the mitigation; the signal is a failing dispatch assertion with a short trace in the uploaded `results/` artifact. This is precisely why S-2 keeps `agents` out of branch protection at first |
| The LiteLLM container never becomes healthy on a runner (image pull, port, key not reaching the container) | `pnpm proxy:wait` fails within ~2 min (`litellm-proxy.sh:33-45` — 60 × 2 s) *before* any eval runs, and the `if: failure()` step dumps `logs --tail 100` |
| The workflow tier runs with `bypassPermissions` against the live checkout (`evals/README.md` isolation note) and a model decides to `Write` | Harmless in CI by design — the checkout is disposable and `permissions: contents: read` means the token cannot push. Signal: unexpected `git status` output in the job, which is worth one `git status --short` line in the workflow tier's step summary |
| The docs (Steps 5–6) drift from the file within a month, re-creating exactly the illustrative-YAML problem this change is fixing | Both documents *point at* `.github/workflows/evals.yml` rather than reproducing it; the review question is "does any YAML remain pasted in the README" |
| The detector regex change over-triggers — every PR touching any `AGENTS.md` now fires the model-backed workflow tier, and this repo has six of them | The cost line in the first week's runs. If it bites, the narrowing move is to keep `run_workflow` on `AGENTS.md`/`CLAUDE.md` but require a non-trivial diff — not planned now, and explicitly not worth pre-optimising: U-2 asked for exactly this trigger |

## Open questions

- **R1 (exclude A/B variants from the `agents` matrix) — accept or strike?** Default the
  executor assumes: **accept**, Step 3 is written. Declining costs nothing but a job that is
  red by design whenever `architecture-reviewer-lite.md` is edited.
- **Is `actionlint` available on this machine?** Default: assume **not**; the workflow is
  reviewed by reading, and the PR body says the YAML was not linted.
- **R3 — does `evals/` install cleanly on pnpm 10 in CI?** Default: assume **yes** and pin
  `version: 10`. The install log in the `gate` job answers it on the first run; the fix if
  not is one `packageManager` line.
