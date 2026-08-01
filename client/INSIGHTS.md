# Insights — client

Findings scoped to the web app. Maintained by the `engineering-insights` skill,
append-only. Entry format and promotion rules → root `INSIGHTS.md`.

## What Works

## What Doesn't Work

## Codebase Patterns

## Tool & Library Notes

- **2026-07-31** — In the agent Browser pane, a tab whose pane is not displayed
  reports `document.visibilityState === "hidden"`, and Next.js never finishes
  hydrating it: zero client fetches fire, the SSR shell sticks on its loading
  state, and React's bootstrap scripts stay visible in `body.textContent`.
  Nothing is wrong with the app. Also `element.innerText` returns `""` there
  (it is layout-dependent) — probe with `textContent`, and confirm
  `visibilityState` before debugging a "stuck loading" UI.

## Recurring Errors & Fixes

## Session Notes

## Open Questions
