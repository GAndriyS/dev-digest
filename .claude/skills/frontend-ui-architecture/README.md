# frontend-ui-architecture — maintainer notes

For humans maintaining this skill. The agent reads `SKILL.md`; you read this.

## What it is

The skill answers **placement** questions in React/Next.js code — which file,
which folder, which layer. Everything in it reduces to one rule: put code as
close to its only consumer as possible, and move it up only when a second
consumer actually appears.

It deliberately does **not** cover render performance, memoization, bundle size,
or hooks correctness. Those live in `react-best-practices`; App Router file
conventions live in `next-best-practices`.

## Files

| File | Audience | Contents |
|---|---|---|
| `SKILL.md` | agent | Placement ladder, components, constants, helpers/utils, business logic, duplication, barrels, App Router + server/client boundary, repo section, review checklist |
| `examples.md` | agent | Fourteen good/bad pairs, most taken from real code in `client/` |
| `references.md` | agent + human | The articles behind each rule, with what each contributes |
| `README.md` | human | This file |
| `CHANGELOG.md` | human | Version history and the semver policy |

## Scope boundary with `react-best-practices`

These two skills overlap by construction, so the split is explicit:

- **This skill** — where code goes.
- **`react-best-practices`** — whether the code itself is correct (derived state,
  effect misuse, keys, memoization).

Two conflicts were resolved when this skill was added, and both edits live in
`react-best-practices/SKILL.md`:

1. Its `Code Organization` section pointed at `utils/` and `components/ui/`,
   neither of which exists here. It now defers to this skill.
2. Its Tailwind rule ("use utility classes — no inline `style={}` objects")
   contradicts `client/`, which styles exclusively with colocated `styles.ts`
   `CSSProperties` objects. That rule is now scoped to Tailwind projects.

A third edit was needed at the trigger surface: `react-best-practices` claimed
"code organization" **in its description**, which is the only text the router
matches on. Fixing the body alone would have left the collision in place. Its
description now covers correctness and defers placement here; this skill's
description names the excluded neighbours explicitly (performance and hydration →
`react-best-practices` / `next-best-practices`; routes/service/repository, DI,
ports and adapters → `onion-architecture`).

If you change either skill, re-check this boundary — and re-check the
descriptions, not just the bodies. A generic skill that contradicts
`client/AGENTS.md` will be followed silently; that is what happened here, and it
is recorded in the root `INSIGHTS.md`.

`evals/trigger-queries.json` holds 16 queries (8 should-trigger, 8 near-misses)
for checking the boundary after a description change. The hardest negative is
*"should this drizzle query live in the service or the repository"* — the exact
"where should this live" phrasing this skill claims, on the backend, where
`onion-architecture` must win. **These have not been run against a live router**:
that needs either the `claude` CLI (absent on this machine) or subagents. Treat
the file as a prepared test, not a passing one.

## Keeping the repo section honest

The `In this repo (client/)` section of `SKILL.md` is the part most likely to
rot, because it describes conventions rather than principles. It was derived from
`client/AGENTS.md` plus the actual tree under `client/src/app/repos/[repoId]/pulls/**`
and `client/src/components/severity-counters/**`.

When those conventions change, update the section in the same PR. A stale repo
section is worse than no repo section, because it will be followed.

## Changing the skill

Keep the artefacts in sync in **one** PR:

1. `SKILL.md` — the guidance (and `examples.md` if the pattern is new)
2. `references.md` — if the change is backed by a new source
3. `CHANGELOG.md` + `metadata.version` in the `SKILL.md` frontmatter
4. The `vX.Y.Z` badge in the catalog row of `.claude/skills/README.md`

Version bumps (semver):

- **major** — guidance reversed or removed, or the skill restructured such that
  an agent that memorised the old version would now be wrong
- **minor** — new rules, sections, examples, or references; existing guidance
  still holds
- **patch** — wording, typos, link fixes, or syncing the repo section with a
  convention change the skill already described in principle

## Deliberate omissions

- **Feature-Sliced Design's seven-layer taxonomy.** It informed the "shared must
  not know about features" rule, but the full `app/processes/pages/widgets/
  features/entities/shared` split is heavier than this codebase needs and would
  describe a structure `client/` does not have.
- **A prescribed top-level folder layout.** The skill gives a ladder and the
  criteria for climbing it, not a tree to copy. Copying a tree is how projects
  end up with empty folders and a shared layer nobody uses.
- **Enforcing the judgment calls.** "Split on reasons to change" and "abstract on
  the third occurrence" are deliberately not machine-checked — no tool can see a
  reason to change. The mechanical subset *is* enforced (below); the rest is what
  review is for.

## Enforcement

Two tools, because the rules split cleanly in two:

| Rule | Enforced by |
|---|---|
| No import cycles | `client/.dependency-cruiser.cjs` → `no-circular` |
| Route trees stay private to each other | `no-cross-route-internals` |
| `components/` + `lib/` never import `app/` | `shared-does-not-know-features` |
| Component folders talk through their barrel — between components | `no-sibling-component-internals` |
| …and from a route into a component | `no-component-internals-from-app` |
| `vendor/shared`, `vendor/ui` are leaves | `contracts-are-a-leaf`, `ui-kit-is-a-leaf` |
| No dead modules | `no-orphans` (warn) |
| No `export *` in a barrel | `client/scripts/check-ui-conventions.mjs` |
| No `fetch()` outside `lib/api.ts` | same script |

The split is not arbitrary: dependency-cruiser reasons about the module graph, so
it sees only edges between files. `export *` and a bare `fetch()` are things a
file *says*, not things it links to — hence the second, much smaller tool.

```bash
cd client && pnpm arch
```

Both run in the `Architecture boundaries` step of `.github/workflows/client.yml`.

After changing a rule, verify it still bites: plant a deliberate violation,
confirm the rule name appears in the output, remove it. A clean run proves
nothing on its own — that lesson is recorded in the root `INSIGHTS.md` and it is
how the `no-sibling-component-internals` rule was found to be silently untested
(the probe imported a file that did not exist, so no edge existed to forbid).

`WILDCARD_BARREL_DEBT` in the script is a shrinking ratchet, same convention as
the server's `GRANDFATHERED` lists: four barrels already used `export *` when the
check landed. The script fails if an entry stops being a violation, so the list
cannot silently re-permit something.
