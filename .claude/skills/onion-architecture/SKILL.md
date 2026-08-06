---
name: onion-architecture
description: "Enforces Onion Architecture in the DevDigest backend packages (server/, reviewer-core/). Use when adding or changing a server module (routes/service/repository), introducing an adapter or port, wiring anything into the DI container, touching reviewer-core, deciding where a piece of logic belongs, or when a dependency-cruiser boundary rule fails in CI. Covers the dependency rule, ports and adapters, the composition root, Zod validation at the edge, testing seams, and the machine-enforced import boundaries. Trigger terms: onion architecture, clean architecture, hexagonal, ports and adapters, layer, boundary, dependency rule, service layer, repository layer, DI container, composition root, depcruise, dependency-cruiser, architecture violation."
metadata:
  version: 1.0.0
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

## More

- `examples.md` — good/bad pairs drawn from this codebase
- `references.md` — the articles behind these rules
- `README.md` — how to maintain this skill and its version
