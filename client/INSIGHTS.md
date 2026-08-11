# Insights — client

Findings scoped to the web app. Maintained by the `engineering-insights` skill,
append-only. Entry format and promotion rules → root `INSIGHTS.md`.

## What Works

## What Doesn't Work

- **2026-08-01** — Typing a severity-aware component's callbacks with the UI
  kit's `Severity` fails `tsc`: `vendor/ui/primitives/tokens.ts:3` adds a fourth
  member `INFO` that the contract enum (`vendor/shared/contracts/findings.ts:11`
  — CRITICAL/WARNING/SUGGESTION) does not have, so a handler typed on the narrow
  union is not assignable to a prop typed on the wide one (`TS2322 … '"INFO"' is
  not assignable`). Type props on `Severity` from `@devdigest/shared` and cast
  only at the `<SeverityBadge severity={sev as UiSeverity}>` boundary — the same
  bridge `FindingCard.tsx:58` already uses. Do NOT widen your own types to the
  UI-kit union: `INFO` is unreachable from the API and would force dead branches.

## Codebase Patterns

- **2026-08-05** — The `Markdown` primitive emits a `.dd-md` wrapper and maps
  only `p`/`strong`/`code`/`a` through react-markdown's `components`. Everything
  else falls through to Tailwind Preflight, which flattens `h1`…`h6` to
  `font-size: inherit; font-weight: inherit` and sets `list-style: none` — so a
  skill body rendered as one flat wall of text is NOT a markdown-parsing bug,
  the HTML is correct and unstyled. Measured before the fix: `h1` and `h2`
  computed to 13px/400, identical to a `<p>`. `.dd-md` carried no rules at all
  and is the seam to style from `app/globals.css`; the primitive itself is
  vendored. Two traps when doing so: the primitive sets the inline-code chip via
  an INLINE style that react-markdown also applies to fenced blocks, so undoing
  it on `pre code` needs `!important`; and do not claim `color` on `.dd-md` —
  six call sites render Markdown inside containers that set their own.

- **2026-08-04** — The PR list defaults to the **Needs review** filter, so on a
  dev database where the seeded PR has already been reviewed the table reads
  "No pull requests" while the header above it says "1 open". That is the filter,
  not a data or hydration failure — click **All** and the row appears. Worth
  knowing before debugging an "empty" list: compare the open count in the header
  against the table before suspecting the API. The hermetic e2e stack seeds fresh,
  so flow 02 never sees this.

- **2026-08-11** — When you widen a shared component's props, export the new
  prop's type from its barrel. TS structural typing means a route can pass a
  matching object literal without importing anything, and
  `no-component-internals-from-app` tempts you to leave it at that — the rule
  forbids reaching *past* `index.ts`, which a type-only re-export does not do,
  so the barrel is not the obstacle it looks like. The trap is that prop types
  are usually all-optional: `{ defaultOpen?, findingLines? }` on both sides
  means the duplicate stays assignable through a rename of `findingLines`, the
  weak-type check is satisfied by the one surviving key, and the feature
  (Smart Diff's badges) goes quietly missing under a green typecheck. Shipped
  the duplicate first and had it caught in review — see `diff-viewer/index.ts`
  exporting `DiffFileMeta` next to `DiffCommentApi`, which is the same call
  made for the same reason.

## Tool & Library Notes

- **2026-08-06** — React Query discards a superseded mutation's per-`mutate`
  callbacks only when a NEW `mutate` starts on the same observer. So the usual
  "the library handles the race" assumption holds for pick-A-then-pick-B, and
  breaks for any handler that RETURNS EARLY before calling `mutate` — an
  unsupported extension, a failed `FileReader`, a validation guard. The earlier
  request stays in flight with its `onSuccess` armed and lands its data on top of
  the new error state: `ImportSkillDrawer` showed "Unsupported file" and then
  filled the form with the previous zip's skill, badged with the new filename.
  Guard those flows with a monotonic pick token captured at entry and re-checked
  inside `onSuccess` (`if (pick !== pickRef.current) return`). Same shape applies
  to any modal that snapshots props at mount: the overlay blocks CLICKS, not a
  mutation already in flight, so state read at save time can disagree with state
  captured at open time — take one snapshot and read only that.
- **2026-08-04** — The Browser-pane blocker is still live: `preview_start` opens
  the tab, but `document.visibilityState` stays `"hidden"` and `computer
  screenshot` fails outright with "the Browser pane is not displayed, so the page
  is not compositing frames". Do not spend another session working around it —
  drive the app with the e2e suite's `agent-browser` binary instead (it is
  installed for `e2e/`, renders normally, and has `console`, `errors`,
  `network requests` and `screenshot` subcommands, which is everything a page
  sweep needs). Full walk of all ten routes this way took one command.

- **2026-07-31** — In the agent Browser pane, a tab whose pane is not displayed
  reports `document.visibilityState === "hidden"`, and Next.js never finishes
  hydrating it: zero client fetches fire, the SSR shell sticks on its loading
  state, and React's bootstrap scripts stay visible in `body.textContent`.
  Nothing is wrong with the app. Also `element.innerText` returns `""` there
  (it is layout-dependent) — probe with `textContent`, and confirm
  `visibilityState` before debugging a "stuck loading" UI.
- **2026-08-01** — Follow-up to the above: "zero client fetches fire" is not
  reliable as the tell. On a non-displayed pane the PR-list page DID issue its
  react-query fetch (`read_network_requests` showed `GET :3001/repos/:id/pulls
  → 200`) yet the rows never appeared — React had the data and never committed
  the render, so the DOM kept only the SSR skeleton. A 200 in the network log
  therefore does not mean hydration finished: judge by whether the rendered DOM
  changed (`querySelectorAll` on something only the client render emits), not by
  the request list.
- **2026-08-01** — `read_console_messages` returns a buffer accumulated over the
  tab's whole life, and `location.reload()` does NOT clear it. After fixing a
  build error it keeps replaying the old `Module not found` — enough to make you
  re-diagnose a bug you already fixed. Confirm a fix against `preview_logs`
  (search the dev-server output for the error string) or the served HTML, never
  against the console buffer.

## Recurring Errors & Fixes

- **2026-08-01** — `Module not found: Can't resolve './contracts/findings.js'`
  from `src/vendor/shared/index.ts` means you added the first RUNTIME import
  from `@devdigest/shared`. The barrel re-exports with Node-ESM `.js`
  extensions that only exist post-build; tsc and Node map them back to `.ts`,
  webpack does not — so `tsc --noEmit` stays green and only `next dev` fails.
  It hid for so long because every other client import from the barrel is
  `import type`, erased before webpack resolves anything; importing a Zod
  schema (a value) is what trips it. Fixed once, for all future value imports,
  with `resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }` in
  `next.config.mjs` — do NOT work around it by hand-copying contract values
  into the client, which is exactly the duplication `@devdigest/shared` exists
  to prevent. Diagnostic tell: one route compiles and another fails on the same
  barrel — the failing one is the only route reaching a value.

## Session Notes

## Open Questions
