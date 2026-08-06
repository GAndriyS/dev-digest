---
name: frontend-ui-architecture
description: "Frontend UI architecture and code organization for React and Next.js — decides WHERE code lives, not how fast it runs. Use whenever placement is the question: which folder a new component belongs in, how to split a component that got too big, where constants / helpers / utils / types / hooks go, where business logic belongs versus the component body, when to promote route-local code to shared, whether to add a barrel file, which side of the server/client boundary a piece belongs on, and how to remove duplication without inventing the wrong abstraction. Trigger on phrasings like \"where should this live\", \"how do I structure this\", \"is this the right folder\", \"this component is huge\", \"we have this code in two places\", \"extract this\", \"refactor the folder structure\", or any review comment about file layout, module boundaries, or things being in the wrong place — even when the user never says the word architecture. Not for render performance, memoization, bundle splitting, hydration errors or whether a hook is used correctly (react-best-practices, next-best-practices), and not for server-side layering such as routes/service/repository, DI containers or ports and adapters (onion-architecture)."
metadata:
  version: 1.1.0
  tags: architecture, frontend, react, nextjs, code-organization, colocation, boundaries, refactoring
---

# Frontend UI Architecture

Placement decisions: which file, which folder, which layer. Performance, hooks
correctness, and React anti-patterns belong to `react-best-practices`; App Router
file conventions belong to `next-best-practices`. This skill answers *where*.

Good/bad pairs for every rule below: [examples.md](examples.md). Sources:
[references.md](references.md). Version history and bump policy:
[CHANGELOG.md](CHANGELOG.md).

## The one question this skill answers

> A new piece of code exists. Where does it go?

Answer it with the **proximity rule**: put code as close to its only consumer as
possible, and move it up only when a second consumer actually appears. Distance
from the consumer is a cost — every level up makes the code harder to find,
harder to change safely, and easier to duplicate by accident because nobody knew
it was there.

This is the whole skill. Everything below applies it to a specific kind of code.

## The placement ladder

Code lives at exactly one of four levels. Start at the bottom and climb only when
forced:

| Level | Where | When |
|-------|-------|------|
| 1. Inside the component file | same file, above the component | one consumer, small, meaningless elsewhere |
| 2. Component folder | `ComponentName/helpers.ts`, `constants.ts` | one component, but the file is getting crowded |
| 3. Feature / route folder | `<route>/helpers.ts`, `<route>/_components/` | 2+ components inside one route or feature |
| 4. Shared | `src/components/`, `src/lib/` | 2+ **features** need it, and it has no feature-specific knowledge |

Climb one rung at a time, and only in response to a real second consumer — never
because you predict one. Skipping to level 4 "since it might be reused" is the
most common way a codebase acquires a shared module that one page uses and
nobody dares touch.

**Climbing is cheap; descending is not.** Moving a helper up when the second
consumer appears is a small mechanical change. Untangling a shared module that
three features grew into different directions is not. This asymmetry is why
delayed promotion beats early promotion.

## Components

### Where a component goes

- **Used by exactly one route** → colocate under that route
  (`<route>/_components/<Name>/`). This is the default and it should stay the
  majority of components in the app.
- **Used by two or more routes** → `src/components/<name>/`.
- **Generic, no domain knowledge at all** (Button, Modal, Tooltip) → the UI kit,
  not the app. If your app defines what a `Button` looks like, you have a design
  system, not a feature — treat it as a separate layer.

The test for "is this shared": strip the component of every reference to a domain
type, a route param, an API hook. If nothing meaningful remains, it isn't shared —
it's a feature component that happens to look generic.

### When to split a component

Split on *reasons to change*, not on line count. Line count is a symptom, and a
useful alarm, but splitting a 300-line component into three 100-line components
that always change together makes the code worse — now one change touches three
files.

Real split signals:

- **Two responsibilities in one file** — a component that both fetches/derives
  data and paints a complex tree. Split into a container (data, state,
  callbacks) and a presentational child (props in, JSX out).
- **A subtree with its own state** that the parent never reads. That state wants
  to move down with its markup, so the parent stops re-rendering for it.
- **A part that is conditionally rendered and self-contained** (a drawer, a
  modal body, a popover) — it has a natural seam and often its own lifecycle.
- **A repeated element inside a `.map()`** with more than trivial markup — it
  becomes a `Row`/`Card`/`Item` component, which also gives it a place to own
  its own constants and helpers.

When a component gets big enough to need its *own* private parts, give it a
folder and nest: `BigThing/_components/Part/`. Recursive nesting is correct —
depth mirrors ownership, and a reader who opens `BigThing/` immediately sees
everything only `BigThing` can use.

### Component folder anatomy

A component folder holds the component and only the things that exist because of
it:

```
ComponentName/
├── ComponentName.tsx        # the component
├── ComponentName.test.tsx   # colocated test
├── constants.ts             # only if there are constants
├── helpers.ts               # only if there are pure helpers
├── styles.ts                # only if styles are extracted
├── useSomething.ts          # component-local hook
└── index.ts                 # curated public surface
```

Create the auxiliary files **when there is content for them**, not upfront. An
empty `constants.ts` is a lie about where things live — it tells the next reader
that constants were considered and placed, when in fact nothing was.

Tests colocate next to the component. A `__tests__/` directory moves the test
away from the thing it describes and makes it easy to delete a component and
leave its test behind.

## Constants

Constants follow the same ladder, and the level is decided by *who knows the
meaning of the value*:

- **Used in one component** → `constants.ts` in that component's folder, or a
  module-level `const` above the component if there's just one.
- **Used across a route's components** (a column list, a filter set, a tab
  order) → `<route>/constants.ts`.
- **Domain values that come from the backend contract** (statuses, severities,
  enum members) → do not redeclare them. Import from the shared contract package
  so a backend change breaks the build instead of silently disagreeing.

Never create a global `constants.ts` that collects unrelated values. It is a
file with no owner: everyone appends, nobody prunes, and a change to one line
forces every consumer to recompile and re-review.

Extract a literal into a named constant when the name adds information the value
doesn't carry — `MAX_VISIBLE_FINDINGS = 5` earns its name, `ZERO = 0` does not.
Also extract static arrays and objects used in JSX to module level so they keep
a stable identity across renders.

## Helpers, utils, and where logic lives

Split by *dependency on your domain*, because that dictates who may safely use
them:

- **helpers** — pure functions that know your domain (`formatFindingLabel`,
  `groupRunsByDay`). They live with the feature that owns the concept.
- **utils** — pure functions that know nothing about your domain (`clamp`,
  `truncate`, `pluralize`). They live in the shared lib.

If a "util" imports a domain type, it's a helper and it belongs closer to the
feature. This test is mechanical and worth applying literally — a domain import
in the shared lib is the first symptom of a shared layer that will eventually
depend on everything.

Keep both **pure**: arguments in, value out, no fetching, no storage access, no
component state. A "helper" that performs I/O is a service, and it belongs with
the data layer where it can be mocked in one place.

Name helper files for what they do when a folder holds several components —
`popoverHelpers.ts` beats a second generic `helpers.ts` that mixes concerns.

### Business logic

Three destinations, decided by what the logic needs:

| Logic | Needs | Goes to |
|-------|-------|---------|
| Calculations, formatting, validation, mapping | nothing but its arguments | pure functions in `helpers.ts` |
| Stateful behaviour, effects, subscriptions, data access | React runtime | a custom hook |
| Painting the result | props | the component |

The component body is for wiring, not for deciding. When you find branching,
sorting, aggregation, or date math inside JSX or directly in a component body,
it is a pure function that hasn't been named yet — extract it, and it becomes
testable without rendering anything.

Custom hooks are the seam between the two: they hold state and effects, and
delegate the actual computation to pure helpers. This keeps hooks thin and keeps
the interesting logic testable without a renderer. A hook that is one giant
`useEffect` with the business rules inlined is doing both jobs.

Data access goes through the project's data layer (a query hook over a single
API client), never a raw `fetch` in a component. One place that knows the base
URL, the headers, and the error shape is also the one place tests need to mock.

## Duplication and abstraction

Duplication is not automatically a bug. **The wrong abstraction costs more than
the duplication it removed**, because every future requirement that fits only one
of the callers arrives as a new parameter, and the shared function slowly becomes
a switch statement wearing a function signature.

Working rules:

- **Two occurrences: wait.** Two similar blocks are evidence of nothing yet.
- **Three occurrences: look.** By the third, you can see which parts are truly
  the same and which merely rhyme. Abstract the sameness, leave the rest.
- **Abstract on shared *reason to change*, not shared shape.** Two functions with
  identical bodies that change for different reasons must stay separate — they
  will diverge, and the merged version will fight both.
- **Reversing is legitimate.** When an abstraction has accumulated flags and
  branches for its callers, inline it back into each caller and let the real
  pattern re-emerge. Re-introduced duplication is a step forward, not a
  regression.

A parameter added purely to make an existing abstraction fit a new caller is the
warning sign to act on — especially a boolean, which almost always means "do the
other thing entirely".

## Barrel files (`index.ts`)

A barrel is a **public API declaration**, not a convenience. Used that way it is
valuable: it states which exports are supported and lets everything else move
freely.

- Give a barrel to a shared module, and export only its public surface — the
  component and its public types. Internal subcomponents, helpers and hooks stay
  unexported so refactoring them breaks nothing.
- One component per folder needs at most a one-line barrel.
- Do not build app-wide or route-wide barrels that re-export everything.
  Wildcard re-exports defeat tree-shaking, slow builds by widening the module
  graph, and are the usual source of import cycles — a module importing its own
  directory's barrel pulls in siblings that import it back.
- Inside a module, import siblings by direct path, never through the module's own
  barrel. That single rule prevents most cycles.

## Next.js App Router

The App Router's own file conventions (`page`, `layout`, `route`, `loading`,
`error`) are documented in `next-best-practices`. What matters architecturally:

- **Colocation is safe.** Only files matching route conventions become routes, so
  a component, test, or helper sitting next to `page.tsx` is not published as a
  URL. Use that — the router directory is the natural home for route-local code.
- **Private folders (`_folder`)** are opted out of routing entirely. They are the
  explicit way to say "internal to this route": `_components/`, `_hooks/`.
- **Route groups (`(folder)`)** organize routes and share a layout without adding
  a URL segment. Use them for sections with a common shell, not for arbitrary
  grouping.
- **Keep `page.tsx` thin.** A page composes: it resolves params, kicks off data,
  and renders feature components. Logic in a page is unreachable from any other
  route and untestable without the router.

### Server/client boundary

The boundary is an architectural decision about *bundle membership*, not a
performance tweak:

- Server components are the default; add the client directive only where
  interactivity, browser APIs, or React state actually live.
- **Push the boundary down.** Marking a layout or a page as client makes
  everything it imports client too. Keep composition and data on the server and
  make interactive parts small islands.
- A client component cannot import a server component. Pass server-rendered
  content through `children` instead — that inversion is what lets a client
  wrapper (a tab strip, a collapsible) hold server content.
- Props crossing the boundary must be serializable. If you're tempted to pass a
  function, the logic is on the wrong side.

## In this repo (`client/`)

The generic rules above are already instantiated here. Follow the existing shape
rather than importing a different convention:

- **Route-private components**: `client/src/app/**/_components/<PascalName>/`.
  **Cross-route components**: `client/src/components/<kebab-name>/`. The casing
  difference is the signal for which one you're looking at.
- Component folders are `Name.tsx` + `index.ts`, plus `constants.ts`,
  `helpers.ts`, `styles.ts` **only when non-empty**. Tests colocate as
  `Name.test.tsx` — there is no `__tests__/` anywhere in this codebase.
- `index.ts` exports the minimal public surface (see
  `client/src/components/severity-counters/index.ts` — one line, the component
  and its view type; the popover, hook and helpers stay private).
- **Styles are colocated TypeScript objects**, not Tailwind classes and not CSS
  modules: `export const s = { ... }` of `CSSProperties`, `satisfies` for static
  objects, functions for state-dependent styles (`chip(interactive, dimmed,
  selected)`). Design tokens arrive as CSS vars (`var(--accent)`). This overrides
  the generic Tailwind guidance in `react-best-practices`.
- Deep nesting is normal here: see
  `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/`,
  which owns a second-level `_components/` plus an `atoms.tsx` for micro-pieces.
- Component-local hooks sit beside the component (`useHoverIntent.ts`); several
  of them get a `hooks/` subfolder with its own barrel (see `app-shell/`).
- **Contracts** come from `@devdigest/shared` — never hand-declare a type or enum
  that exists there. `client/src/vendor/shared` is a trimmed copy of the server's
  canonical set and does not update itself; a wire-crossing change must be
  mirrored.
- **UI primitives** come from `@devdigest/ui`. `client/src/vendor/ui` is
  vendored — fix upstream and re-vendor, never patch in place.
- **All API access** goes through `client/src/lib/api.ts`; data hooks live in
  `client/src/lib/hooks/*`. A component calling `fetch` directly bypasses the
  global fetch mock and its test will lie.
- **UI strings** live in `client/messages/<locale>/*.json` (next-intl). A string
  literal in JSX is a missing translation key.

### What CI rejects

Part of the above is machine-checked, so getting it wrong fails the build rather
than a review. Run it before pushing:

```bash
cd client && pnpm arch
```

`client/.dependency-cruiser.cjs` owns the graph rules — no import cycles, no
reaching sideways between `src/app/<route>/` trees, no import of `src/app/` from
`src/components/` or `src/lib/`, no reaching past a component folder's
`index.ts` (from a sibling component *or* from a route), and `vendor/shared` +
`vendor/ui` stay leaves.
`client/scripts/check-ui-conventions.mjs` owns the two syntax rules a graph tool
cannot see: no `export *` in a barrel, and no `fetch()` outside `src/lib/api.ts`.

Both run in the `Architecture boundaries` step of `.github/workflows/client.yml`.
Everything else in this skill is a judgment call and is enforced by review.

## Reviewing an existing structure

When asked to assess or clean up a structure, look for these in order — they are
ordered by how much damage they do:

1. **Shared modules with one consumer** — promoted too early. Push them back down
   to the consumer.
2. **Domain imports in the shared/util layer** — a shared layer that knows about
   features will eventually depend on all of them.
3. **Junk-drawer files** — `utils.ts`, `constants.ts`, `types.ts` at app scope
   holding unrelated entries. Split by owner and redistribute.
4. **Logic in component bodies and JSX** — extract to pure helpers; the component
   should read like a description of the markup.
5. **Fat pages** — `page.tsx` doing work that belongs in a feature component.
6. **Wildcard barrels and cycles** — replace with curated barrels and direct
   sibling imports.
7. **Abstractions carrying boolean flags** for their callers — candidates for
   inlining back.

Report findings with the destination, not just the diagnosis: "`formatRunLabel`
is used only by `RunHistory` — move it to `RunHistory/helpers.ts`" is actionable;
"poor separation of concerns" is not.
