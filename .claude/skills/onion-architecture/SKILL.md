---
name: onion-architecture
description: "Enforces Onion Architecture in the DevDigest backend packages (server/, reviewer-core/). Use when adding or changing a server module (routes/service/repository), introducing an adapter or port, wiring anything into the DI container, touching reviewer-core, deciding where a piece of logic belongs, or when a dependency-cruiser boundary rule fails in CI. Covers the dependency rule, ports and adapters, the composition root, Zod validation at the edge, testing seams, and the machine-enforced import boundaries. Trigger terms: onion architecture, clean architecture, hexagonal, ports and adapters, layer, boundary, dependency rule, service layer, repository layer, DI container, composition root, depcruise, dependency-cruiser, architecture violation."
metadata:
  version: 2.0.0
  tags: architecture, onion, backend, fastify, drizzle, zod, dependency-injection, boundaries
---

# Onion Architecture — DevDigest backend

The backend is already onion-shaped. This skill states the shape so it stays
that way, and points at the dependency-cruiser rules that enforce it.

## When to use

- Adding or changing a module under `server/src/modules/`
- Adding an adapter, a port interface, or a container entry
- Deciding where a piece of logic belongs (route? service? repository? core?)
- Any change inside `reviewer-core/src`
- A `routes-through-service` / `no-direct-adapter-clients` / `core-has-no-io`
  (or other boundary) failure in CI

## The dependency rule

**Dependencies point inward. Nothing in an inner ring may name an outer ring.**

| Ring | Lives in | Knows about |
|---|---|---|
| Domain core | `reviewer-core/src` | Contracts only (`@devdigest/shared`) |
| Ports (abstractions) | `server/src/vendor/shared/adapters.ts` | Nothing |
| Application services | `server/src/modules/<name>/service.ts` | Ports, repositories, own helpers/constants |
| Data access | `server/src/modules/<name>/repository.ts`, `server/src/db/` | Drizzle + schema |
| Infrastructure | `server/src/adapters/**` | The port it implements, the outside world |
| Edge (HTTP) | `server/src/modules/<name>/routes.ts` | Fastify, Zod, its own service |
| Composition root | `server/src/platform/container.ts`, `app.ts` | **Everything** — by design |

The composition root is the one place allowed to violate the ring order: its
whole job is to know every concrete class so nothing else has to.

## Ports and adapters

A **port** is an interface in `server/src/vendor/shared/adapters.ts`
(`LLMProvider`, `GitClient`, `GitHubClient`, `CodeIndex`, `Embedder`,
`SecretsProvider`, `AuthProvider`). An **adapter** is a class under
`server/src/adapters/` that implements one.

Rules:

- Depend on the interface, resolve the instance **through the container**:
  `await container.github()`, `container.git`, `await container.llm('openai')`.
  Never `new OctokitGitHubClient(...)` outside `container.ts`.
- This is not style — it is the only reason `src/adapters/mocks.ts` substitution
  works. A service that constructs its own adapter cannot be unit-tested.
- New port → interface in `vendor/shared` (**server copy is canonical**), adapter
  in `adapters/`, lazy getter + `ContainerOverrides` entry in `container.ts`,
  mock in `adapters/mocks.ts`. All four, or the seam is broken.
- Contract changes must be mirrored into `client/src/vendor/shared`.
- `import type` of a port interface is always fine — naming the abstraction is
  the point. Importing the concrete class is what is forbidden.
- Two adapter files export **pure functions**, not clients: `git/diff-parser`
  and `codeindex/extract`, plus `astgrep/`. Nothing is injected and nothing is
  mocked, so modules may import them directly. Everything else goes through the
  container.

## The composition root

`container.ts` holds config, db, jobs, the SSE bus, and lazily-constructed
adapters. Follow its existing shape:

- Lazy getter with `??=` caching; `overrides.<x>` checked **first** so tests win.
- Anything needing a secret is `async` (`github()`, `llm()`, `embedder()`) —
  the key is read through `SecretsProvider` at resolve time, not at boot.
- Cross-module repositories live on the container (`container.agentsRepo`,
  `container.reviewRepo`). Reaching into another module's folder for its
  repository is a boundary violation; put it on the container instead.
- A service takes the `Container` and pulls what it needs
  (`constructor(private container: Container)`), then builds its own repository
  from `container.db`. See `modules/repos/service.ts`.
- Plugins register **before** modules, so module plugins inherit them.

## Validation at the edge

Parse at the boundary; inside the rings the data is already trusted.

- Declare Zod `params` / `body` on the route — invalid input 422s before the
  handler runs. Never hand-roll `Schema.parse(req.body)` in a handler.
- One Zod schema drives request validation **and** response serialization.
- Throw `AppError` (or a subclass: `NotFoundError`, `ConfigError`) for anything
  with a status. Services throw domain errors; routes do not map them by hand.
- Services and repositories take **resolved values** as arguments
  (`workspaceId`, `userId`, `url`), never a `FastifyRequest`. If a service needs
  the request, the boundary is in the wrong place.

## reviewer-core: the iron rule

`reviewer-core` is the domain core. **No DB, no GitHub, no filesystem, no HTTP
server.** The only side effect is an injected `LLMProvider`.

- Need I/O? It belongs in the caller. New inputs arrive as resolved strings —
  skill *bodies*, not slugs; spec *chunks*, not paths.
- It may import `@devdigest/shared` (aliased to `server/src/vendor/shared`) and
  `openai` / `zod`. Nothing else from `server/`.
- It is consumed as TypeScript **source** and never emits JS; `npm run typecheck`
  is its build. It uses **npm**, not pnpm.

## Testing seams

- Substitute adapters via `new Container(config, db, { github: mockGitHub })` —
  not `vi.mock` of a module path. Module-mocking couples the test to the import
  graph; `ContainerOverrides` couples it to the port.
- DB-backed tests must be named `*.it.test.ts`; the unit and integration CI lanes
  split on exactly that glob.
- A pure function (helpers, grounding, reduce) needs no container at all — if a
  test is reaching for one, the logic may belong in `helpers.ts`.

## New module checklist

1. `server/src/modules/<name>/routes.ts` — Fastify plugin, Zod schemas, delegates.
2. `service.ts` — business logic, takes `Container`.
3. `repository.ts` — the only place that touches its tables; every query scoped
   by `workspaceId`.
4. `helpers.ts` (pure transforms) and `constants.ts` (literals) as needed.
   `constants.ts` / `types.ts` are the module's **public surface** — the only
   files another module may import.
5. One entry in `src/modules/index.ts`. Registration is static on purpose:
   dynamic `import()` of `.ts` is not portable across tsx, the bundler and vitest.

## Enforcement

Boundaries are checked by dependency-cruiser, not by good intentions:

```bash
cd server && pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs
```

Both trees are cruised from `server/` because reviewer-core is consumed as source
through a tsconfig path alias and has no tooling of its own. This runs in the
`typecheck` job of `.github/workflows/server-unit.yml`.

**When it fails, fix the import direction — not the rule.** Each rule carries a
`comment` explaining the intended direction; read it before touching the config.
`pathNot` entries marked `GRANDFATHERED` are debt: shrink them, never append.

Known grandfathered debt:

- `modules/{polling,pulls,settings,workspace}` have no service layer — their
  routes query Drizzle directly. New modules must not.
- `adapters/{astgrep,depgraph}` import constants out of `modules/repo-intel`;
  those constants belong in `platform/` or `vendor/shared`.

## Blind spots — where the config is silent

dependency-cruiser reads **imports**. Three real violations produce no import at
all, so a green `depcruise` says nothing about them. These are found by reading,
or not at all.

**1. Outbound network in `reviewer-core`.** `core-has-no-io` lists modules
(`node:http`, `node:fs`, `octokit`, …). Global `fetch` is not imported, so
`fetch('https://api.github.com/…')` sitting in the core passes every check in
CI. The iron rule is about the side effect, not the import: the core's only side
effect is the injected `LLMProvider`, and everything else arrives already
resolved from the caller.

**2. `import type { FastifyRequest }` in a service is still an error.**
`no-direct-adapter-clients` carries `dependencyTypesNot: ['type-only']` on
purpose — naming a port's interface is exactly what you want. Do not generalise
that to the HTTP rules: `service-stays-http-agnostic` has no such escape, and it
should not. A type-only import still means the signature speaks HTTP, which is
the coupling the rule exists to prevent. Take `workspaceId`, `userId`, the
parsed body — never the request, not even as a type.

**3. A cache built from a secret has two homes.** `container.ts` caches
adapters lazily (`this._github`, `llmCache`, `_embedder`). Keys rotate at
runtime: `POST /settings/test-connection` persists the key the UI supplied and
then calls `container.invalidateSecretCaches()`
(`modules/settings/routes.ts:83-84` — that route is the only caller, which is
itself worth knowing), and the method clears its list **by hand**: a hardcoded
set of fields, not a sweep.
Add a cached getter built from a `SecretsProvider` value and forget to clear it
there, and the failure is a support ticket, not a stack trace: the user pastes a
working key, the UI confirms it saved, and every call keeps using the revoked
one until someone restarts the process. Nothing in CI can see this — it is an
omission from a list, not an import. The seam has the same shape: a getter that
skips its `overrides.<x>` check compiles, passes depcruise, and quietly makes
the port unmockable.

**4. Another module's tables are not yours.** Importing
`../reviews/repository.js` fails `no-cross-module-internals` loudly. Writing the
same query inline against `t.reviews` through `container.db` imports only
`db/schema` — legal everywhere, and every bit as coupled: the other module's
table shape is now yours to break. The only difference is that the build stays
green. When you need another module's data, take its repository off the
container (`container.reviewRepo`); when it does not exist there yet, that is
the change to make.

## Team decisions the code cannot tell you

The rules above are visible in the repo if you look hard enough. These two are
not: they were decided in review, they contradict what the surrounding schema
shows, and copying the existing pattern is exactly how they get broken. Nothing
enforces them — no lint rule can, because both are about what a migration is
allowed to do, and every migration is legal SQL.

**`reviews` is closed for new columns** (decided 12/06/2026, after INC-42).
Adding `model` to `reviews` rewrote the table on the demo instance and held an
`ACCESS EXCLUSIVE` lock for just under four minutes; the review running at the
time died mid-flight and came back as a half-written row nobody could explain.
`reviews` is the hottest table we have and the one every screen reads.

So: per-review data that is not the verdict itself — annotations, delivery
state, cost breakdowns, anything a feature invents — goes in **its own table
keyed by `review_id`**, joined on read. `findings` and `trace` are wide and
grandfathered; they are the reason the table is heavy, not a licence to add a
third. If a feature "just needs one column on reviews", that is the moment to
push back, not the exception that proves the rule.

**New foreign keys are `ON DELETE RESTRICT`, and deletes go through the owning
service** (decided 03/05/2026). A workspace cleanup once removed a repo and took
40k findings and their audit rows with it, silently, because every FK in the
schema cascaded. Nobody noticed for two weeks — there was no error to notice.

Existing cascades stay (rewriting them is its own migration, on its own day);
new ones do not get added. The service deletes children explicitly, in the order
it chooses, and can log or refuse. **The schema will argue against you here** —
almost every FK you will read says `onDelete: 'cascade'`, and matching the
surrounding style is the wrong instinct on this one. When a delete genuinely
should cascade, say so in the PR and get it agreed; the default is `restrict`.

## More

- `examples.md` — good/bad pairs drawn from this codebase
- `references.md` — the articles behind these rules
- `README.md` — how to maintain this skill and its version
