# L04 — devdigest-mcp (MCP server only)

## Goal

Today the only way to drive a DevDigest review is through the web studio: a
human opens a PR, clicks Review, and reads findings in the browser. L04 adds a
**local stdio MCP server** (`mcp/`, package `@devdigest/mcp`) so a coding agent
— Claude Code chief among them — can do the same thing from the terminal it is
already working in: list the configured review agents, run one (or all) on a
pull request, and read back findings and conventions as structured tool
results, without touching the DB or the server's DI container directly. The
server talks to the existing Fastify API over plain HTTP; it adds no new
product surface, only a new client of the one that exists. Blast Radius — the
other half of L04 on the course slides — is explicitly not part of this spec;
see Out of scope.

## Acceptance criteria

- [ ] Exactly five tools are registered, under the exact names the course
      slides use: `list_agents`, `run_agent_on_pr`, `get_findings`,
      `get_conventions`, `get_blast_radius`. Claude Code namespaces them
      `mcp__devdigest__<tool>`; renaming any of them breaks that contract.
- [ ] `run_agent_on_pr` is result-not-operation: one call starts the review,
      polls the run(s) to a terminal state, and returns the finished verdict
      and findings — never a bare run id the caller has to poll itself.
- [ ] Every tool's input schema is flat — no nested objects, no arrays of
      objects — and is a `.strict()` Zod object, so an unexpected argument is
      rejected at the edge rather than silently ignored.
- [ ] Every tool response is shaped and capped: known fields only (no raw API
      dumps), a `CHARACTER_LIMIT` of 25000 enforced on the serialized payload,
      and pagination (`limit`/`offset`, `total`/`returned`/`next_offset`) on
      any tool that can return an unbounded list.
- [ ] Every error result names the next call to make (e.g. an unknown repo
      lists the imported repos and points at `list_agents`/the correct name;
      an API-down error points at `./scripts/dev.sh`) — never a bare stack
      trace or a generic "request failed".
- [ ] `get_blast_radius` performs no I/O and always returns
      `{status: "not_implemented", message}` with `isError` unset — it never
      fails, and its description says plainly that it is a placeholder.
- [ ] The five tool descriptions together stay inside a ~400-token budget
      (measured: 1579 chars of `description` across `tools/list`), so
      the server's tool list is cheap to keep in an agent's context at session
      start.

## Out of scope

- ~~**Blast Radius proper.**~~ **Shipped** (the homework, landed after this
  spec): `server/src/modules/blast` serves `GET /pulls/:id/blast` over
  `container.repoIntel.getBlastRadius`, the client renders it as the PR page's
  **Blast radius** tab, and `get_blast_radius` is a real tool over that route —
  no longer a stub. The facade gained a per-symbol caller cap and a two-level
  reverse walk over `file_edges` for endpoint reachability; the previously
  unused `BlastRadius` contract now carries `status`/`reason` so a thin index
  is reported rather than flattened into an empty map. An opt-in
  `POST /pulls/:id/blast/summary` adds one model call that narrates the
  computed map; the `GET` never calls a model.
- **HTTP transport or auth for the MCP server itself.** It talks stdio to the
  calling agent and plain HTTP (no auth) to the local API, exactly as the API
  itself has no auth locally (`LocalNoAuthProvider`).
- **A `run_id`-polling tool.** `run_agent_on_pr` owns the whole poll loop
  internally; there is no separate "check run status" tool.
- **Cross-call caching or session state** in the MCP process — every call
  re-resolves `repo`/`pr`/`agent` from the API.
- **`.mcp.json` registration** — tracked as a separate step in the parent plan,
  not part of this spec.

## Touched surfaces

- **new package** — `mcp/` (`@devdigest/mcp`), standalone npm package (own
  `package.json` + lockfile, like `reviewer-core/` and `e2e/`), consumed as
  TypeScript source via `tsx`, never emitting JS for production use.
- **contracts** — read-only, type-only consumer of
  `server/src/vendor/shared` via the same tsconfig alias + zod self-pin
  pattern as `reviewer-core`. No new contracts added; nothing here writes to
  the shared package.
- **server** — no server changes. All five tools are HTTP clients of the
  existing routes (`/repos`, `/repos/:id/pulls`, `/agents`,
  `/pulls/:id/review`, `/pulls/:id/runs`, `/pulls/:id/reviews`,
  `/repos/:id/conventions`); `run_agent_on_pr` polls
  `agent_runs.status` to a terminal state rather than adding a new endpoint.
- **CI** — new `mcp.yml` workflow, path-filtered on `mcp/**` and
  `server/src/vendor/shared/**`, mirroring `reviewer-core.yml`.
