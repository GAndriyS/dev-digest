# Evals — onion-architecture

The skill's own test set. It ships **inside** the skill folder on purpose: a
skill that is delivered elsewhere should arrive with the cases that prove it
still works, not with a pointer to a harness that stayed behind.

- `evals.json` — the cases: prompt, fixtures, planted violations, assertions.
- `fixtures/` — the code under review. Nothing here is real: the modules
  reference tables, contracts and helpers that do not exist in the repo, and
  none of it is imported by anything. It sits outside every package's
  `tsconfig`, so `pnpm typecheck` and `depcruise` never see it.

The harness that runs these cases lives in `skill-evals/` at the repo root
(runner, grader prompt, recorded baselines, results). It discovers this file by
convention: `.claude/skills/<skill>/evals/evals.json`. Every comparison ever run,
with the reviews kept verbatim, is indexed in `skill-evals/HISTORY.md`.

```bash
node skill-evals/run.mjs --skill onion-architecture
```

## The one rule for fixtures

**A fixture never names its own bug.** No `// BUG:`, no "this violates X", no
docblock hinting that something is off. The comments explain the feature the
way a real author would, and the violations sit in plain code. A fixture that
labels its own planted violation measures reading comprehension, not the skill.

Same for the prompts: they say "глянь перед PR", never "перевір межі шарів" and
never how many problems there are. A prompt that names the domain hands the
answer to the baseline run too, and the comparison stops meaning anything.

## What the cases cover

Three groups, and the group tells you what a case is worth.

**`machine-enforced`** — violations `server/.dependency-cruiser.cjs` already
catches.

| Case | Fixture | Planted |
|---|---|---|
| `new-module-layering` | `exports-module/` | route queries Drizzle directly · service constructs the adapter · service takes `FastifyRequest` |
| `core-purity` | `core-digest/summarizer.ts` | `node:fs` in the core · import from `server/` · direct `fetch()` |
| `cross-module-and-seams` | `watchlist-module/` | another module's repository imported · queries unscoped by `workspaceId` · `vi.mock` seam + wrong test-lane glob |

**`blind-spots`** — no import to see, so the config is structurally silent.

| Case | Fixture | Planted |
|---|---|---|
| `core-network-blind-spot` | `core-enrich/enrich.ts` | global `fetch()` in the core |
| `type-only-request-leak` | `digests-module/` | `import type { FastifyRequest }` + two edge-validation controls |
| `foreign-table-read` | `alerts-module/` | another module's tables read via `container.db` |
| `secret-cache-invalidation` | `publisher-module/` (6 files) | a cached client the invalidation list forgets · a getter with no `overrides` check · a missing mock |

**`team-decisions`** — conventions that exist in no file and contradict what the
code suggests.

| Case | Fixture | Planted |
|---|---|---|
| `team-conventions` | `annotations-branch/` | new columns on the closed `reviews` table · new `ON DELETE CASCADE` foreign keys |

## What four measured comparisons taught us (24/08/2026)

**Only the last group discriminates.** Everything else is saturated — both
configurations score 100%, so those cases are regression guards, not A/B
instruments:

| Comparison | Runs/side | With | Without/older | Δ |
|---|:--:|:--:|:--:|:--:|
| cases 0–2, skill vs no skill | 1 | 18/18 | 18/18 | 0 |
| cases 3–5, v1.1.0 vs v1.0.0 | 1 | 17/17 | 17/17 | 0 |
| case 6, v1.1.0 vs v1.0.0 | 5 | 45/45 | 45/45 | 0 |
| **case 7, v2.0.0 vs v1.1.0** | **5** | **45/45** | **27/45** | **+0.40** |

The reason is structural. An agent with this repository in front of it reads
`server/.dependency-cruiser.cjs`, `AGENTS.md` and `container.ts` and derives the
skill's rules on its own — often quoting the rule comments verbatim. It even
derives the blind spots: five v1.0.0 runs explained that `depcruise` builds its
graph from imports and a global `fetch` has no import edge. **The skill competes
with the config, and the config is always fresher.**

Case 7 separates them because its rules cannot be recovered from any file, and
the surrounding schema argues the other way. That is the shape a discriminating
case has to have. When adding one, ask: *could a careful agent reach this by
reading the repo?* If yes, the case measures the repo, not the skill.

**The delta is not only about missing things.** On case 7 the older version was
not silent: it reframed the widened `reviews` table as a cross-module write —
true, but a different fix that leaves the columns in place — and on foreign keys
three of five runs actively recommended new `ON DELETE CASCADE`, because every
FK around them cascades. Grade the *fix*, not the mention; a plausible wrong
answer is the failure mode worth catching.

**Run counts matter.** The 5-run comparisons showed no assertion splitting
within a configuration — detection here is stable, not a coin flip — which is
what makes a 5/5-vs-0/5 split trustworthy. A single run per side would have
produced the same headline with none of the confidence.
