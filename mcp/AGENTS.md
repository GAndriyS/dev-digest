# mcp — `@devdigest/mcp`

A local stdio MCP server bridging a coding agent to the DevDigest API:
discover review agents, run one on a PR and wait for its findings, read
stored findings/conventions. npm.

## Before answering

Read `mcp/INSIGHTS.md` before starting work.

## Conventions (not obvious from code)

- **The iron rule: HTTP only.** No database, no Fastify, no Drizzle, and no
  import from `server/src` — this package talks to the API the same way any
  external client would, over `fetch`. The only exception is `import type`
  from `@devdigest/shared` (contracts only, erased at compile time — see
  below); importing a *value* from it, or reaching into `server/src/modules/**`
  or `server/src/adapters/**`, is a bug.
- npm, **not** pnpm — this package has its own `package-lock.json`, same as
  `reviewer-core/` and `e2e/`. `npm run typecheck` doubles as the build; the
  package never emits JS (mirrors `reviewer-core`'s pattern).
- **stdout is JSON-RPC only.** Never `console.log` anywhere in this package —
  it would corrupt the transport mid-message. Diagnostics go through
  `config.log(...)`, which writes to **stderr**, and only when
  `DEVDIGEST_MCP_LOG=1`.
- **`127.0.0.1`, never `localhost`**, for `DEVDIGEST_API_URL`'s default. On
  Windows `localhost` can resolve to `::1`, where an unrelated project's API
  may already be listening — a `localhost` default would silently talk to the
  wrong server (root `INSIGHTS.md`).
- **Tool descriptions are budgeted, not narrated.** Each is 2–4 sentences
  (what / when / when NOT), and the five together sit at ~400 tokens (1579
  chars of `description` across `tools/list` — measure it there, not by
  eyeballing the source), which is the ceiling — this is a real constraint, not a style preference: every token
  spent here is context an agent never gets to spend on the actual review.
  Don't lengthen a description to "clarify" something; add a `.describe()` on
  the specific field instead.
- **Responses are shaped, never dumped.** `lib/shape.ts` drops persisted-row
  fields (`id`, `review_id`, `accepted_at`, `dismissed_at`, `kind`,
  `trifecta`), truncates `rationale`/`suggestion` to 500 chars, and caps a
  page at `CHARACTER_LIMIT` (25 000 chars). A tool that returns a raw API
  response body is a bug, not a shortcut.
- **Every error names the next call.** `lib/errors.ts` is the one place error
  text is written; a bare "not found" is a dead end for a caller that is a
  coding agent choosing its next tool call, not a human reading a stack trace.
  On error, return `{content:[...], isError:true}` and **omit**
  `structuredContent` — an error object would fail the tool's own
  `outputSchema` validation at the transport layer.
- **`*.test.ts` only, never `*.it.test.ts`.** That glob is the server's
  Docker-backed integration lane; this package has no database to integrate
  with, so nothing here should ever match it.
- **Onion seams inside the package**: `src/index.ts` is the composition root
  — it builds the api-client once and hands it (with `config`) to every tool
  factory. `src/lib/api-client.ts` is the *only* module that calls `fetch`;
  `src/lib/{resolve,poll,shape}.ts` take resolved values, never a transport
  object. Tests substitute the **api-client object** at the factory seam
  (never `vi.mock` of a module path — mirrors the server's
  `ContainerOverrides`-not-module-mocks rule); only `api-client`'s own tests
  stub global `fetch`.
- `mcp/vitest.config.ts` deliberately carries **no** alias for
  `@devdigest/shared` (unlike `reviewer-core/vitest.config.ts`, which does) —
  a stray value import from that path fails fast in tests instead of quietly
  resolving through the alias like it would elsewhere in the repo.
- `get_blast_radius` reports a thin index through `status` (`full` / `partial`
  / `degraded`) **plus a `message`**, as a success — never as `isError` and
  never as an empty map. "Nothing calls this" and "the index could not tell"
  are different answers, and a caller that cannot tell them apart will trust a
  map that was never built. `isError` there means the repo/PR did not resolve
  or the API was unreachable, nothing else.

## Use when

- Tools table, prerequisites, env vars, Inspector command, troubleshooting →
  read `mcp/README.md`
- Findings → read `mcp/INSIGHTS.md`
