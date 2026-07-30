# Insights — server

Findings scoped to the API (repo-intel entries tagged `[repo-intel]`).
Maintained by the `engineering-insights` skill, append-only. Entry format and
promotion rules → root `INSIGHTS.md`.

## What Works

## What Doesn't Work

## Codebase Patterns

## Tool & Library Notes

- **2026-07-31** — tsx watch restarts only on imported-module changes; editing
  `server/.env` does nothing until a manual restart, because config is read
  once at boot (`platform/config.ts`). Verified: `/settings/secrets-status`
  showed the new keys only after killing and restarting `pnpm dev`.

## Recurring Errors & Fixes

- **2026-07-31** — A CLI guard of the form
  ``import.meta.url === `file://${process.argv[1]}` `` never matches on Windows
  (backslash argv path vs `file:///E:/...` URL), so the script exits 0 having
  done nothing — a green exit with an empty database behind it. Fix applied in
  `src/db/migrate.ts` / `src/db/seed.ts`: compare against
  `pathToFileURL(process.argv[1]).href` (guard `process.argv[1]` first —
  `noUncheckedIndexedAccess` types it `string | undefined`). Any new tsx CLI
  entrypoint must use the same form.

## Session Notes

## Open Questions
