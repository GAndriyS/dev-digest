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

- **2026-08-04** — Running `scripts/e2e.sh` while a dev `next dev` is up in the
  same checkout poisons BOTH: they share `client/.next`, and `NEXT_PUBLIC_*` is
  inlined into the compiled chunks at dev-server start. The hermetic run bakes
  `NEXT_PUBLIC_API_BASE=http://localhost:3101` into the shared cache, and the
  dev server on :3000 then serves those chunks — so the dev UI silently calls
  the e2e API port and every page renders "Could not load…" while `curl` against
  :3001 answers 200 and `client/.env` looks correct. The tell is in
  `agent-browser network requests`: the page fetches **:3101**. Stop the dev web
  server and `rm -rf client/.next` before a hermetic run; the DB and API ports
  are already isolated, the build cache is not.
- **2026-08-04** — A wedged agent-browser daemon fails `open` outright (the URL
  stays `about:blank`, later invocations hang until timeout) and leaves orphaned
  Chrome processes behind. `close --all` does not recover it. Kill only its own
  browsers — `Get-Process chrome | Where-Object { $_.Path -like '*\.agent-browser\*' }`
  — never all of Chrome, since the user's own browser shares the image name.
  After that the next `open` succeeds immediately.
- **2026-08-04** — agent-browser keeps ONE shared session per daemon, so two
  things driving it at once silently corrupt each other's results. Running a
  manual page sweep against the dev stack (:3000) while `scripts/e2e.sh` was
  mid-suite on its own stack (:3100) made flows fail on assertions that were
  actually true — `wait --url /pulls` timing out, `wait --text "Security
  Reviewer"` not finding text that was on the page. The tell: `agent-browser get
  url` after opening `localhost:3000` reported **:3100**. Nothing is wrong with
  the app or the flows when this happens. Drive the browser from ONE process at
  a time; if a suite is running, wait for it.

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
