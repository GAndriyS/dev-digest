# Insights — e2e

Findings scoped to the browser suite. Maintained by the `engineering-insights`
skill, append-only. Entry format and promotion rules → root `INSIGHTS.md`.

## What Works

## What Doesn't Work

## Codebase Patterns

## Tool & Library Notes

- **2026-08-04** — On Windows the runner dies with `spawn agent-browser ENOENT`
  on every step even when `agent-browser --version` works in the shell. `run.ts`
  uses `execFile`, which goes through CreateProcess and cannot execute the npm
  `.cmd`/`.ps1` shims that provide the command on PATH. Point it at the real
  binary instead:
  `AGENT_BROWSER_BIN='C:\Users\<you>\AppData\Roaming\npm\node_modules\agent-browser\bin\agent-browser-win32-x64.exe'`
  (`npm root -g` locates it). Nothing about the flows or the app is wrong when
  this happens — all seven fail identically on their first step.

## Recurring Errors & Fixes

- **2026-08-04** — `./scripts/e2e.sh` fails with `'tsx' is not recognized` right
  after "running e2e flows". The script installs deps for `server/`, `client/`
  and `reviewer-core/` but NOT for `e2e/` itself — CI does that in a separate
  `npm ci` step, so the gap only shows locally. Run `cd e2e && npm ci` once. The
  stack comes up fully before this hits, so the failure looks like a flow problem
  and is not.
- **2026-08-04** — `./scripts/e2e.sh` aborts at step one with
  `Bind for 0.0.0.0:5433 failed: port is already allocated`. Port 5433 is the
  script's default for its ephemeral Postgres and is also taken by
  `madiro-shoes-postgres-1` — the same neighbouring project that already collides
  on 3001 (see root `INSIGHTS.md`). Override the whole port set rather than
  stopping their stack:
  `E2E_PG_PORT=5443 E2E_API_PORT=3101 E2E_WEB_PORT=3100 ./scripts/e2e.sh`.

## Session Notes

## Open Questions
