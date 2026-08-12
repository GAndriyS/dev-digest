# Plan: Intent Layer (L03) — classify a PR's intent, show it, feed it to review

**Branch:** `L03-Subagents` · **Slices:** `backend`, `contracts`, `frontend`, `meta` (e2e lane fires but no `e2e/**` file changes) · **Spec:** none — `specs/` holds only `L01-run-cost-badge.md` and `L02-skills-lab.md`; the approved design in the delegation is the spec of record.

## Context read

Binding rules, each with its locator. Everything here was re-verified against the working tree — corrections to the delegation's locators are marked **CORRECTION**.

### Repo-level rules

- `AGENTS.md:16-19` — four independent packages, four lockfiles. `server/`, `client/` → pnpm; `reviewer-core/`, `e2e/` → npm. Root install does nothing.
- `AGENTS.md:20` — migrations are not applied on boot: `cd server && pnpm db:migrate`.
- `AGENTS.md:21-24` — `@devdigest/shared` exists twice; edit `server/src/vendor/shared` then mirror into `client/src/vendor/shared`.
- `AGENTS.md:25-26` — contracts are Zod-first; never `Schema.parse(req.body)` in a handler.
- `AGENTS.md:27-28` — DB-backed tests end in `.it.test.ts`.
- `AGENTS.md:35-36` — never `docker compose down -v`.
- `AGENTS.md:43` — when prose and CI disagree, CI wins.
- `AGENTS.md:53-55` — do not touch `server/clones/**`, applied `server/src/db/migrations/*.sql`, `**/src/vendor/ui/**`.
- `server/AGENTS.md:13-17` — module anatomy `routes/service/repository`; a new module needs `modules/index.ts` (not needed here: `reviews` is already registered).
- `server/AGENTS.md:18-19` — declare zod `params`/`body` on the route; throw `AppError` subclasses for anything with a status.
- `server/AGENTS.md:20-22` — reach adapters only through the DI container.
- `server/AGENTS.md:25-27` — unit lane `pnpm exec vitest run --exclude '**/*.it.test.ts'`; integration lane `pnpm exec vitest run .it.test`.
- `server/AGENTS.md:32-33` — two Zod instances at runtime; `instanceof ZodError` is unreliable; do not simplify the error handler.
- `client/AGENTS.md:13-15` — types come from `@devdigest/shared`; `src/vendor/shared` is a trimmed copy, not a symlink.
- `client/AGENTS.md:16-19` — all API access through `src/lib/api.ts`; hooks in `src/lib/hooks/*`; tests mock `fetch` globally.
- `client/AGENTS.md:20-24` — pages are thin; feature logic in `_components/<Name>/` with `Name.tsx`, `constants.ts`, `styles.ts`, `index.ts`, `Name.test.tsx`; UI primitives from `@devdigest/ui`; copy in `messages/<locale>/*.json`.
- `client/AGENTS.md:26-29` — placement enforced by `pnpm arch` (depcruise + `scripts/check-ui-conventions.mjs`).
- `reviewer-core/AGENTS.md:13-18` — the iron rule: no DB, no GitHub, no filesystem in reviewer-core.
- `reviewer-core/AGENTS.md:23-26` — injection defense is one shared rule (`INJECTION_GUARD`); never add keyword scanning; wrap external text with `wrapUntrusted()`.
- `reviewer-core/AGENTS.md:27-29` — empty prompt slots render no section; preserve that contract.

### Insights that change what this branch does

- `server/INSIGHTS.md:24-36` — anything under `server/clones/**` is attacker-controlled; the vector is the **symlink**, not `..`. `realpath` both sides and compare with the separator kept in the prefix. Degrades to harmless on Windows without Developer Mode, so the hole is invisible in local testing and live in CI.
- `server/INSIGHTS.md:47-57` — seeded PR #482 has `pr_files` rows with **no `patch` text**; use PR #483 (`BREAKING_PR_FILES` in `db/seed.ts`) for any offline check. `@@` headers must be exact.
- `server/INSIGHTS.md:59-66` — cut course features were removed *surgically*; read the removal commit first. `git show <commit> --stat` is the worklist. This plan is built on `15fa391^`.
- `server/INSIGHTS.md:67-76` — a lone justifying comment can be a removal marker; grep for unreferenced exports before writing your own helper.
- `INSIGHTS.md:44-51` — a cross-domain table belongs in the **downstream-most** schema file (not relevant here: `pr_intent` already lives in `schema/reviews.ts`).
- `INSIGHTS.md:91-96` — `drizzle-kit generate` stops on an **interactive prompt** when one diff both adds and drops a column. This change only adds columns, so one generate is safe.
- `INSIGHTS.md:121-132` — a depcruise rule must be verified by planting a violation; a clean run proves nothing.
- `client/INSIGHTS.md:91-103` — the first *runtime* (value) import from `@devdigest/shared` in the client used to break webpack; already fixed by `resolve.extensionAlias` in `next.config.mjs`. Still: prefer `import type` on the client.

### Routing (`.claude/skills/pr-self-review/routing.md`)

- Slice table `routing.md:65-74`: `client/**` → `frontend`; `client/src/vendor/shared/**` → `frontend` + `contracts`; `server/**` → `backend`; `server/src/vendor/shared/**` → `backend` + `contracts`; `reviewer-core/**` → `backend`; `.claude/**`, `*.md` → `meta`.
- Skill map `routing.md:100-106`: `frontend` → `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` (+ `react-testing-library` when a `*.test.tsx` is in the slice); `backend` → `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns` (+ `postgresql-table-design` when `server/src/db/**` is in the slice); any code slice → `zod` when a schema/contract file is in it.
- `routing.md:108-114` — `security` and `typescript-expert` are **never routed**; `/security-review` owns security.
- `routing.md:76-79` — the do-not-touch paths are tripwires: a diff that modifies one is itself a CRITICAL finding.

### CI lanes (`.github/workflows/**` — these win over prose)

- `server-unit.yml:55-73` — `pnpm install --frozen-lockfile`, then **`cd reviewer-core && npm ci`**, then `pnpm typecheck`, then `pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs`.
- `server-unit.yml:99-106` — same reviewer-core `npm ci` prerequisite, then `pnpm exec vitest run --exclude '**/*.it.test.ts'`.
- `server-integration.yml:56-65` — reviewer-core `npm ci`, then `pnpm exec vitest run .it.test` (Docker/testcontainers).
- `client.yml:45-60` — `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm exec depcruise src --config .dependency-cruiser.cjs`, `node scripts/check-ui-conventions.mjs`, `pnpm test`.
- `reviewer-core.yml:11-20,45-49` — triggers on `reviewer-core/**` **and `server/src/vendor/shared/**`**, so this branch fires it via the contract edit: `npm ci`, `npm run typecheck`, `npm test`.
- `e2e-web.yml:13-24` — triggers on `client/**` and `server/**`, so the browser lane fires without any `e2e/**` change. Flow 02 (`e2e/specs/02-repo-pulls-detail.flow.json`) opens the PR detail page and waits on `networkidle` — the new overview fetch must settle and must not error the page.
- `pr-gate.yml:18-21` — runs on every PR unconditionally; enforces the Insights section in the PR body.

### Reference implementation (removed in `15fa391`)

Read, and diffed against today's tree:

- `git show 15fa391^:server/src/modules/reviews/intent.ts` — `deriveIntent(container, repo, workspaceId, pull, diff, agent?, log?)`; used `assemblePrompt({system, diff: diff.raw, task: taskLine(pull, undefined), prDescription})` and `llm.completeStructured<Intent>({model, schema, schemaName:'Intent', messages, maxRetries})`, then `repo.upsertIntent`.
- `git show 15fa391^:server/src/modules/reviews/helpers.ts` — `flagOutOfScope` (CRITICAL→WARNING downgrade only, `security`/`bug` protected) and `taskLine(pull, intent)` rendering `wrapUntrusted('pr-intent', …)`.
- `git show 15fa391^:server/src/modules/reviews/constants.ts` — `INTENT_SYSTEM_PROMPT`, `INTENT_MAX_RETRIES = 1`, `DEFAULT_INTENT_PROVIDER/MODEL`.
- `git show 15fa391^:server/src/modules/reviews/routes.ts:123-128` — `GET /pulls/:id/intent`, which **404'd** when no intent existed and had **no zod `schema:`**.

### Surviving scaffolding — verified, all zero-consumer today

| Thing | Locator | Verified state |
|---|---|---|
| `pr_intent` table | `server/src/db/schema/reviews.ts:48-55` | 4 columns: `pr_id` PK, `intent`, `in_scope`, `out_of_scope` |
| Zod `Intent` | `server/src/vendor/shared/contracts/brief.ts:9-14` | field is `intent` (not `summary`) |
| `PrIntentRecord` | `server/src/vendor/shared/contracts/review-api.ts:59-61` | `Intent.extend({ pr_id })` |
| `upsertIntent` / `getIntent` | `server/src/modules/reviews/repository/pull.repo.ts:49-68` | facade at `repository.ts:129-136` |
| `review_intent` feature id | `platform.ts:14-20` (enum), `:52-57` (registry entry, default `openai` / `gpt-4.1`) | picker renders it |
| client mirror of the registry | `client/src/lib/feature-models.ts:21-27` | same default |
| `INJECTION_GUARD` names "derived intent/scope" | `reviewer-core/src/prompt.ts:15-28` | verified verbatim |
| "diff + intent" seam comments | `server/src/modules/reviews/run-executor.ts:40-41, 52-53, 62-64, 148-149, 326-327` | **CORRECTION** — the delegation said `:41,:52,:63`; there are five sites, not three |
| `taskLine(pull)` call site | `run-executor.ts:223` | verified |
| `loadDiff` pre-work | `run-executor.ts:96-99` | verified — the only pre-work today |
| `resolveFeatureModel` | `server/src/modules/settings/feature-models.ts:51-57` | verified |
| pure-adapter depcruise exemption | `server/.dependency-cruiser.cjs:25` | `^src/adapters/(git/diff-parser\|codeindex/extract\|astgrep/)` |
| hunk parsing | `server/src/adapters/git/diff-parser.ts:46-61` | builds `oldStart/oldLines/newStart/newLines` |
| grounding "never go silent" precedent | `reviewer-core/src/review/run.ts:199-202` | `emit('info', 'grounding dropped …')` |
| conventions cheap-model precedent | `server/src/modules/conventions/service.ts:110-170` | verified |

### CORRECTIONS the implementer must not re-derive

1. **`resolveLinkedIssue` is not reusable.** `server/src/adapters/github/octokit.ts:127-135` is a **`private`** method of the Octokit adapter, called only from `getPullRequest` (`octokit.ts:91`). The sanctioned path is the port method `getIssue(repo, n)` — declared at `server/src/vendor/shared/adapters.ts:164`, implemented at `octokit.ts:351`, mocked at `server/src/adapters/mocks.ts:233`. Reaching into the adapter class directly also trips `no-direct-adapter-clients` (`.dependency-cruiser.cjs:72-82`). The `#N` regex must be re-implemented in the reviews module; copy the shape from `octokit.ts:128` (`/(?:closes|fixes|resolves)?\s*#(\d+)/i`).
2. **`GitClient.readFile` is unsafe for attacker-influenced paths.** `server/src/adapters/git/simple-git.ts:129-131` is a bare `readFile(join(clonePathFor(repo), path))` with **no realpath guard** — precisely the hole `server/INSIGHTS.md:24-36` describes. Do **not** use it to read `*.md` paths lifted from a PR body.
3. **The clone-guard helpers are in another module and are off limits.** `isInsideRoot` lives at `server/src/modules/conventions/helpers.ts:52` and `readInsideClone` is a private method at `conventions/service.ts:212-216`. Rule `no-cross-module-internals` (`.dependency-cruiser.cjs:82-97`) allows a module to import only another module's `constants.ts` / `types.ts` / `index.ts`, or `modules/_shared/`. So the guard must be promoted to `src/modules/_shared/` (today that directory holds only `context.ts` and `schemas.ts`).
4. **`taskLine` has changed since the strip.** Today's `helpers.ts:82-92` dropped the `MAX_FINDINGS_PER_REVIEW` cap and gained "zero findings is a valid result". Add the `intent` parameter to **today's** text; do **not** revert to the `15fa391^` body.
5. **`assemblePrompt` exists and is usable, with two caveats.** `server/src/platform/prompt.ts:6-11` is a thin re-export of `@devdigest/reviewer-core`. `INJECTION_GUARD` is module-private (`reviewer-core/src/prompt.ts:15`) and **not exported**, so building the classifier messages by hand would lose the shared guard — that alone settles the "is it the right builder" question: use it. Caveats: it always emits a section titled `## Diff to review` wrapping `parts.diff` (`prompt.ts:120`), and truncates `prDescription` to `MAX_PR_DESCRIPTION_CHARS = 4000` (`prompt.ts:37,101`). Neither requires a reviewer-core change.
6. **`UnifiedDiff` / `DiffHunk` are plain TS interfaces**, not Zod — `server/src/vendor/shared/adapters.ts:174-188`. Nothing to mirror to the client for them.
7. **No route in `server/src/` declares a `response:` schema** (grepped: zero hits). Sibling routes declare `schema: { params: IdParams }` only. Do not invent a response-schema convention.
8. **`rate-limited like POST /repos/:id/conventions/extract` means no per-route limit.** `server/src/modules/conventions/routes.ts:32-35` carries no `config.rateLimit`; it inherits the global limit (which is disabled under `NODE_ENV=test`, `server/AGENTS.md:35`). The explicit-limit precedent is `POST /pulls/:id/review` (`reviews/routes.ts:29`: `max: 10, timeWindow: '1 minute'`). See **Open questions**.
9. **The client feature-model mirror has already drifted** for a *different* feature: `conventions` is `openrouter`/`deepseek/deepseek-v4-flash` on the server (`platform.ts:73-82`) and `openai`/`gpt-5.4` on the client (`client/src/lib/feature-models.ts:41-46`). Not this branch's bug; do not silently fix it (see **Open questions**).
10. **Both vendored contract copies are currently byte-identical** for `brief.ts` and `review-api.ts` — verified with `git diff --no-index` (empty). A one-sided edit will therefore be obvious in review.

## Decisions taken

No interview was run: the delegation states the requirements were interviewed with the human and are settled, and every remaining doubt was answerable by reading the repo. The decisions carried into this plan, as received:

- *human-answered* — **Link sources:** the linked GitHub issue (`#N`) **plus** repo-local `*.md` files referenced from the PR body. External http(s) URLs are **not fetched**; they are recorded in `sources[]` with `status: 'unavailable'` and lower the confidence. Never invent the content of an unreachable link.
- *human-answered* — **`risk_areas[]` is part of the contract** (the mock renders RISK AREAS chips).
- *human-answered* — **Chain after this plan:** `implementer` → `test-writer` → `architecture-reviewer` + `plan-verifier`.
- *human-answered* — the design body as delivered: inputs never include patch bodies; call sequence in `executeRuns` pre-work; no auto-re-derive on PR movement; migration 0015 column list; contract shape; `resolveFeatureModel(container, workspaceId, 'review_intent')` and **not** `platform/model-router.ts`; drop-unless-CRITICAL-or-security/bug filter; `IntentCard` composition and placement.
- *default-assumed* — the flash-class model for the `review_intent` registry default is **`openrouter` / `deepseek/deepseek-v4-flash`**, the exact value the `onboarding` (`platform.ts:44-50`) and `conventions` (`platform.ts:71-82`) entries already use. The design said "an OpenRouter flash-class model, following the `conventions` precedent" without naming one; inventing a different id would be a guess.
- *default-assumed* — every "unresolved but reversible" call listed under **Open questions** below.

## Constraints that bind this change

| Constraint | Answer for this change |
|---|---|
| **Does anything cross the wire?** | **Yes.** `Intent`, `IntentSource`, `PrIntentRecord`. Step 1 edits `server/src/vendor/shared/contracts/{brief,review-api}.ts` **and** `client/src/vendor/shared/contracts/{brief,review-api}.ts` in the *same* step. Splitting them across steps is what produces the `frontend`+`contracts` mirror-check finding at `routing.md:68`. |
| **Contracts Zod-first** | Yes. One `Intent` schema drives `llm.completeStructured({ schema })`, the DB round-trip and the HTTP response. Routes declare `schema: { params: IdParams }` (`reviews/routes.ts:129`); no `Schema.parse(req.body)` anywhere — neither new route takes a body. No `response:` schema (correction 7). |
| **Migrations** | **New migration required.** Add columns to `pr_intent` in `server/src/db/schema/reviews.ts:48-55`, then `cd server && pnpm db:generate` — never hand-write, never edit `src/db/migrations/*.sql`. Expect `0015_<drizzle-generated-name>.sql`; the slug is drizzle's, do not rename it. Additive-only, so no interactive prompt (`INSIGHTS.md:91-96`). Apply with `cd server && pnpm db:migrate` — it does not run on boot. |
| **Test lane** | Anything importing `test/helpers/pg.ts` is named `*.it.test.ts` (`server/AGENTS.md:25-27`). Pure helpers (hunk headers, source extraction, `flagOutOfScope`, `taskLine`) go in DB-free `*.test.ts`. Existing homes: `server/test/reviews-helpers.test.ts`, `server/test/reviews.it.test.ts`. |
| **Package manager per step** | `server/` and `client/` → **pnpm**; `reviewer-core/` → **npm**. Every server lane needs `cd reviewer-core && npm ci` first or `tsc` cascades TS2307 (`server-unit.yml:62-66`). |
| **`reviewer-core` never emits JS** | Respected — **no reviewer-core file is edited** by this plan. It is still type-checked by the server via the tsconfig alias and its own lane fires because `server/src/vendor/shared/**` is in `reviewer-core.yml:14`. |
| **Do-not-touch paths** | `server/clones/**` — read-only, and only through the guarded reader from Step 5; applied `src/db/migrations/*.sql` — untouched, a new file is generated; `**/src/vendor/ui/**` — untouched. `IntentCard` composes existing primitives (`Badge`, `SectionLabel`, `ConfidenceNum`) and adds none. |
| **Layering** | Enforced by `server/.dependency-cruiser.cjs`. Three rules bite here: `routes-through-service` (`:51-63`) — routes must not touch `db/` or a repo; `no-direct-adapter-clients` (`:72-82`) — GitHub reaches through `container.github()`, only `adapters/git/diff-parser` is exempt (`:25`); `no-cross-module-internals` (`:82-97`) — hence the `_shared` promotion in Step 5. `service-stays-http-agnostic` (`:64-71`) means `intent.ts` takes `workspaceId`/`prId`, never a `FastifyRequest`. |
| **Prompt-injection posture** | Every classifier input is untrusted and reaches the model only inside `<untrusted>` blocks; `assemblePrompt` appends `INJECTION_GUARD`, which already names "derived intent/scope" (`reviewer-core/src/prompt.ts:16-18`). No keyword scrubbing of untrusted text (`reviewer-core/AGENTS.md:23-26`). The stored intent re-enters the review prompt as data through `taskLine`, never as an instruction. |
| **Secrets / logging** | Never log secret values, patch bodies, or full file contents (`AGENTS.md:31-32`). Log provider/model, each source + status, component **sizes in chars**, `tokensIn→tokensOut`, cost. |
| **e2e** | No `e2e/**` file changes, but `e2e-web.yml` fires on `client/**`+`server/**`. Flow 02 must stay green: `GET /pulls/:id/intent` answering "no intent yet" must not surface as a page error. |

## Steps

Files marked **(new)** do not exist yet. Every path is repo-relative.

| # | Change | Files / seams | Slice | Skills the implementer applies | Verification |
|---|--------|---------------|-------|--------------------------------|--------------|
| 1 | **Contracts, both copies in one commit.** In `brief.ts` add `IntentSource = z.object({ type: z.enum(['description','linked_issue','repo_file']), ref: z.string().optional(), status: z.enum(['used','unavailable']) })` and extend `Intent` (`:9-14`) with `risk_areas: z.array(z.string())`, `confidence: z.number().min(0).max(1)`, `sources: z.array(IntentSource)`. In `review-api.ts` extend `PrIntentRecord` (`:59-61`) with `model: z.string().nullable()`, `head_sha: z.string().nullable()`, `created_at: z.string().nullable()`, `tokens_in`/`tokens_out` (`z.number().int().nullable()`), `cost_usd: z.number().nullable()`. Then copy the *same* edits into the client copies — the two files are byte-identical today, keep them so. Give the three new `Intent` fields defaults or make the persistence layer fill them, so a pre-existing `pr_intent` row still parses. | `server/src/vendor/shared/contracts/brief.ts`, `server/src/vendor/shared/contracts/review-api.ts`, `client/src/vendor/shared/contracts/brief.ts`, `client/src/vendor/shared/contracts/review-api.ts` | `contracts` + `backend` + `frontend` | `zod` | `cd reviewer-core && npm ci && npm run typecheck` · `cd server && pnpm typecheck` · `cd client && pnpm typecheck` · `git diff --no-index server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts` prints nothing (same for `review-api.ts`) |
| 2 | **Registry default → flash-class.** Change the `review_intent` entry (`platform.ts:52-57`) from `openai`/`gpt-4.1` to `openrouter`/`deepseek/deepseek-v4-flash`, with a comment in the shape of the `conventions` one at `platform.ts:71-77` saying why a cheap model is right here. Mirror the same two values into `client/src/lib/feature-models.ts:21-27`. Leave the `conventions` drift alone. | `server/src/vendor/shared/contracts/platform.ts`, `client/src/lib/feature-models.ts` | `contracts` + `backend` + `frontend` | `zod` (contract file), `frontend-ui-architecture` | `cd server && pnpm typecheck` · `cd client && pnpm typecheck` · grep both files: the `review_intent` provider/model pair is identical |
| 3 | **Schema + migration 0015.** Add to `prIntent` (`schema/reviews.ts:48-55`): `riskAreas: jsonb('risk_areas').$type<string[]>().notNull().default(sql\`'[]'::jsonb\`)`, `confidence: doublePrecision('confidence')`, `sources: jsonb('sources').$type<IntentSource[]>().notNull().default(sql\`'[]'::jsonb\`)`, `model: text('model')`, `headSha: text('head_sha')`, `tokensIn: integer('tokens_in')`, `tokensOut: integer('tokens_out')`, `costUsd: doublePrecision('cost_usd')`, `createdAt: now()`. Follow the file's own import style (`sql`, `now()` from `./_shared`). Then `pnpm db:generate` — **additive only**, one generate, no interactive prompt. Do not touch `0000`–`0014`. | `server/src/db/schema/reviews.ts`, **(new)** `server/src/db/migrations/0015_*.sql` + `meta/` snapshot | `backend` | `drizzle-orm-patterns`, `postgresql-table-design`, `onion-architecture` | `cd server && pnpm db:generate` produces exactly one new `.sql` · `pnpm db:migrate` applies clean · `pnpm typecheck` |
| 4 | **Repository: carry the new columns.** Extend `upsertIntent` (`pull.repo.ts:49-62`) to persist all fields including `model`/`headSha`/token/cost, and `getIntent` (`:64-68`) to return a record carrying them (row → snake_case DTO). Keep both behind the facade (`repository.ts:129-136`) — routes never see Drizzle. Handle the legacy row: a pre-0015 row has `risk_areas = '[]'`, `sources = '[]'`, null confidence. | `server/src/modules/reviews/repository/pull.repo.ts`, `server/src/modules/reviews/repository.ts` | `backend` | `onion-architecture`, `drizzle-orm-patterns` | `cd server && pnpm typecheck` · `pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs` |
| 5 | **Promote the clone guard to `_shared`.** Move `isInsideRoot` (`conventions/helpers.ts:52`) and a shared `readInsideClone(root, relPath, maxBytes)` (modelled on `conventions/service.ts:212-216`) into a new `modules/_shared/clone-fs.ts`; re-point `conventions/service.ts` (`:1,26,187-216`) and `conventions/helpers.test.ts` (`:6,110-131`) at it. Pure move, no behaviour change — the existing tests must pass unedited apart from the import. Rationale in a header comment citing `server/INSIGHTS.md:24-36`. **Do not** use `container.git.readFile` for these reads (correction 2). | `server/src/modules/conventions/{helpers.ts,service.ts,helpers.test.ts}`, **(new)** `server/src/modules/_shared/clone-fs.ts` | `backend` | `onion-architecture` | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (the moved `isInsideRoot` cases still pass) · `pnpm exec depcruise …` |
| 6 | **Pure input builders.** New `reviews/intent-inputs.ts`, side-effect free: (a) `hunkHeaderDigest(diff: UnifiedDiff)` → file list plus reconstructed `@@ -o,ol +n,nl @@` lines from `files[].hunks[]` (`adapters/git/diff-parser.ts:46-61` — importable directly, exempt at `.dependency-cruiser.cjs:25`), **never** `diff.raw` or any `+`/`-` line; (b) `linkedIssueNumber(body)` using the regex shape from `octokit.ts:128`; (c) `repoMarkdownRefs(body)` → relative `*.md` paths only, rejecting absolute paths, URLs and anything with a scheme, capped in count; (d) the caps as named constants. Empty/absent body → return empty sets, never throw. | **(new)** `server/src/modules/reviews/intent-inputs.ts` | `backend` | `onion-architecture` | `cd server && pnpm typecheck` · new unit tests in Step 6a below |
| 6a | **Unit-test the builders** against a fixture built from PR **#483** (`BREAKING_PR_FILES` in `server/src/db/seed.ts`) — not #482, which has no `patch` text (`server/INSIGHTS.md:47-57`). Assert the exact reconstructed header set (an exact set, not `toContain` on a band), and assert **no `+`/`-` content line** ever appears in the digest. | **(new)** `server/test/intent-inputs.test.ts` | `backend` | `onion-architecture` | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` |
| 7 | **Prompt + budget constants.** In `reviews/constants.ts` restore `INTENT_SYSTEM_PROMPT` from `15fa391^` (it already forbids directive scope entries and pins "security and correctness are ALWAYS in scope") and extend it with: how to fill `risk_areas` (nouns, areas, not directives), how `confidence` is calibrated (lower it when the description is empty or a source is `unavailable`), and the honesty rule — never invent the content of a source it could not read. Add `INTENT_MAX_RETRIES = 1`, the repo-file size/count caps, and the issue-body cap. | `server/src/modules/reviews/constants.ts` | `backend` | `onion-architecture` | `cd server && pnpm typecheck` |
| 8 | **The classifier service.** New `reviews/intent.ts`: `deriveIntent(container, repo, workspaceId, pull, repoRow, diff, log?)` → resolve the model with `resolveFeatureModel(container, workspaceId, 'review_intent')` (`settings/feature-models.ts:51-57`); collect sources — PR title+body, linked issue via `(await container.github()).getIssue(...)` (port at `vendor/shared/adapters.ts:164`, mocked at `adapters/mocks.ts:233`), repo-local `*.md` via the Step-5 guarded reader, external URLs recorded `unavailable` and never fetched; build messages with `assemblePrompt` from `platform/prompt.js` (`system: INTENT_SYSTEM_PROMPT`, `prDescription: pull.body`, `diff: hunkHeaderDigest(diff)` with a leading self-describing line saying it is a file list with hunk headers only, extra untrusted blocks through the `specs` slot); `llm.completeStructured<Intent>({ model, schema: Intent, schemaName: 'Intent', messages, maxRetries: INTENT_MAX_RETRIES })`; persist via `repo.upsertIntent` with `model`, `headSha: pull.headSha`, `tokensIn/tokensOut/costUsd` from `StructuredResult` (`vendor/shared/adapters.ts:72-77`). Plus `getIntent(repo, workspaceId, prId)` that 404s on an unknown PR (`NotFoundError`) but returns `null` for "no intent yet". Log provider/model, every source with its status, component sizes in chars, tokens and cost — never a patch body or a file's contents. | **(new)** `server/src/modules/reviews/intent.ts` | `backend` | `onion-architecture`, `zod` | `cd server && pnpm typecheck` · `pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs` (proves no direct adapter reach) |
| 9 | **Helpers: `taskLine` + `flagOutOfScope`.** Add an optional second parameter to **today's** `taskLine` (`helpers.ts:82-92`) rendering the intent as `wrapUntrusted('pr-intent', …)` — keep the current findings-count wording (correction 4) and carry over the `15fa391^` doc comment explaining why intent is data, not a directive. Add `flagOutOfScope(findings, intent)` with the **new** rule: drop an out-of-scope finding unless `severity === 'CRITICAL'` or `category` is `security`/`bug`; a survivor is marked in its `rationale`. Return the kept list **plus the dropped ones** so the caller can log each drop — the `reviewer-core/src/review/run.ts:199-202` "never go silent" precedent. No intent, or an empty `out_of_scope`, is a pass-through. | `server/src/modules/reviews/helpers.ts` | `backend` | `onion-architecture` | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` |
| 9a | **Unit-test the two helpers** in the existing `server/test/reviews-helpers.test.ts`: `taskLine` with and without intent (the untrusted wrapper is present; the base text is unchanged when intent is absent); `flagOutOfScope` across the four-way matrix (in/out of scope × CRITICAL/security/bug/soft), plus "every drop is reported". | `server/test/reviews-helpers.test.ts` | `backend` | `onion-architecture` | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` |
| 10 | **Wire the run path.** In `run-executor.executeRuns`, after the `loadDiff` step (`:96-99`) and before the agent loop: `await this.repo.getIntent(pull.id)`, and if absent `runLog.step('Deriving PR intent', () => deriveIntent(...), { kind: 'tool' })`. **No auto-re-derive when the PR head moves** — that is the user's button. An intent failure must **not** fail the run: log it and continue with `intent = undefined` (unlike `loadDiff`, which calls `failAll`). In `runOneAgent`: `taskLine(pull, intent) + rankNote` at `:223`, and `flagOutOfScope` applied to `outcome.review.findings` **before** `insertFindings` (`:258-272`), emitting one `runLog.info` per dropped finding. Update the now-true "diff + intent" comments at `:40-41, 52-53, 62-64, 148-149, 326-327`. The run log must show **two distinct model calls**. | `server/src/modules/reviews/run-executor.ts` | `backend` | `onion-architecture` | `cd server && pnpm typecheck` · `pnpm exec vitest run --exclude '**/*.it.test.ts'` · `pnpm exec depcruise …` |
| 11 | **Routes + service methods.** `ReviewService` gains `getIntent(workspaceId, prId)` and `deriveIntentNow(workspaceId, prId, log?)` (loads the pull + repo row + diff, then calls Step 8). In `reviews/routes.ts`, next to the other reads (`:128-132`): `app.get('/pulls/:id/intent', { schema: { params: IdParams } }, …)` → the record or `null` (**not** the old 404 at `15fa391^:routes.ts:123-128` — the overview card renders "not classified yet" and e2e flow 02 must not see an error), and `app.post('/pulls/:id/intent', { schema: { params: IdParams } }, …)` → force re-derive, returns the fresh record. No body on either; no `Schema.parse(req.body)`. See **Open questions** for the rate-limit decision. | `server/src/modules/reviews/routes.ts`, `server/src/modules/reviews/service.ts` | `backend` | `fastify-best-practices`, `onion-architecture`, `zod` | `cd server && pnpm typecheck` · `pnpm exec depcruise …` (proves `routes-through-service`) · `pnpm exec vitest run --exclude '**/*.it.test.ts'` (`server/test/routes-smoke.test.ts` picks up new routes) |
| 11a | **Integration test** in `server/test/reviews.it.test.ts` (or a new `*.it.test.ts` — the suffix is the lane switch): `GET` before any derive → `null`; `POST` with the mocked LLM (`adapters/mocks.ts`) → a persisted row carrying `model`, `head_sha`, tokens and cost; `GET` afterwards returns it; an unknown PR id → 404. | `server/test/reviews.it.test.ts` (or new `*.it.test.ts`) | `backend` | `onion-architecture`, `drizzle-orm-patterns` | `cd server && pnpm exec vitest run .it.test` (needs Docker) |
| 12 | **Client hooks.** In `client/src/lib/hooks/reviews.ts` add `usePrIntent(prId)` → `api.get<PrIntentRecord \| null>(\`/pulls/${prId}/intent\`)`, `enabled: !!prId`; and `useDeriveIntent(prId)` → `useMutation` POSTing the same path with `onSuccess: (data) => qc.setQueryData(['pr-intent', prId], data)` — the `useExtractConventions` precedent (`client/src/lib/hooks/conventions.ts:23-38`). Both take the PR **uuid**, never the URL's number. `fetch` only via `src/lib/api.ts`. The `hooks/index.ts` barrel already re-exports `./reviews`, so no barrel edit. | `client/src/lib/hooks/reviews.ts` | `frontend` | `react-best-practices`, `frontend-ui-architecture`, `next-best-practices` | `cd client && pnpm typecheck` · `pnpm exec depcruise src --config .dependency-cruiser.cjs && node scripts/check-ui-conventions.mjs` |
| 13 | **`IntentCard` + copy.** New `_components/IntentCard/{IntentCard.tsx,constants.ts,styles.ts,index.ts,IntentCard.test.tsx}` under `.../pulls/[number]/_components/OverviewTab/_components/`. Composition: `SectionLabel` "INTENT" with the re-classify button in its `right` slot (`vendor/ui/primitives/SectionLabel.tsx:4-11` — `right` exists); summary as a quote; IN SCOPE / OUT OF SCOPE columns; RISK AREAS as `Badge` — **not `Chip`**, which renders a `<button>` (`primitives/Chip.tsx:21`); `ConfidenceNum` takes the 0–1 float unchanged (`primitives/ConfidenceNum.tsx:3`); a sources footer marking `unavailable` entries; a stale `Badge` when `intent.head_sha !== pr.head_sha` (`head_sha` is on `PrMeta`, `contracts/platform.ts:168`). Styles as `CSSProperties` in `styles.ts` — this codebase does not use Tailwind (`INSIGHTS.md:55-67`). All copy in a new `client/messages/en/intent.json` (namespaces are auto-discovered by `client/src/i18n/request.ts:16-24`). Render it in `OverviewTab` **above** the description; `OverviewTab` must now receive `prId` and `headSha`, so update its props and the one call site at `.../pulls/[number]/page.tsx:150`. Handle the three states: no intent, deriving, error. | **(new)** `.../OverviewTab/_components/IntentCard/*`, **(new)** `client/messages/en/intent.json`, `.../OverviewTab/OverviewTab.tsx`, `.../pulls/[number]/page.tsx` | `frontend` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library` | `cd client && pnpm typecheck` · `pnpm exec depcruise src --config .dependency-cruiser.cjs && node scripts/check-ui-conventions.mjs` · `pnpm test` |
| 14 | **Insights sweep + PR body.** Run `/engineering-insights` — candidates seen while planning: the private-`resolveLinkedIssue` trap, the unguarded `GitClient.readFile`, and `no-cross-module-internals` forcing the `_shared` promotion. Recording nothing is legitimate; recording something already in `INSIGHTS.md` is not. The PR body ends with an **Insights** section either way (`AGENTS.md:45-48`). | `server/INSIGHTS.md` and/or `INSIGHTS.md` (append-only) | `meta` | — | `pr-gate.yml` checks the PR body; no local command |

## Contract & migration impact

**Crosses the wire — moves together in Step 1:**

| Canonical | Mirror |
|---|---|
| `server/src/vendor/shared/contracts/brief.ts` (`Intent`, new `IntentSource`) | `client/src/vendor/shared/contracts/brief.ts` |
| `server/src/vendor/shared/contracts/review-api.ts` (`PrIntentRecord`) | `client/src/vendor/shared/contracts/review-api.ts` |
| `server/src/vendor/shared/contracts/platform.ts` (`FEATURE_MODELS` → `review_intent` default) | `client/src/lib/feature-models.ts` — a **hand-written mirror**, not a vendored copy (it says so at `client/src/lib/feature-models.ts:3-11`) |

`UnifiedDiff`/`DiffHunk` are TS interfaces in `server/src/vendor/shared/adapters.ts:174-188`, server-side only — nothing to mirror.

**Migration:** one new file, generated not written. `pr_intent` gains `risk_areas jsonb NOT NULL DEFAULT '[]'`, `confidence double precision`, `sources jsonb NOT NULL DEFAULT '[]'`, `model text`, `head_sha text`, `tokens_in int`, `tokens_out int`, `cost_usd double precision`, `created_at timestamptz DEFAULT now()`. All nullable or defaulted, so existing rows survive. Cost lands here because the intent call happens once per PR *before* the per-agent fan-out and has nowhere else to go — `agent_runs` is per agent. Apply with `cd server && pnpm db:migrate`; it never runs on boot.

## Verification plan

Exact commands, in order. `cd` from the repo root each time — the shells do not share a working directory.

```bash
# 0. reviewer-core deps FIRST — every server lane depends on this (server-unit.yml:62-66)
cd reviewer-core && npm ci

# 1. reviewer-core lane (fires because server/src/vendor/shared/** changed — reviewer-core.yml:14)
cd reviewer-core && npm run typecheck && npm test

# 2. server typecheck + architecture boundaries (server-unit.yml:66-73)
cd server && pnpm install --frozen-lockfile
cd server && pnpm typecheck
cd server && pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs

# 3. migration: generate, inspect, apply (never edit an applied .sql)
cd server && pnpm db:generate      # expect exactly ONE new file under src/db/migrations/
cd server && pnpm db:migrate

# 4. server unit lane — DB-free (server-unit.yml:106)
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'

# 5. server integration lane — needs Docker (server-integration.yml:65)
cd server && pnpm exec vitest run .it.test

# 6. client lane (client.yml:47-60)
cd client && pnpm install --frozen-lockfile
cd client && pnpm typecheck
cd client && pnpm exec depcruise src --config .dependency-cruiser.cjs
cd client && node scripts/check-ui-conventions.mjs
cd client && pnpm test

# 7. contract mirror check — both must print nothing
git diff --no-index server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts
git diff --no-index server/src/vendor/shared/contracts/review-api.ts client/src/vendor/shared/contracts/review-api.ts
```

**Manual check, once, against a real provider** (this is the only way to see the two-call requirement): with an OpenRouter key configured, run a review on seeded PR **#483** — not #482, which has no patch text (`server/INSIGHTS.md:47-57`) — and confirm the run log shows a `Deriving PR intent` tool step *and* the agent's own call, that the intent row carries `model`/`head_sha`/tokens/cost, and that any dropped out-of-scope finding is logged rather than vanishing. Never `docker compose down -v` to reset (`AGENTS.md:35-36`).

**Do not run** `e2e/` locally as part of this plan (it needs the whole stack plus the `agent-browser` binary); `e2e-web.yml` runs it on the PR. Note that it fires on `client/**` + `server/**`, so flow 02 is a real gate on the overview-tab change.

## Out of scope / left to reviewers

- **Architecture review** — `architecture-reviewer`, after implementation: the `_shared` promotion, the `no-cross-module-internals` boundary, and whether `intent.ts` stayed HTTP-agnostic.
- **Security review** — `/security-review` owns it (`routing.md:110-112`); the `security` skill is deliberately never routed. The two things to point it at: the guarded clone read and the untrusted-block containment of issue/spec text.
- **Test authorship beyond the outlines above** — `test-writer`. Steps 6a, 9a and 11a name what must be covered and which lane each file belongs to; the suites themselves are that agent's work.
- **Plan-vs-diff comparison** — `plan-verifier`.
- **e2e flows** — no new flow is planned; if the reviewer wants one for the IntentCard it is a follow-up, not this branch.
- **Opening the PR** — `/pr-self-review`, invoked by hand (`AGENTS.md:49-52`). Its body must end with the Insights section.
- **`platform/model-router.ts`** — dead, zero call sites, and a standing `no-orphans` warning (`INSIGHTS.md:244-248`). Not wired, not deleted here.
- **The pre-existing `conventions` feature-model drift** between server and client registries — real, but not this branch's.

## Risks

| Risk | Cheapest early signal |
|---|---|
| A patch body leaks into the classifier prompt (the whole point of the redesign — the old implementation sent `diff.raw`). | The Step-6a unit test asserting no `+`/`-` content line survives `hunkHeaderDigest`. Write that test before the service. |
| A PR body path escapes the clone via symlink — invisible on Windows without Developer Mode, live in CI and on Linux (`server/INSIGHTS.md:24-36`). | Reuse the moved `isInsideRoot` **and** its existing test cases (`conventions/helpers.test.ts:110-131`) unchanged after the move. If they need editing, the move was not a pure move. |
| Contracts mirrored on one side only. | Step 7 of the verification plan — the two `git diff --no-index` calls, which print nothing today. |
| `no-cross-module-internals` bites late: `reviews` importing `conventions/helpers` typechecks fine and only depcruise complains. | Run `pnpm exec depcruise …` immediately after Step 5, not at the end. |
| `reviewer-core`'s deps are missing and `tsc` cascades TS2307 into dozens of unrelated errors (`server-unit.yml:57-66`). | Command 0. If the first server typecheck error mentions `openai` or `zod` module resolution, stop and run `npm ci` in `reviewer-core`. |
| The intent call fails (no key, provider 5xx) and takes the whole review down with it. | Step 10's explicit rule: intent failure logs and continues; only `loadDiff` calls `failAll`. Verify by running a review with the `review_intent` provider key removed. |
| `drizzle-kit generate` hangs on an interactive prompt (`INSIGHTS.md:91-96`). | Only if a column is dropped in the same diff. Step 3 is additive-only; if the generate ever prompts, a drop crept in. |
| The out-of-scope filter silently swallows a real finding — the failure mode this whole feature is judged on. | Every drop logged (Step 10) and the four-way matrix test (Step 9a). A drop that appears in the DB but not in the run log is the bug. |
| e2e flow 02 goes red because the overview tab now fetches. | `GET` answering `null` (not 404) plus a rendered empty state; check `e2e/specs/02-repo-pulls-detail.flow.json` still only waits on the PR title. |

## Open questions

Four. Each carries the default the implementer assumes without further input — none of them blocks a step.

1. **Rate limit on `POST /pulls/:id/intent`.** The design says "rate-limited like `POST /repos/:id/conventions/extract`", but that route carries **no** per-route limit (`conventions/routes.ts:32-35`) — it inherits the global one, which is disabled under `NODE_ENV=test`. The only explicit-limit precedent is `POST /pulls/:id/review` (`reviews/routes.ts:29`).
   **Default:** follow `/pulls/:id/review` and declare `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }` — this route spends money on an LLM call, which is the reason that limit exists. Say so in a comment so the deviation from the named precedent is visible.
2. **"Read the clone at head SHA" has no port method.** `GitClient` (`vendor/shared/adapters.ts:205-227`) exposes `readFile(repo, path)` against the working tree and `currentHead(repo)`, but nothing that reads a blob at an arbitrary ref. Reading at the PR head would mean adding a port method plus its mock — a wider change than this plan's shape.
   **Default:** read the clone working tree through the Step-5 guarded reader, and do **not** claim in `sources[]` that the content is at head. `head_sha` is still stored from `pull.headSha` (that column drives the stale badge, which is about the PR moving). If a reviewer wants true read-at-ref, it is a follow-up that touches the port, the adapter and `adapters/mocks.ts`.
3. **Where the non-diff untrusted blocks sit in the assembled prompt.** `assemblePrompt` offers one generic multi-block slot (`specs`, rendered as `<untrusted source="spec-N">` under `## Project context`, `reviewer-core/src/prompt.ts:93-96`) and hardcodes the `## Diff to review` heading for `parts.diff` (`:120`). Neither label is a perfect fit for "linked issue" and "hunk headers".
   **Default:** use the `specs` slot for the issue and repo-file blocks and pass the header digest as `diff`, prefixing each block with a self-describing first line ("Linked issue #N:", "File list with hunk headers only — no patch bodies"). `sources[]` carries the real provenance. Do **not** change reviewer-core to add a slot or export `INJECTION_GUARD`; the design says it should not need changing, and losing the shared guard would be a worse trade than an imprecise heading.
4. **Backfilling `created_at` for a pre-existing `pr_intent` row.** The column is new; any row written before this branch has `NULL` until it is re-derived.
   **Default:** leave it `NULL` and let the card render "unknown" rather than inventing a timestamp. In practice the table is empty — the feature has had zero consumers since `15fa391`.
