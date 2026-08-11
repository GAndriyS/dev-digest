# `@devdigest/mcp` — devdigest-mcp

A local **stdio MCP server** that lets a coding agent (Claude Code) drive
DevDigest reviews directly: discover the configured review agents, run one on
a pull request and wait for its findings, and read stored findings/conventions
— all as tool calls instead of a human clicking through the studio UI.

It talks to the DevDigest API over plain HTTP. No database, no Fastify, no
Drizzle — see `AGENTS.md`'s iron rule.

## Tools

| Tool | Arguments | Returns |
|---|---|---|
| `list_agents` | `enabled_only?: boolean` (default `true`) | `{count, agents[]}` — name, provider, model, enabled, strategy, ci_fail_on |
| `run_agent_on_pr` | `repo: string`, `pr: number`, `agent?: string` | Starts a review, **waits for it to finish**, then `{status, verdict, score, counts, agents_run[], findings[]}` |
| `get_findings` | `repo: string`, `pr: number`, `severity?`, `limit?` (default 20, max 100), `offset?` | `{pr, total, returned, offset, counts, findings[]}` — every review of the PR, dismissed excluded |
| `get_conventions` | `repo: string`, `status?` (default `accepted`), `limit?` (default 50) | `{repo, count, conventions[]}` |
| `get_blast_radius` | `repo: string`, `pr: number` | **Stub** — `{status: "not_implemented", message}`. No HTTP endpoint exists yet (homework for a later lesson); this tool does no I/O and never fails. |

`run_agent_on_pr` is the only tool that spends real LLM tokens and mutates
anything (a new review row per call). The other four are free reads.

## Prerequisites

- Node **22** (matches the rest of the repo — see root `AGENTS.md`).
- The DevDigest API running: `./scripts/dev.sh` from the repo root, or `cd
  server && pnpm dev`. This package makes no requests until a tool is called,
  so the server itself always starts even with the API down — only a tool
  *call* fails, with a message telling you to start the stack.

## Install

```sh
cd mcp
npm ci
npm run typecheck
npm test
```

npm, **not** pnpm — this package has its own `package-lock.json`, same as
`reviewer-core/` and `e2e/` (root `AGENTS.md`: four independent packages, not
a workspace).

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `DEVDIGEST_API_URL` | `http://127.0.0.1:3001` | Base URL of the DevDigest API. **Never `localhost`** — see Troubleshooting. |
| `DEVDIGEST_MCP_RUN_TIMEOUT_MS` | `600000` (10 min) | Wait cap for `run_agent_on_pr`'s poll loop. Hitting it returns a structured `status:"timeout"` result, not an error. |
| `DEVDIGEST_MCP_POLL_INTERVAL_MS` | `2000` | Poll interval for the first minute of a run; backs off to 5s after that (API's global rate limit is 120/min). |
| `DEVDIGEST_MCP_REQUEST_TIMEOUT_MS` | `60000` | Per-HTTP-request timeout (matches the API's own PR-sync timeout). |
| `DEVDIGEST_MCP_LOG` | unset | Set to `1` to write diagnostics to **stderr**. stdout is JSON-RPC only — this is off by default so nothing ever touches it accidentally. |

## Running it

Launch command (no `.cmd` shim / `npx` network dependency on Windows):

```sh
node mcp/node_modules/tsx/dist/cli.mjs mcp/src/index.ts
```

Inspect it interactively with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```sh
npx @modelcontextprotocol/inspector node node_modules/tsx/dist/cli.mjs src/index.ts
```

(run from `mcp/`). Check: 5 tools, `additionalProperties:false` on every
input schema, an `outputSchema` on every tool, and annotations matching the
tools table above.

Resolved SDK version: **`@modelcontextprotocol/sdk@1.30.0`** (uses the modern
`registerTool`/`outputSchema`/`structuredContent` API — see `AGENTS.md`).

## Troubleshooting

- **"Could not reach the DevDigest API"** — the stack isn't up. Run
  `./scripts/dev.sh` (or `cd server && pnpm dev`) and retry the same call.
- **The API is up but every call still fails to connect** — check for the
  `localhost` vs `127.0.0.1` trap: on Windows, `localhost` can resolve to
  `::1`, where an unrelated project's server may be listening, while DevDigest
  binds `127.0.0.1`. This package's default (`DEVDIGEST_API_URL`) is already
  `127.0.0.1` for exactly this reason — if you've overridden it to
  `localhost`, put it back. Curl `http://127.0.0.1:3001/health` directly to
  confirm you're really reaching DevDigest (its 404 body says `Route GET:/x
  not found`; a look-alike Express server on the same port over `localhost`
  says `Cannot GET /x`).
- **A tool result has no `structuredContent`** — that only happens when
  `isError:true` is also set (plan decision: an error object would fail the
  tool's own `outputSchema`). Read `content[0].text` for the message; it
  always names the next call to make.
