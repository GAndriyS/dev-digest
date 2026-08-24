# Iteration 1 — comparative grading notes

`onion-architecture` skill, A/B over three review evals. Grader read the fixtures and
cross-checked every load-bearing repo claim (depcruise rule names and bodies,
`container.ts` members, `errors.ts` status codes, `reviewsForPull` shape,
`schema/pulls.ts` indexes, workflow lane globs) against the real tree.

**Result: 6/6 on all six runs. Every assertion passed in both configurations.**

| run | passed |
|---|---|
| eval-0-with_skill | 6/6 |
| eval-0-without_skill | 6/6 |
| eval-1-with_skill | 6/6 |
| eval-1-without_skill | 6/6 |
| eval-2-with_skill | 6/6 |
| eval-2-without_skill | 6/6 |

## Planted violations found

| eval | planted violation | with_skill | without_skill |
|---|---|:--:|:--:|
| 0 | `routes.ts:29-46` GET handler runs Drizzle itself (`routes-through-service`) | ✓ A-1 | ✓ C1 |
| 0 | `service.ts:5,42-44` constructs `OctokitGitHubClient` (`no-direct-adapter-clients`) | ✓ A-2 | ✓ C3 |
| 0 | `service.ts:26-29` `create()` takes `FastifyRequest` (`service-stays-http-agnostic`) | ✓ A-3 (+A-4) | ✓ C2 (+B1) |
| 1 | `summarizer.ts:1,33-36` `node:fs` read inside the core (`core-has-no-io`) | ✓ #1 | ✓ #1 |
| 1 | `summarizer.ts:4,30` imports `server/src/platform/config.js` (`core-does-not-import-server`) | ✓ #2 | ✓ #2 |
| 1 | `summarizer.ts:57-66` direct `fetch()` to the GitHub API | ✓ #3 | ✓ #3 |
| 2 | `service.ts:4,22` imports another module's repository (`no-cross-module-internals`) | ✓ B1 | ✓ A3 |
| 2 | `repository.ts:33-35,37-40` `remove()` / `countForPull()` unscoped by `workspaceId` | ✓ H2, H4 | ✓ C11, C13 |
| 2 | `watchlist.test.ts:7-13` `vi.mock` by path + DB test named `*.test.ts` | ✓ H1, B7 | ✓ B8, B7 |

9/9 in both columns. Not one planted violation separated the configurations.

## Signal-to-noise

| run | findings | planted-violation findings | invented / wrong |
|---|--:|--:|--:|
| eval-0-with_skill | 18 | 3 | 0 |
| eval-0-without_skill | 22 | 3 | 0 |
| eval-1-with_skill | 13 | 3 | 0 |
| eval-1-without_skill | 16 | 3 | 0 |
| eval-2-with_skill | 16 | 3 | 0 |
| eval-2-without_skill | 20 | 3 | 0 |

The planted-to-total ratio looks bad in both columns (≈15–23%), but that is an artifact
of the fixture design, not of either configuration: the fixtures import a `t.exports` /
`t.watchlist` table, `ExportRecord` / `WatchlistEntry` contracts, `helpers.ts`,
`constants.ts` and a `test/helpers/db.js` that do not exist in the repo, so roughly a
third of every review is legitimate does-not-compile reporting. Per the grading brief
those were not scored, but they are correct findings, not noise.

**Nothing invented, in either configuration.** Spot-checks that could have caught
fabrication all came back clean:

- rule names — `routes-through-service`, `service-stays-http-agnostic`,
  `no-direct-adapter-clients`, `no-cross-module-internals`, `core-has-no-io`,
  `core-does-not-import-server`, `no-orphans` all exist in
  `server/.dependency-cruiser.cjs`; both configs quoted their comment text verbatim.
- `LAYERLESS_MODULES = '^src/modules/(polling|pulls|settings|workspace)/'` and
  `PURE_ADAPTERS` — quoted correctly by both.
- container members — `reviewRepo` getter at `container.ts:111-113`, `async github()`
  at `:199`, `ContainerOverrides` at `:45` — all real, cited with the right line
  numbers by both.
- `errors.ts` — `ConfigError` = 500, `ValidationError` = 422, `NotFoundError` = 404:
  both got these right.
- `reviewsForPull(db, prId): Promise<{ review; findings }[]>`, `getRepo(repoId)`,
  `uniqueIndex('pr_repo_number_uq')` at `schema/pulls.ts:31`, `vitest.config.ts:14`,
  the two lane globs in `.github/workflows/server-{unit,integration}.yml` — all
  verified, all cited accurately.

Both configurations also independently made the same genuinely sharp negative claim in
eval-1: `core-has-no-io` lists module specifiers, so a bare global `fetch()` slips past
it — the rule is violated and CI stays green.

## Depth — named fix vs flagged smell

Both configurations named the correct fix, not just the smell, for every planted
violation:

| fix | with_skill | without_skill |
|---|:--:|:--:|
| `await this.container.github()` instead of `new OctokitGitHubClient` | ✓ | ✓ |
| service takes `(workspaceId, prId, input)`; `getContext` stays in `routes.ts` | ✓ | ✓ |
| route delegates to `service.listForPull` → `repo.listForPull` | ✓ | ✓ |
| core receives `skillBodies` / commit subjects; I/O moves to the caller | ✓ | ✓ |
| `container.reviewRepo` instead of importing `reviews/repository/...` | ✓ | ✓ |
| `ContainerOverrides` / `new Container(config, db, { github: … })` instead of `vi.mock` | ✓ | ✓ |
| `*.it.test.ts` lane glob, with the workflow lines | ✓ | ✓ |

Where they differ is in the *extra* depth, and it goes both directions:

- **with_skill only** — spotted that `service-stays-http-agnostic` has no
  `dependencyTypesNot: ['type-only']` escape while `no-direct-adapter-clients` does, so
  even `import type { FastifyRequest }` is an error (eval-0 A-3); argued that a
  locally-built Octokit client misses `invalidateSecretCaches()` and holds a stale
  token (eval-0 A-2); noted the `vi.mock` path is a string literal, so depcruise is
  structurally blind to it (eval-2 H1); asked whether the new `exports` table duplicates
  the existing `digests` table in `schema/ops.ts:41`.
- **without_skill only** — the N+1 in `WatchlistService.digest` and the `inArray` fix
  that also dissolves the index-drift bug (eval-2 C16); the test hardcoding 25/26
  instead of importing `MAX_WATCHED_PULLS`, with the note that `constants.ts` is the
  legal public surface (C17); the missing `dockerAvailable()` skip gate (B9); entries
  whose PR was deleted still counted in `watched` (C20); the `dotenv` pull-in as an
  undeclared dependency given reviewer-core's own lockfile (eval-1 #2); the
  `MAX_PR_DESCRIPTION_CHARS = 4000` cap that `summarizeReview` bypasses (eval-1 #10).

On raw count the without_skill runs reported *more* correct findings in all three evals
(22 vs 18, 16 vs 13, 20 vs 16). The with_skill runs were somewhat cheaper to produce in
two of three evals (17 vs 26 and 20 vs 26 tool calls in eval-1 and eval-0; 28 vs 25 in
eval-2), at essentially identical token totals (74k–89k across all six).

## Non-discriminating assertions

**All eighteen.** Every assertion in all three eval files passed in both
configurations, so none of them carries information about the skill:

- `a0-route-queries-db`, `a0-adapter-constructed`, `a0-service-takes-request`,
  `a0-cites-locations`, `a0-no-false-scoping-claim`, `a0-fixtures-untouched`
- `a1-fs-read`, `a1-imports-server`, `a1-http-fetch`, `a1-fix-direction`,
  `a1-cites-locations`, `a1-fixtures-untouched`
- `a2-cross-module-repo`, `a2-unscoped-query`, `a2-vi-mock-seam`,
  `a2-it-test-naming`, `a2-cites-locations`, `a2-fixtures-untouched`

Three sub-classes are worth calling out as structurally weak rather than merely
unlucky:

- `*-fixtures-untouched` is a prompt-compliance check ("нічого не редагуй"), not an
  architecture check. It will pass in every well-behaved run and costs a full slot in
  each eval.
- `*-cites-locations` is satisfied by the output format both configurations already
  default to. Both had 2–3 line-less findings out of 16–22, all of them
  absence-of-code findings ("no `routes.ts`", "not registered in `modules/index.ts`",
  "no tests") where a line cannot exist.
- `a0-no-false-scoping-claim` is the only negative assertion in the suite and it is
  a good idea, but the trap did not spring: both runs explicitly praised
  `exports/repository.ts` as correctly scoped. A trap nobody falls into measures
  nothing. Note it is also mis-aimed for the fixture set — the *watchlist* repository
  is the one with real scoping holes, so an agent primed to look for tenancy bugs has
  no incentive to over-report in eval-0.

For iteration 2 the discriminating signal has to come from somewhere else: harder cases
(a violation depcruise cannot see and the repo contains no precedent for), precision
scoring (findings per real defect, so the extra volume in the without_skill runs shows
up as a cost), false-positive traps that a *correct-looking* answer would trip, or cost
ceilings (a token/tool-call budget the without_skill run exceeds while still landing all
the planted violations).

## What does the skill actually add?

On this evidence: nothing measurable, because the repository already teaches the agent
everything the skill would have. Both configurations found 9/9 planted violations,
named the same fixes down to the same container member (`container.github()`,
`container.reviewRepo`), the same test seam (`ContainerOverrides` over `vi.mock`), and
the same lane glob (`*.it.test.ts`) — and both got there by reading
`server/.dependency-cruiser.cjs`, `AGENTS.md`, `reviewer-core/AGENTS.md` and
`container.ts` directly, quoting the rule comments verbatim. The machine-enforced
boundaries in this repo *are* the skill's content, written down in a file an agent
finds on its own; the skill mostly restates them. The two effects that did show up are
economic, not qualitative: the with_skill runs reached the same verdict with ~25-35%
fewer tool calls in two of three evals (no exploration needed to discover the rules) and
were somewhat tighter, while the without_skill runs, having actually crawled the repo,
came back with more correct incidental findings (N+1, docker gate, orphan digest
entries) at the same token cost. The one place the skill plausibly earned its keep is
rule *nuance* rather than rule existence — the type-only exemption asymmetry between
`no-direct-adapter-clients` and `service-stays-http-agnostic` — which the with_skill run
stated and the without_skill run did not. That is a real but thin margin, and this eval
suite cannot see it: to justify the skill, iteration 2 has to test cases where the
config file is silent, ambiguous, or wrong.
