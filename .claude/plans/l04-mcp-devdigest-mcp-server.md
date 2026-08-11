# Plan: `devdigest-mcp` — local stdio MCP server over the DevDigest API (L04)

> **Execution (user-directed):** delegate to the `implementer` agent. Two parallel lanes on disjoint files: lane A = the `mcp/` package (steps 0–9); lane B = repo docs/routing/CI (steps 11–13). Step 10 (`.mcp.json`) lands after lane A fixes the launch command. Main session orchestrates, verifies, and runs the live end-to-end check.

## Context

Lesson L04 of the course adds a `devdigest-mcp` server (README.md:85). The user wants a **local stdio MCP server** with five tools — `list_agents`, `run_agent_on_pr`, `get_findings`, `get_conventions`, `get_blast_radius` (stub) — so coding agents (Claude Code) can drive DevDigest reviews directly. Four design principles are fixed by the course slides: (1) result-not-operation — `run_agent_on_pr` starts, waits, and returns finished findings; (2) flat arguments; (3) concise structured responses, never raw dumps; (4) errors that name the next call. Token-efficiency requirements were researched and agreed: ~200–300 tokens per tool description, strict flat Zod schemas, `outputSchema` + `structuredContent`, pagination + `CHARACTER_LIMIT` 25 000.

User decisions (fixed): separate standalone npm package `mcp/` (fifth package, like `reviewer-core/`/`e2e/`), talking to the API over HTTP at `127.0.0.1:3001` — no DB, no DI imports; tool names exactly as the slides (Claude Code namespaces them `mcp__devdigest__*`); `agent` argument optional → all enabled agents; stdio only.

**Branch:** `L04-MCP`. First implementation step: persist this plan as `.claude/plans/l04-mcp-devdigest-mcp-server.md` (repo convention — plan mode prevented the planner from writing it).

## Verified API facts the tools build on

- No auth/headers: `LocalNoAuthProvider` resolves the default workspace for any HTTP client. Global rate limit 120/min (`server/src/app.ts:96`); `POST /pulls/:id/review` is 10/min. Error envelope `{error:{code,message,details}}` (`contracts/platform.ts:290`).
- `GET /repos` → `Repo[]` with `full_name` ("owner/name") — no lookup-by-name endpoint, filter client-side.
- `GET /repos/:id/pulls` → `PrMeta[]`; `id` is the pull uuid (**nullable** — reject with an onward message), `number` is the GitHub PR number. CAVEAT: syncs from GitHub when a token exists — can be slow; 60 s request timeout, do not shorten.
- `GET /agents` → `Agent[]`; `name` is the only human identifier. `all:true` runs only **enabled** agents.
- `POST /pulls/:id/review` body `{agentId?|all?}` — **returns immediately**, `reviews` is ALWAYS `[]` (fire-and-forget, `reviews/service.ts:139`). The MCP tool must poll.
- Run lifecycle: `agent_runs.status` ∈ `running` → `done`|`failed`|`cancelled` (NO `queued`, success is `done` — `contracts/trace.ts:102`). Poll `GET /pulls/:id/runs` until every started `run_id` leaves `running`. SSE has no terminal event — polling is correct.
- `GET /pulls/:id/reviews` → `ReviewDto[]` `{id, run_id, agent_name, kind, verdict (request_changes|approve|comment|null), summary, score, findings[]}`. Correlate to started runs via `run_id`. Dismissed findings are NOT pre-filtered.
- `GET /repos/:id/conventions` → `ConventionCandidate[]` `{category, rule, evidence_path/snippet/line, confidence, status: pending|accepted|rejected}`; un-extracted repo → `[]`, not an error.
- Blast radius: **no HTTP endpoint exists.** Facade `container.repoIntel.getBlastRadius` and wire contract `BlastRadius` (`contracts/brief.ts:60`) exist for the homework. The stub invents nothing.
- `http://127.0.0.1:3001`, **never `localhost`** — Windows resolves localhost to `::1` where another project's API lives (root INSIGHTS.md).

## Key design decisions

1. **Types from `@devdigest/shared` via tsconfig alias, `import type` ONLY.** Same alias pair + zod self-pin as `reviewer-core/tsconfig.json`. Type-only imports are erased → nothing resolves the alias at runtime, no second zod instance. A value import from `@devdigest/shared` in this package is a bug (stated in `mcp/AGENTS.md`). `mcp/vitest.config.ts` deliberately has NO alias — the first offending test fails to resolve.
2. **`get_findings` aggregates across EVERY review of the PR, dismissed excluded** — same rule as Smart Diff (`docs/smart-diff.md:61-75`): latest-only buries findings that a newer empty review didn't reproduce. No `include_dismissed` toggle. Findings keep their `agent` name; no cross-agent dedup.
3. **Resolution seam:** `repo` accepts `full_name` case-insensitively (bare `name` OK when unambiguous); `pr` matches on `number`; `agent` matches name case-insensitively, falls back to uuid. Every miss lists the candidates in the error. No cross-call cache.
4. **Launch command `node mcp/node_modules/tsx/dist/cli.mjs mcp/src/index.ts`** — no `.cmd` shim/network dependency of `npx` on Windows.
5. **`get_blast_radius` does no I/O:** validates args, returns `{status:'not_implemented', message}` pointing at `get_findings`. Never `isError`. Description says plainly it is a stub.
6. **Errors:** return `{content:[text], isError:true}`, **omit `structuredContent`** (an error object would fail `outputSchema` validation at the transport layer).
7. **stdout discipline:** stdout is JSON-RPC only; diagnostics → stderr, off unless `DEVDIGEST_MCP_LOG=1`.
8. **Onion seams inside the package** (audited against `.claude/skills/onion-architecture`): `src/index.ts` is the composition root — it constructs the api-client once and hands it to tool factories (`registerListAgents({api, config})`-style). `lib/api-client.ts` is the single adapter that owns `fetch`; `lib/{resolve,poll,shape}.ts` are the service layer and take resolved values, never transport objects; `registerTool`'s Zod schemas are the edge validation (the analogue of a Fastify route schema). Tests substitute the **api-client object** at the factory seam — not `vi.mock` of module paths, mirroring the repo's `ContainerOverrides`-not-module-mocks rule; only api-client's own tests stub global `fetch`.

## Steps

| # | Change | Files |
|---|--------|-------|
| 0 | Persist the committed plan | `.claude/plans/l04-mcp-devdigest-mcp-server.md` |
| 1 | Package skeleton: npm, ESM, TS ^5.7.2, tsconfig mirrors reviewer-core (+shared alias + zod self-pin + `allowImportingTsExtensions`), vitest config | `mcp/package.json`, `mcp/tsconfig.json`, `mcp/vitest.config.ts`, `mcp/src/index.ts` |
| 2 | Config + constants: zod env parse; `DEVDIGEST_API_URL` (default `http://127.0.0.1:3001`), `DEVDIGEST_MCP_RUN_TIMEOUT_MS` (600 000), `DEVDIGEST_MCP_POLL_INTERVAL_MS` (2 000, backoff to 5 000 after 1 min), `DEVDIGEST_MCP_REQUEST_TIMEOUT_MS` (60 000), `DEVDIGEST_MCP_LOG`; `CHARACTER_LIMIT` 25 000 | `mcp/src/config.ts`, `mcp/src/constants.ts` |
| 3 | HTTP client + onward-leading errors: one module owns `fetch`; `AbortSignal.timeout`; decodes `ApiErrorBody`; error table (API down → "start ./scripts/dev.sh"; repo miss → list imported; PR miss → list numbers; agent miss → "call list_agents"; 429 → wait a minute) | `mcp/src/lib/api-client.ts`, `mcp/src/lib/errors.ts` |
| 4 | Resolution seam (decision 3) | `mcp/src/lib/resolve.ts` |
| 5 | Poll loop: all started runs terminal → `completed`; cap hit → `timeout` (structured result, NOT an error, message names `get_findings`); all terminal but some non-`done` → `partial` | `mcp/src/lib/poll.ts` |
| 6 | Schemas + shaping: `.strict()` input objects (pass `.shape` to `registerTool`), output objects, severity sort, dismissed exclusion, aggregation, truncation | `mcp/src/schemas.ts`, `mcp/src/lib/shape.ts` |
| 7 | Five tools + bootstrap: tool factories taking `{api, config}` (decision 8), `McpServer` (`name:'devdigest-mcp'`, one-line `instructions`), `registerTool` ×5 (modern API only — no deprecated `server.tool()`), `StdioServerTransport`; `index.ts` = composition root | `mcp/src/tools/*.ts`, `mcp/src/index.ts` |
| 8 | Unit tests: api-client tests stub global `fetch`; resolve/poll (fake timers)/shape/tool round-trips substitute a fake api-client at the factory seam (decision 8), each tool result validated against its own `outputSchema`. `*.test.ts` only — NEVER `*.it.test.ts` (that's the server's Docker lane) | `mcp/test/*.test.ts` |
| 9 | Package docs: README (tools table, prerequisites, env vars, Inspector cmd, localhost/127.0.0.1 trap, resolved SDK version), AGENTS.md (iron rule: HTTP only), two-line CLAUDE.md `@AGENTS.md`, INSIGHTS.md template | `mcp/README.md`, `mcp/AGENTS.md`, `mcp/CLAUDE.md`, `mcp/INSIGHTS.md` |
| 10 | Register server: project-scoped `.mcp.json` at repo root (new — none exists), key `devdigest`, command per decision 4, env `DEVDIGEST_API_URL=http://127.0.0.1:3001` (hardcode if `${API_PORT:-3001}` expansion unsupported). Do NOT pre-approve via `enabledMcpjsonServers` | `.mcp.json` |
| 11 | Repo docs + spec: root AGENTS.md "four→five packages" + npm list + Use-when line; README package table row; TESTING.md count + suite row; `specs/L04-devdigest-mcp.md` (Blast Radius endpoint recorded as Out of scope/homework); specs/README.md:37 backlog link | `AGENTS.md`, `README.md`, `TESTING.md`, `specs/L04-devdigest-mcp.md`, `specs/README.md` |
| 12 | Review routing: `mcp/** → backend` row in the slice table + pr-self-review patch version bump + CHANGELOG + catalog badge (all three touchpoints, INSIGHTS.md:68-74) | `.claude/skills/pr-self-review/{routing.md,SKILL.md,CHANGELOG.md}`, `.claude/skills/README.md` |
| 13 | CI: `mcp.yml` mirroring `reviewer-core.yml` — paths `['mcp/**','server/src/vendor/shared/**','.github/workflows/mcp.yml']`, node 22, npm ci → typecheck → test | `.github/workflows/mcp.yml` |

## Tool specs (step 6–7 detail)

Shared: description 2–4 sentences (what / when / when NOT), `.describe()` on every field, one-line text summary + `structuredContent` payload.

- **`list_agents`** `{enabled_only?: boolean = true}` (matches what a no-agent run would do). Out: `{count, agents:[{name, description≤120, provider, model, enabled, strategy, ci_fail_on}]}` — **ids omitted** (name is the identifier all tools accept). Annotations `{readOnlyHint:true, openWorldHint:false}`.
- **`run_agent_on_pr`** `{repo: string, pr: number, agent?: string}`. Start (`all:true` when agent omitted) → poll → collect `GET /pulls/:id/reviews` filtered to started `run_id`s. Out: `{status: completed|partial|timeout, verdict (worst-of: request_changes > comment > approve), score, counts, agents_run:[{agent,status,verdict,score,findings_count,error?}], findings[], truncated?, message?}`. A failed run reports in `agents_run`, doesn't abort others. Annotations `{readOnlyHint:false, destructiveHint:false, idempotentHint:false, openWorldHint:true}`.
- **`get_findings`** `{repo, pr, severity?, limit? = 20 (max 100), offset? = 0}`. Aggregation per decision 2; sort severity desc → confidence desc → file. Out: `{pr:"owner/name#42", total, returned, offset, next_offset?, counts, findings:[{severity, category, title, file, lines:"12-18", agent, confidence, rationale≤500, suggestion?≤500}], truncated?, message?}`. Drop `id/review_id/kind/accepted_at/dismissed_at/trifecta`. Annotations read-only.
- **`get_conventions`** `{repo, status? = 'accepted', limit? = 50}`. Out: `{repo, count, conventions:[{category, rule, evidence:"path:line", confidence, status}]}` (snippet dropped). Empty accepted set → onward message naming `status:'pending'` and the studio extractor. Annotations read-only.
- **`get_blast_radius`** `{repo, pr}` — the real schema the implemented tool will keep. Out: `{status:'not_implemented', message}`. No I/O. Annotations read-only.

## Tool descriptions (verbatim — the implementer uses these exact texts)

- **list_agents**: "Lists the review agents configured in DevDigest, with each agent's name, provider and model. Call it to discover valid agent names before `run_agent_on_pr`, or to see what a run without an explicit agent would execute. Not for run results or findings — agents are configuration, not output."
  - `enabled_only`: "Only agents that a run without an explicit agent would execute (default true)."
- **run_agent_on_pr**: "Runs an AI review on a pull request and waits for it to finish, returning the verdict and findings in one call. Omit `agent` to run every enabled agent, or pass a name from `list_agents` to run one. Each call spends real LLM tokens and appends a new review to the PR's history — to read existing results, use `get_findings` instead. Reviews can take minutes; if the wait cap is hit, the result says so and `get_findings` collects the outcome later."
  - `repo`: "Repository as \"owner/name\"." · `pr`: "Pull request number (the GitHub #number, not an internal id)." · `agent`: "Agent name from list_agents; omit to run all enabled agents."
- **get_findings**: "Returns the review findings already recorded for a pull request — aggregated across every review run, dismissed findings excluded. Free: reads stored results without starting a new review. Call it to read results, after a `run_agent_on_pr` timeout, or to page through a large set; if the PR has never been reviewed it returns zero findings — run `run_agent_on_pr` first."
  - `severity`: "Only findings of this severity (CRITICAL | WARNING | SUGGESTION); omit for all." · `limit`: "Max findings per page, 1-100 (default 20)." · `offset`: "Findings to skip for pagination (default 0)."
- **get_conventions**: "Returns the repository's coding conventions extracted by DevDigest's conventions extractor. By default only accepted conventions — pass status \"pending\" to see unratified candidates. Repo-level, not PR-level: for review findings on a pull request use `get_findings`."
  - `status`: "accepted (default) | pending | rejected." · `limit`: "Max conventions returned (default 50)."
- **get_blast_radius**: "Not implemented yet — a placeholder for the second half of L04. Always returns `status: \"not_implemented\"` and never fails. Do not plan work around its output; for this PR's review data use `get_findings`."
  - `repo`/`pr`: same describes as run_agent_on_pr.

Budget check: five descriptions ≈ 330 tokens total; with schemas the whole server ≈ 1–1.2k tokens at session start.

**Measured after implementation:** 1579 description chars ≈ **395 tokens** across `tools/list` — the ~330 estimate above was low; the docs record the measured ~400 ceiling instead.

## Out of scope

Blast Radius server module/HTTP route (homework; recorded in the spec); HTTP transport/auth; dependency-cruiser config for `mcp/`; `scripts/dev.sh`/`e2e.sh` changes (mcp is not app runtime); `.claude/settings.json` changes; architecture/security review and PR opening (`/pr-self-review` afterwards).

## Risks (checked during verification)

- Claude Code may surface only `content`, not `structuredContent` → live check; fallback: compact JSON in the text block too.
- SDK drift (`registerTool`/`outputSchema` missing in resolved 1.x) → typecheck fails; report, don't fall back to `server.tool()`.
- `.strict()` may not reach emitted JSON Schema → read Inspector's `tools/list` output.
- Launch command on Windows → prove with Inspector (same argv) before `.mcp.json`; fallback: absolute path, then `cmd /c npx tsx`.
- Poll budget vs 120/min global limit → backoff to 5 s after the first minute.

## Verification

```sh
node -v                                    # must be 22.x (INSIGHTS: depcruise-style crashes on 18)
cd mcp && npm install && npm run typecheck && npm test
npx @modelcontextprotocol/inspector node node_modules/tsx/dist/cli.mjs src/index.ts
#   check: 5 tools, descriptions 2-4 sentences, additionalProperties:false, outputSchema, annotations
#   with stack DOWN: list_agents → "start the stack with ./scripts/dev.sh", not a stack trace
# live: ./scripts/dev.sh; curl http://127.0.0.1:3001/health
#   in Claude Code from repo root: /mcp → approve → 5 tools
#   list_agents → run_agent_on_pr (seeded PR; with and without agent) → get_findings (severity, offset)
#   → get_conventions (un-extracted repo → onward message) → get_blast_radius (not_implemented, no error)
#   negative probes: wrong repo / PR number / agent name → each names the next call
cd server && pnpm typecheck               # nothing regressed
cd reviewer-core && npm run typecheck && npm test
```

## Assumed defaults (veto at review if wrong)

1. routing.md gets the `mcp/**→backend` row + version-bump paperwork (yes).
2. `specs/L04-devdigest-mcp.md` is written (yes — it records the Blast Radius boundary).
3. `get_conventions` defaults to `status:'accepted'`.
4. Dismissed findings always excluded, no toggle.
5. SDK: latest 1.x, resolved version recorded in `mcp/README.md`.
6. `.mcp.json` server key `devdigest` → tools surface as `mcp__devdigest__<tool>` (renaming later breaks what the model learned).
