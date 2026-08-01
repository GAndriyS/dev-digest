# Insights — server

Findings scoped to the API (repo-intel entries tagged `[repo-intel]`).
Maintained by the `engineering-insights` skill, append-only. Entry format and
promotion rules → root `INSIGHTS.md`.

## What Works

## What Doesn't Work

## Codebase Patterns

- **2026-07-31** — Course features cut from the starter were removed
  *surgically*: the computation usually survives and only persistence + display
  were stripped. Before building one, read the removal commit
  (`git log --oneline --all | grep -i remove`) — for run cost, `d45ab0d` and
  `58c6ac7` left `ReviewOutcome.costUsd`, `PriceBook`, and the provider's
  `usage.cost` hook fully intact, so the "feature" was ~6 small edits, not new
  pricing logic. `git show <commit> --stat` is the file-by-file worklist.

## Tool & Library Notes

- **2026-07-31** — tsx watch restarts only on imported-module changes; editing
  `server/.env` does nothing until a manual restart, because config is read
  once at boot (`platform/config.ts`). Verified: `/settings/secrets-status`
  showed the new keys only after killing and restarting `pnpm dev`.

## Recurring Errors & Fixes

- **2026-07-31** — `test/indexer-pipeline.test.ts` fails 6/11 on Windows with
  `ENOENT … \src\util.ts`: its fixture writer splits paths on `lastIndexOf('/')`
  to mkdir the parent, which never matches a backslash path, so the parent dir
  is never created. **Pre-existing, not yours** — confirmed by `git stash` +
  re-run on a clean tree. CI is Linux-only so it is green there. Don't chase it
  when a server suite comes back 6-red on Windows.

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
