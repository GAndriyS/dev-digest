# Insights — e2e

Findings scoped to the browser suite. Maintained by the `engineering-insights`
skill, append-only. Entry format and promotion rules → root `INSIGHTS.md`.

## What Works

## What Doesn't Work

## Codebase Patterns

## Tool & Library Notes

- **2026-08-19** — `find role link click --name "<label>"` does **not** resolve
  the sidebar entries, even though they render as `<a>`: the hermetic run failed
  with `Command failed: agent-browser find role link click --name Onboarding
  Tour` while every other step passed, and switching to `find text "<label>"
  click` (what `10-project-context.flow.json` already uses for Project Context)
  made the same flow green. Prefer the text locator for nav items; keep
  `find role button --name` for the in-page controls, where it does work
  (`08-skills.flow.json`). Both still need the `set viewport 1280 900` first
  step for the reason recorded above.

- **2026-08-18** — `find text <text> click` can report `✓ Done` and change
  nothing when the target sits UNDER a stacked sibling at the click point — the
  default headless viewport here is 1264×569, short enough that
  `RunTraceDrawer`'s fixed footer covers the "Prompt assembly" section header
  once scrolled into view, so three consecutive CLI clicks toggled nothing
  while a raw `element.click()` toggled it instantly. Confirm with
  `document.elementFromPoint` at the reported coordinate. The fix is
  `set viewport <w> <h>` as the flow's first step (1280×900 in
  `10-project-context.flow.json`), **not** a `scrollintoview` retry — scrolling
  does not correct for an overlay that is fixed. Second shape of the same bug
  (2026-08-19, `08-skills.flow.json`, CI-only): a target inside an
  independently-scrolling column (`overflowY: auto`, Skills Lab list) that lies
  below the 569px fold — `document.elementFromPoint` at the click point is
  `null`, the CLI still prints `✓`, and the flow times out on the NEXT step
  (`wait --url /skills/`). It passed locally only because the local viewport was
  taller; the tell is a flow green on a laptop and red only in CI at an
  identical commit. Same fix: `set viewport` first.

- **2026-08-04** — On Windows the runner dies with `spawn agent-browser ENOENT`
  on every step even when `agent-browser --version` works in the shell. `run.ts`
  uses `execFile`, which goes through CreateProcess and cannot execute the npm
  `.cmd`/`.ps1` shims that provide the command on PATH. Point it at the real
  binary instead:
  `AGENT_BROWSER_BIN='C:\Users\<you>\AppData\Roaming\npm\node_modules\agent-browser\bin\agent-browser-win32-x64.exe'`
  (`npm root -g` locates it). Nothing about the flows or the app is wrong when
  this happens — all seven fail identically on their first step.

## Recurring Errors & Fixes

- **2026-08-18** — `scripts/e2e.sh` can run a whole suite against a **stale
  server from an earlier interrupted run** and report the failures as flaky
  flows. Its readiness check `curl`s the target port and does not verify the
  responder is the process it just spawned, so an orphaned `node.exe` still
  bound to 3100/3101 satisfies it while the script's own `next dev`/`tsx`
  died a few lines earlier with `EADDRINUSE`. The tell: flows that assert on
  seeded text (`Add rate limiting to public API endpoints`) fail while flows
  with no seed-specific assertions pass — a stale differently-seeded app, not
  a broken flow. Kill whatever listens on the configured `E2E_*_PORT`s before
  rerunning. Related, same run: port 5433 was held by an unrelated project's
  Postgres container, which the script's own `E2E_PG_PORT` override handles —
  do not stop another project's container, and do not rely on the bare
  defaults on a machine that runs more than one Postgres.

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
- **2026-08-20** — The e2e stack's default web port (`E2E_WEB_PORT`, 3100,
  `scripts/e2e.sh:33`) is the SAME port `.claude/launch.json`'s `web` preview
  server uses, so running flows while the preview stack is up puts the flows on
  the dev server and the dev database. The failure looks nothing like a port
  clash: the stack boots, flows 02/04/05/08/10/12 die at
  `find text "Add rate limiting to public API endpoints" click` or
  `wait --url /skills/`, because those flows follow the home redirect to the
  FIRST repo and the dev DB has other repos (`e2e/AGENTS.md:24`). 5/12 passed
  with the preview up, 12/12 with
  `E2E_PG_PORT=5440 E2E_API_PORT=3201 E2E_WEB_PORT=3200 ./scripts/e2e.sh` and
  the identical tree. Move the whole port set when a preview is running — and
  note the reverse direction too: with no override, e2e takes 3100 and the
  preview `web` server dies mid-run.

- **2026-08-20** — `wait --text` / `get text` match the browser's **rendered**
  text, after CSS. This repo's `SectionLabel` and score-label spans are
  uppercased with `text-transform`, so a flow asserting the string from
  `client/messages/en/*.json` — `"Why + Risk Brief"`, `"Agent review score"` —
  fails with "text not found" while the label is plainly on screen. Match the
  uppercased form (`WHY + RISK BRIEF`). Applies to any styled label, and it is a
  false "the feature is broken" signal, not a flake: found while writing
  `12-pr-why-risk-brief.flow.json`.

## Session Notes

## Open Questions
