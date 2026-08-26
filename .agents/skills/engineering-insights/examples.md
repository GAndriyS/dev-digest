# Entry examples — good vs bad

The bar for every entry: **actionable cold**. A reader with no session context
knows exactly what to do or avoid, without asking follow-ups. And it must be
**consequential** — something downstream changes because it was written — and
**unique** — nothing already in the file says it.

## The two entries that most often should NOT be written

❌ *Interesting but inert.* `- **2026-07-31** — The review engine takes the
   provider's reported usage.cost when OpenRouter returns one, and falls back
   to the PriceBook estimate otherwise.`
   True, and genuinely interesting — but nothing a future session does changes
   because of it, and the code says it plainly. Trivia, not an insight.

❌ *A rephrasing of an existing entry.* If the file already says tsx watch
   ignores `.env`, do not add "remember to restart the API after editing env
   vars". Extend the original with a dated line only if you learned something
   new about it; otherwise write nothing.

## What Works

❌ `- **2026-07-31** — Batching helped with the timeout issue.`
✅ `- **2026-07-31** — Indexing a 3k-file repo: running ast-grep per directory
   (not per file) cut full-index time from ~90s to ~12s (server/src/modules/repo-intel/pipeline/full.ts).`

## What Doesn't Work

❌ `- **2026-07-31** — Promises can be tricky.`
✅ `- **2026-07-31** — Promise.all() over per-file LLM calls times out past ~30
   files; abandoned in favour of Promise.allSettled() with batches of 10 —
   partial failures must not kill the whole review run.`

The WHY is the payload. "X didn't work" without the reason forces the next
session to rediscover it.

## Codebase Patterns

❌ `- **2026-07-31** — The server uses dependency injection.`
   (Obvious to anyone reading `platform/container.ts` — fails the obviousness test.)
✅ `- **2026-07-31** — New route params/body schemas must come from
   @devdigest/shared, not be declared inline — inline zod objects bypass the
   shared-contract mirror into client/src/vendor/shared and drift silently.`

## Tool & Library Notes

❌ `- **2026-07-31** — Be careful with tsx watch.`
✅ `- **2026-07-31** — tsx watch only restarts on imported-module changes;
   editing server/.env does nothing until a manual restart — config is read
   once at boot (platform/config.ts).`

## Recurring Errors & Fixes

❌ `- **2026-07-31** — Fixed the 422 bug again.`
✅ `- **2026-07-31** — "instanceof ZodError" returning false in route handlers:
   two zod instances exist at runtime (shared vs api). Fix: shape-match on
   name + issues array, as app.ts's error handler does. Third occurrence —
   candidate for promotion to server/AGENTS.md.`

## Session Notes

❌ `- **2026-07-31** — Worked on the server. Fixed some bugs. Good session.`
✅ `## 2026-07-31 — repo-intel incremental indexing
   Fixed hash-keyed re-index skipping renamed files (pipeline/incremental.ts).
   Verified against acme/payments-api clone: rename now triggers re-extract.
   Left open: whether file_edges rows of the old path should be purged (→ Open Questions).`

## Open Questions

❌ `- **2026-07-31** — Is the indexing fast enough?`
✅ `- **2026-07-31** — file_edges rows keep the OLD path after a rename until
   the next full index — is that stale data acceptable for blast-radius (L04),
   or does incremental need a purge step? (spotted in pipeline/incremental.ts)`

**Closing one.** Never annotate in place:

❌ `- **2026-08-02** (resolved) — Turned out incremental does need a purge step.`
   The question is now noise in a queue meant to hold open items.

✅ Delete the question. Then, if the answer is an insight on its own terms,
   write it where it belongs — here, `Codebase Patterns`:
   `- **2026-08-02** — Incremental indexing must purge file_edges rows for the
   old path on rename; without it blast-radius reports callers through a file
   that no longer exists (pipeline/incremental.ts).`
   If the answer is already captured by a code comment or a spec, delete the
   question and write nothing.
