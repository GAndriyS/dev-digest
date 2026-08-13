# Insights — mcp

Findings scoped to the `devdigest-mcp` stdio server. Maintained by the
`engineering-insights` skill, append-only. Entry format and promotion rules →
root `INSIGHTS.md`.

## What Works

## What Doesn't Work

## Codebase Patterns

- **2026-08-13** — `POST /pulls/:id/review {all:true}` answers **200 `{runs: []}`**
  when the workspace has no *enabled* agent — it does not 400. `resolveTargets`
  returns `agents.listEnabled(workspaceId)` verbatim and neither the service nor
  the route guards the empty set (`server/src/modules/reviews/service.ts:51`,
  `routes.ts:33`). Anything that polls "until every started run is terminal"
  must reject the empty id set explicitly first: an empty set trivially
  satisfies *every* terminal predicate, so the loop returns on its first tick
  and a review that never ran is indistinguishable from one that ran and found
  nothing — the worst possible answer to give a coding agent, which will report
  the PR as clean. Note this is only reachable via `all` (a `{agentId}` request
  404s on an unknown agent, and runs a disabled one). (`mcp/src/tools/run-agent-on-pr.ts`,
  guard + regression test in `test/tools/run-agent-on-pr.test.ts`)

## Tool & Library Notes

- **2026-08-12** — Do NOT copy reviewer-core's `"zod/*": ["./node_modules/zod/*"]`
  tsconfig path entry into a package that also depends on
  `@modelcontextprotocol/sdk` (or anything else importing zod subpaths like
  `zod/v3`/`zod/v4/core`). The installed `zod` here resolved to `3.25.76`, a
  transitional package whose root export re-exports `./v3/external.cjs` while
  its `./v3` and `./v4/core` subpath exports point at *sibling* declaration
  files (`v3/index.d.cts` etc). A blanket `"zod/*"` path mapping bypasses
  `package.json` "exports" resolution and lands on a different physical `.d.ts`
  than the real subpath export would, so TS treats the SDK's `zod/v3` classes
  as structurally unrelated to ours — every `registerTool({ inputSchema:
  Schema.shape, ... })` call fails to typecheck with a wall of "types returned
  by `refine(...)` are incompatible" errors, and checking all five tools'
  schemas against that broken assignability blows up `tsc`'s heap (OOM after
  ~100s, `Ineffective mark-compacts near heap limit`). Fix: keep only `"zod":
  ["./node_modules/zod"]` (the bare specifier reviewer-core's own code
  actually uses) and drop the `"zod/*"` wildcard entirely — nothing in this
  package imports a zod subpath itself, and dropping the wildcard lets the
  SDK's own subpath imports resolve normally through `exports`. (`mcp/tsconfig.json`)

- **2026-08-12** — Pass the whole `.strict()` Zod object as `registerTool`'s
  `inputSchema`, never `Schema.shape`. With a raw shape the SDK rebuilds a
  plain `z.object(shape)` to validate incoming calls, and zod objects STRIP
  unknown keys by default — so `.strict()` reaches the advertised JSON Schema
  (`tools/list` does show `additionalProperties:false`) while runtime silently
  drops the extra key. A caller's typo (`sevrity` for `severity`) then returns
  a cheerful unfiltered result instead of an error, which is exactly the
  failure strict schemas exist to prevent. Worse, a handler-side defensive
  re-parse does NOT fix it: the extra key is already gone before the handler
  runs. `@modelcontextprotocol/sdk@1.30` types `inputSchema` as
  `ZodRawShapeCompat | AnySchema`, so passing the object itself is legal and
  makes the SDK reject the call as `-32602 Invalid arguments … Unrecognized
  key(s)`. Verified `additionalProperties:false` is still emitted afterwards.
  The advertised schema and the enforced schema are two different things —
  check the enforced one with a live call, not by reading `tools/list`.
  (`mcp/src/tools/*.ts`, regression test in `test/tools/get-findings.test.ts`)

## Recurring Errors & Fixes

## Session Notes

## Open Questions
