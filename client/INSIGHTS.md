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

## Tool & Library Notes

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
