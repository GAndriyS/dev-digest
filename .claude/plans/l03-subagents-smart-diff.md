# Plan: Smart Diff (L03) — order a PR's files by risk, deterministically

## Context

Smart Diff — фіча L03: детерміноване сортування файлів PR за ризиком (`core` → `wiring` → `boilerplate`), щоб рев'юер спершу бачив бізнес-логіку, а не lock-файли. Жодного нового LLM-виклику: endpoint `GET /pulls/:id/smart-diff` комбінує вже імпортовані `pr_files` зі знахідками останнього рев'ю. План складено агентом `planner` (opus) на основі паралельної розвідки трьома Explore-агентами; вимога користувача — **максимальне розпаралелення виконання на сабагенти** (оркеструє головна сесія — жоден сабагент не може викликати інших).

**Ключовий факт, що робить паралелізм безпечним:** контрактний шар уже існує — `SmartDiff` у `server/src/vendor/shared/contracts/brief.ts:101-134` і клієнтська копія **байт-ідентичні** (md5 збігається), alias `SmartDiffResponse` у `review-api.ts:77-79` обох копій, client re-export у `client/src/lib/types.ts:35`, контрактний тест у `server/test/contracts.test.ts:118-129`, невикористаний i18n-блок `smartDiff` у `client/messages/en/prReview.json:60-69`. Серверна і клієнтська половини по-справжньому незалежні.

При старті імплементації цей план зберігається також у `.claude/plans/l03-subagents-smart-diff.md` (committed, house-конвенція) — `implementer` і `plan-verifier` отримують його **за назвою**.

**Branch:** `L03-Subagents` · **Slices:** `backend`, `frontend`, `e2e`, `meta` (**not** `contracts`) · **Spec:** none — `specs/` holds only L01/L02; the delegation's work plan and acceptance criteria are the spec of record.

## Context read

### Repo-level rules

- `AGENTS.md:16-19` — four independent packages, four lockfiles. `server/`, `client/` → pnpm; `reviewer-core/`, `e2e/` → npm.
- `AGENTS.md:21-24` — `@devdigest/shared` exists twice; edit server copy then mirror, never one side alone.
- `AGENTS.md:25-26` — contracts are Zod-first; never `Schema.parse(req.body)` in a handler.
- `AGENTS.md:27-28` — DB-backed tests end in `.it.test.ts`.
- `AGENTS.md:43` — when prose and CI disagree, CI wins.
- `AGENTS.md:45-48` — every PR body ends with an **Insights** section.
- `AGENTS.md:53-55` — do not touch `server/clones/**`, applied migrations, `**/src/vendor/ui/**`.
- `server/AGENTS.md:13-22` — module anatomy `routes/service/repository`; new module = plugin + one entry in `src/modules/index.ts`; zod `params` at the edge; adapters/shared repos only through the DI container.
- `client/AGENTS.md:13-29` — types from `@devdigest/shared`; all API access through `src/lib/api.ts`; feature code in `_components/<Name>/` (Name.tsx, constants.ts, styles.ts, index.ts, Name.test.tsx); no hardcoded copy — strings in `messages/<locale>/*.json`; placement machine-enforced (depcruise + check-ui-conventions.mjs).
- `e2e/AGENTS.md:14-25` — npm; deterministic JSON flows; `wait --url`/`wait --text` are the assertions; read-only seeded data, never a model call.

### Insights that change what this branch does

- `INSIGHTS.md:31-40` — parallel subagents split by **file ownership** work, but the seams *between* agents are not caught (both recorded cross-agent bugs typechecked cleanly). **Budget an integration pass against a live stack** → Barrier 1.5.
- `server/INSIGHTS.md:47-57` — seeded PR **#482** has `pr_files` with **no `patch` text**; PR **#483** (`BREAKING_PR_FILES`, `src/db/seed.ts:68`) has real diffs. Pin fixtures with **exact** line sets — `toContain` on a band catches nothing.
- `client/INSIGHTS.md:10-18` — UI kit `Severity` has an `INFO` member the contract lacks; type on the contract's `Severity`, cast at the `<SeverityBadge>` boundary.
- `INSIGHTS.md:55-67` — client styles exclusively with colocated `styles.ts` (`CSSProperties`); **no Tailwind**.
- `e2e/INSIGHTS.md` — stop `next dev` and `rm -rf client/.next` before a hermetic e2e run; `cd e2e && npm ci` once (e2e.sh doesn't install e2e's own deps).

### Routing (`.claude/skills/pr-self-review/routing.md`)

- Slices: `client/**` → `frontend`; `server/**` → `backend`; `e2e/**` → `e2e` (deterministic gates only, no skill review); `.claude/**`, `*.md` → `meta`. `**/src/vendor/shared/**` would add `contracts` — **this branch does not touch them**.
- Skill map: `frontend` → `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` (+ `react-testing-library` for `*.test.tsx`); `backend` → `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns` (`postgresql-table-design` NOT routed — no `server/src/db/**` in the slice); `zod` when a schema/contract file is in a slice.
- `security` and `typescript-expert` are never routed; `/security-review` owns security.

### CI lanes (`.github/workflows/**` — these win over prose)

- `server-unit.yml:55-110` — `pnpm install --frozen-lockfile` → **`cd reviewer-core && npm ci`** → `pnpm typecheck` → `pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs` → `pnpm exec vitest run --exclude '**/*.it.test.ts'`.
- `server-integration.yml:51-65` — same prerequisite → `pnpm exec vitest run .it.test` (Docker).
- `client.yml:47-60` — `pnpm typecheck` → `pnpm exec depcruise src` → `node scripts/check-ui-conventions.mjs` → `pnpm test`.
- `reviewer-core.yml:11-21` — fires on `reviewer-core/**` **and `server/src/vendor/shared/**`**. This branch touches neither → **it must not fire**. If it fires, a contract was edited.
- `e2e-web.yml:13-25` — fires on `client/**`, `server/**`, `e2e/**` — will fire. **Flow 05 (`e2e/specs/05-pr-diff.flow.json`) waits on `src/config.ts` in the diff viewer — hard gate on the Diff-tab change.**
- `pr-gate.yml:18-21` — unconditional; enforces the Insights section in the PR body.

### Verified state of the ground (why this plan is small)

| Thing | Locator | Verified |
|---|---|---|
| `SmartDiffRole`/`SmartDiffFile`/`SmartDiffGroup`/`ProposedSplit`/`SmartDiff` | `server/src/vendor/shared/contracts/brief.ts:101-134` | present, complete; `pseudocode_summary` is `.nullish()` |
| `SmartDiffResponse = SmartDiff` | `.../review-api.ts:77-79` (both copies) | present |
| Both vendored `brief.ts` copies | — | **byte-identical** (`git diff --no-index` empty) |
| Client re-export of `SmartDiff` | `client/src/lib/types.ts:35` | present |
| Contract round-trip test | `server/test/contracts.test.ts:118-129` | present, green |
| i18n block `smartDiff` (8 keys) | `client/messages/en/prReview.json:60-69` | present, **zero consumers** |
| `container.reviewRepo` → `getPrFiles(prId)` / `reviewsForPull(prId)` / `getPull(workspaceId, prId)` | `server/src/platform/container.ts:101`; `modules/reviews/repository.ts:40-42,64-67,32-34` | present; `reviewsForPull` newest-first, includes `kind:'summary'` |
| `pr_files` row shape | `server/src/db/schema/pulls.ts:36-45` | `{id, prId, path, additions, deletions, patch: text\|null}`; **no `workspace_id`** — scope through `pull_requests` |
| `findings` row shape | `server/src/db/schema/reviews.ts:52-70` | has `startLine`/`endLine`/`severity`/`dismissedAt` |
| Route template returning `null` not 404 | `server/src/modules/reviews/routes.ts:138-141` | `schema: { params: IdParams }` (`modules/_shared/schemas.ts:11`), `getContext` tenancy |
| Module registry | `server/src/modules/index.ts:26-37` (comment `:17-24` names a future "intent/smart-diff") | one import + one entry |
| `DiffViewer`/`FileCard`/`CodeLine`/`parsePatch` | `client/src/components/diff-viewer/` | `FileCard.tsx:35-37` `open` from size heuristic `AUTO_EXPAND_MAX_LINES` (`constants.ts:4`), **no external control** |
| diff-viewer barrel | `client/src/components/diff-viewer/index.ts` | exports **only** `DiffViewer` + `type DiffCommentApi` |
| new-side line convention | `.../diff-viewer/comments.ts:62-80` | `RIGHT` = `ln.newNo` |
| Collapse + scroll precedent | `.../ReviewRunAccordion/ReviewRunAccordion.tsx:47-56,75-137` | `targetNonce` re-fire trick; `role="button"`+keys; `scrollMarginTop:16` |
| Hook template `usePrIntent` | `client/src/lib/hooks/reviews.ts:69-75` | `import type` + `api.get<T>`, **no runtime Zod on the client** |
| Client test template | `.../IntentCard/IntentCard.test.tsx:1-45` | `vi.mock` hooks module, `NextIntlClientProvider`, typed fixture factory |
| Seeded fixtures | `src/db/seed.ts:216-221` (#482: 4 files, no patch, **no lock file**), `:68-120` (#483 with patches) | verified |

### CORRECTIONS the implementer must not re-derive

1. **`GET /pulls/:id` DOES persist `pr_files`** — `pulls/routes.ts:249-258` deletes and re-inserts before returning at `:284`; the persisted read at `:295` is only the offline fallback. The client always runs the detail endpoint before the Diff tab renders (`usePullDetail`, `page.tsx:39`). Residual staleness = GitHub-unreachable case = correct behaviour.
2. **The `contracts` slice is not touched.** No mirror step; `reviewer-core.yml` should not fire. A step-level *prohibition*, not an omission (Step 0).
3. **`modules/_shared/schemas.ts:14-27` exports `OkResponse` but zero routes use `response:` schemas** (`rg -n "response:" server/src` → no hits). Do **not** introduce one here.
4. **A lock file cannot be demonstrated on seeded data** (neither #482 nor #483 has one). Lock-file criterion is proved by unit test + demo video against a real imported PR. **Do not add a lock file to `src/db/seed.ts`** — `seed-diff.test.ts` pins #483 exactly, flows 02/04/05 assume the seeded shape.
5. **`no-component-internals-from-app`** (`client/.dependency-cruiser.cjs:76-90`) — route code may import only `diff-viewer/index.ts`; `parsePatch`/`Line`/`FileCard`/`CodeLine` are unreachable from `_components/`. The plan widens `DiffViewer`'s **props**, not the barrel (Step 5).

## Decisions taken

No interview was run — the delegation fixed the endpoint, contract, roles and UI behaviour; the rest was answerable from the repo or reversible.

- *human-answered* — Smart Diff makes **no** LLM call; deterministic combination of `pr_files` + latest review findings.
- *human-answered* — three roles; a lock file is **always** boilerplate and **always** starts collapsed; thresholds/patterns in a constants file; finding badges clickable, navigate to the line.
- *human-answered* — endpoint `GET /pulls/:id/smart-diff` returning the `SmartDiff` contract.
- *human-answered* — maximise parallelism across subagents; main session orchestrates; budget a cross-agent seam integration pass.
- *default-assumed* — **`finding_lines` = each finding's `startLine`, interpreted as new-side `newNo`** (per `comments.ts:62-80`), deduped, sorted ascending.
- *default-assumed* — **dismissed findings excluded** (`dismissedAt != null`); accepted kept.
- *default-assumed* — **latest `kind:'review'` row only** drives badges (filter like `pulls/routes.ts:144`); no union across runs.
  **Amended at Barrier 1.5 — the default was wrong; the rule is now EVERY `kind:'review'` review, dismissed still excluded.** Measured on the live stack: every PR in the database returned empty `finding_lines`, because a re-run against a changed or empty diff writes a newer review with zero findings and buries the one that found something. On seeded #482 the three newest reviews all report "The diff is empty" — the known patch-less-fixture defect (`server/INSIGHTS.md:47-57`) — while the only real findings sit in the 2026-08-03 seed review. The deciding evidence is that the repo already answered this exact question for the adjacent counter and wrote down why: `pulls/routes.ts:174-177` counts findings across every review *unlike* `score`, "so the number matches what the detail page shows once you click a counter through to it". Latest-only would have shipped a diff whose badges contradict the list counter the reader clicked. Dismissed stay excluded: `finding_lines` is an attention signal, the same split `ReviewRunAccordion.tsx:59` makes for its blocker count, not a tally like `RunHistory/helpers.ts`.
- *default-assumed* — **`pr_files` read as-is**, no GitHub refresh from this endpoint (see Correction 1).
- *default-assumed* — **new layered module `server/src/modules/smart-diff/`** (not `modules/pulls/` — grandfathered layerless, never append; not `modules/reviews/` — the run orchestrator). Data via `container.reviewRepo` — the sanctioned cross-module seam. No new repository, no new SQL.
- *default-assumed* — **`repo-intel.getFileRank` NOT used** — degrades to `[]` on unindexed repos → classification would differ between machines and live outside the constants file. Path patterns only.
- *default-assumed* — **`pseudocode_summary` omitted** (`.nullish()`; producing it needs a model call).
- *default-assumed* — **client keeps its no-runtime-Zod convention** (`import type` + `api.get<T>`); server route returns the service's object, no `response:` schema.
- *default-assumed* — **`FileCard` gains an external `defaultOpen` override** rather than a second wrapper collapsible (wrapper = doubled chevrons + inner heuristic still fighting the caller).

## Constraints that bind this change

| Constraint | Answer for this change |
|---|---|
| **Does anything cross the wire?** | Yes — and it is already there, byte-identical in both copies. **No contract file is edited.** If a step believes it needs a field → stop and escalate: a contract edit adds the `contracts` slice, fires `reviewer-core.yml`, and must edit both copies in one step. |
| **Contracts Zod-first** | `SmartDiff` is the single schema; route declares `schema: { params: IdParams }`, takes no body; no `response:` schema (Correction 3). |
| **Migrations** | **None.** No schema change. (For stale local DBs: `cd server && pnpm db:migrate` — never on boot.) |
| **Test lanes** | Pure classifier/builder → `server/test/smart-diff.test.ts` (unit). Route with real Postgres → `server/test/smart-diff.it.test.ts` (**suffix is the lane switch**; anything importing `test/helpers/pg.ts` must carry it). Client → colocated `*.test.tsx`. |
| **Package manager per step** | `server/`, `client/` → pnpm; `e2e/` → npm. Every server lane: `cd reviewer-core && npm ci` first, or `tsc` cascades TS2307. |
| **reviewer-core** | Untouched; its lane must not fire. |
| **Do-not-touch** | `server/clones/**` not read; migrations untouched; `**/src/vendor/ui/**` untouched — `SmartDiffViewer` **composes** kit primitives (`Badge`, `SectionLabel`, `Icon.Chevron*`, `Skeleton`, `EmptyState`) and hand-rolls its collapsible per `ReviewRunAccordion.tsx:75-137` (kit has **no** Collapsible/Accordion — do not add one). |
| **Layering (server)** | `routes-through-service` (`.dependency-cruiser.cjs:51-59`) — routes.ts imports no repository/db; `service-stays-http-agnostic` (`:62-70`) — service/helpers take `workspaceId`/`prId`, never `FastifyRequest`; `no-cross-module-internals` (`:82-97`) — never import `modules/reviews/repository.js`; use `container.reviewRepo` typed as `Container['reviewRepo']` (indexed-access trick, cf. `reviews/service.ts:32`). |
| **Layering (client)** | `no-component-internals-from-app` — only `diff-viewer/index.ts` importable from routes; `shared-does-not-know-features` — diff-viewer must not import `src/app/**`, so every Smart-Diff decision arrives as a **prop**; no `export *` in new barrels; no `fetch()` outside `lib/api.ts`. |
| **i18n** | Use the existing `prReview.smartDiff` keys (`prReview.json:60-69`); per-file badge copy inside shared `FileCard` → `shell.json` `diffViewer` block (`:33`) — the namespace that component already reads. |
| **e2e** | Read-only seeded data, no model call — satisfied by the deterministic endpoint. **Flow 05 is a live gate**: `FileCard` renders the path in its header open or closed — verify, don't assume. |
| **No new model call** | Made mechanical: the integration test asserts the mocked LLM provider's call count is unchanged across the request (Step 9). |

## Steps

Files marked **(new)** do not exist yet. **Owner** = the parallel wave agent (see §Parallel orchestration); an owner touches nothing in another owner's rows.

| # | Change | Files / seams | Slice | Owner | Skills | Verification |
|---|--------|---------------|-------|-------|--------|--------------|
| 0 | **Contracts are frozen** — do NOT edit `**/src/vendor/shared/**`. If a step needs a field: stop, escalate. | — (prohibition) | contracts | all | zod | `git diff --no-index` between both `brief.ts` copies prints nothing; `git status` shows no vendor/shared change |
| 1 | **Classifier constants** — module's published surface. `LOCK_FILES` (exact basenames: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lockb`, `npm-shrinkwrap.json`, `Cargo.lock`, `poetry.lock`, `Gemfile.lock`, `composer.lock`, `go.sum`, `Pipfile.lock`) checked **first, unconditionally**; `BOILERPLATE_PATTERNS` (`dist/`, `build/`, `out/`, `coverage/`, `.next/`, `node_modules/`, `__snapshots__/`, `*.snap`, `*.min.js`, `*.map`, `vendor/`, `generated/`, `*.generated.*`, `*.pb.go`); `WIRING_PATTERNS` (`package.json`, `tsconfig*.json`, `*.config.{ts,js,mjs,cjs}`, `.github/workflows/**`, `Dockerfile*`, `docker-compose*`, `*.env*`, `**/index.ts` barrels, root `*.yml`/`*.yaml`); `core` = default; `ROLE_ORDER = ['core','wiring','boilerplate'] as const`; `SPLIT_TOO_BIG_LINES = 400`, `SPLIT_MIN_FILES_PER_GROUP = 2`, `MAX_PROPOSED_SPLITS = 4`. Style per `repo-intel/constants.ts:14-40`; every threshold gets a one-line comment. | **(new)** `server/src/modules/smart-diff/constants.ts` | backend | A | onion-architecture | `cd server && pnpm typecheck` |
| 2 | **Pure classifier + builder** — side-effect free, no `Container`, no fastify import. `classifyPath(path): SmartDiffRole` (lock → boilerplate patterns → wiring patterns → `core` default); `buildSmartDiff(files, findingsByPath): SmartDiff` — groups in `ROLE_ORDER` (empty groups still emitted), within-group order: findings-count desc → `additions+deletions` desc → `path` asc (total order, no ties); `finding_lines` deduped sorted; `pseudocode_summary` omitted; `proposeSplits` — `total_lines` = Σ(add+del) over all files, `too_big = total > SPLIT_TOO_BIG_LINES` (strict); when too big: group non-boilerplate by first two path segments, drop groups < `SPLIT_MIN_FILES_PER_GROUP`, cap `MAX_PROPOSED_SPLITS`, + one "chore" split for boilerplate; else `[]`. `patch: null` classifies normally (path-only). | **(new)** `server/src/modules/smart-diff/helpers.ts` | backend | A | onion-architecture | typecheck · depcruise |
| 3 | **Service** — `SmartDiffService(container)` holding `private repo: Container['reviewRepo']`. `getSmartDiff(workspaceId, prId)`: `getPull` → `NotFoundError` when absent (the only tenancy gate — `pr_files` has no workspace_id); `getPrFiles`; `reviewsForPull` → **first `kind:'review'`** entry → findings, drop `dismissedAt != null`, group `file → startLine[]`; hand to `buildSmartDiff`. No review yet → `finding_lines: []` everywhere, ordering still works. No LLM, no GitHub. | **(new)** `server/src/modules/smart-diff/service.ts` | backend | A | onion-architecture, drizzle-orm-patterns | typecheck · depcruise (run immediately after this step) |
| 4 | **Route + registration** — shape of `reviews/routes.ts:138-141` verbatim: `app.get('/pulls/:id/smart-diff', { schema: { params: IdParams } }, async (req) => { const { workspaceId } = await getContext(container, req); return service.getSmartDiff(workspaceId, req.params.id); })`. No body, no `response:` schema, no per-route rate limit (spends no money). One import + one entry in `modules/index.ts`. | **(new)** `server/src/modules/smart-diff/routes.ts`, `server/src/modules/index.ts` | backend | A | fastify-best-practices, onion-architecture, zod | typecheck · depcruise · unit lane (`routes-smoke.test.ts` surfaces registration errors) |
| 5 | **Widen diff-viewer props, not its barrel.** `DiffViewer` gains `fileMeta?: Record<string, { defaultOpen?: boolean; findingLines?: number[] }>`, forwards per-path to `FileCard`. `FileCard` gains `defaultOpen`/`findingLines`: `open` initialiser becomes `defaultOpen ?? (size <= AUTO_EXPAND_MAX_LINES)` (heuristic stays the default — existing call sites unchanged); with `findingLines`, header renders a **clickable** badge (`role="button"`, `tabIndex`, Enter/Space per `ReviewRunAccordion.tsx:75-82`) that opens the card and scrolls to a finding line, cycling on repeat clicks via ref-held index + nonce (`targetNonce` trick, `:47-56`). Scroll is **two-phase** (body is conditionally rendered — open first, scroll in an effect after the body exists). `CodeLine` gains `highlighted?: boolean`, renders `data-line={ln.newNo}` + `scrollMarginTop`. Styles in folder `styles.ts`; badge copy in `shell.json` `diffViewer` block. **Do not** widen `index.ts`; **do not** import `src/app/**`. | `client/src/components/diff-viewer/{DiffViewer,FileCard,CodeLine}/*.tsx`, `styles.ts`, `client/messages/en/shell.json` | frontend | B | frontend-ui-architecture, react-best-practices, next-best-practices | `cd client && pnpm typecheck` · depcruise · check-ui-conventions |
| 6 | **Data hook** — in `client/src/lib/hooks/reviews.ts` next to `usePrIntent`: `usePrSmartDiff(prId)` → `useQuery({ queryKey: ['pr-smart-diff', prId], queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`), enabled: !!prId })`. `import type { SmartDiff }` — no runtime Zod, no fetch outside `lib/api.ts`. Hooks barrel already `export *`s this module — no barrel edit. | `client/src/lib/hooks/reviews.ts` | frontend | B | react-best-practices, next-best-practices, frontend-ui-architecture | typecheck · check-ui-conventions |
| 7 | **`SmartDiffViewer`** — route-local five-file folder. Props `{ prId, files, commenting }`. `usePrSmartDiff` → `Skeleton` loading; **on error/empty → fall back to plain `<DiffViewer files commenting>`** (the tab must never lose the diff because ranking failed). On success: `SectionLabel` `t("smartDiff.groupedByRole")`; one hand-rolled collapsible per group in server order, header = role label + `filesCount` + `findingLines` (existing keys, `useTranslations("prReview")`). `constants.ts`: `DEFAULT_OPEN_BY_ROLE = { core: null, wiring: null, boilerplate: false }` (`null` = leave FileCard's size heuristic alone). `helpers.ts`: map `SmartDiffFile.path` → `PrFile`, build `fileMeta`; **any `PrFile` the response missed goes into an "ungrouped" tail** — no file may silently vanish. `too_big` → banner from `largeTitle`/`largeBody` + proposed splits. Styles = `CSSProperties`; `index.ts` named exports only. | **(new)** `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/{SmartDiffViewer.tsx,constants.ts,helpers.ts,styles.ts,index.ts}` | frontend | B | frontend-ui-architecture, react-best-practices, next-best-practices | typecheck · depcruise (run immediately after this step) · check-ui-conventions |
| 8 | **Mount + refresh after a run** — `DiffTab.tsx` renders `<SmartDiffViewer>` in place of `<DiffViewer>` (keep header + comments toggle). `page.tsx`: add `qc.invalidateQueries({ queryKey: ['pr-smart-diff', prId] })` to the existing run-settled handler (`page.tsx:57-62`) — makes "badges appear after Run Review" true without a reload. | `.../DiffTab/DiffTab.tsx`, `.../page.tsx` | frontend | B | react-best-practices, next-best-practices, frontend-ui-architecture | typecheck · depcruise · `pnpm test` |
| 9 | **Server tests.** `smart-diff.test.ts` (unit, template `pulls-status.test.ts`): every `LOCK_FILES` entry → boilerplate, incl. nested (`apps/web/pnpm-lock.yaml`) and **one that also matches a wiring pattern** (lock check runs first); boilerplate/wiring/core pattern cases; `patch: null` classifies; group order + empty groups emitted; within-group order pinned with an **exact array**; `finding_lines` = exact sorted deduped startLine set, dismissed excluded; split boundary at exactly `400` (not big) / `401` (big). `smart-diff.it.test.ts` (integration, template `reviews-intent.it.test.ts`): seeded PR with lock file + review with findings → grouped shape, lock in boilerplate; no review → 200 with empty finding_lines; unknown uuid → 404; malformed id → 422; **mock LLM provider call count is 0 across the request**. | **(new)** `server/test/smart-diff.test.ts`, `server/test/smart-diff.it.test.ts` | backend | C (test-writer) | onion-architecture | unit lane · integration lane (Docker) |
| 10 | **Client tests.** `SmartDiffViewer.test.tsx` per `IntentCard.test.tsx` (vi.mock hooks, NextIntlClientProvider with **both** `prReview` and `shell` namespaces, typed fixture factory, `afterEach(cleanup)`): groups in contract order, core first; boilerplate collapsed on mount (file list not in DOM until header activated); header keyboard-operable (Enter + Space); badge shows right count, activating opens FileCard and reveals the `data-line` row; small lock file still closed (defaultOpen beats size heuristic); query error → plain-diff fallback rendering every path; `too_big` banner only when flagged. | **(new)** `.../SmartDiffViewer/SmartDiffViewer.test.tsx` | frontend | D (test-writer) | react-testing-library, react-best-practices | `cd client && pnpm test` |
| 11 | **e2e flow** — `09-pr-smart-diff.flow.json` on seeded **#482** (read-only, no model call): open app → `/pulls` → click "Add rate limiting to public API endpoints" → `wait --url /pulls/482` → `wait --load networkidle` → click "Files changed" → `wait --url tab=diff` → `wait --text` a role group label → `wait --text src/middleware/ratelimit.ts` (core file). Add coverage row to `e2e/README.md:100`. **Do not** modify flows 01–08 or `seed.ts`. (#482 has no lock file/patch text — this proves grouping+ordering; collapse and lock-file are owned by Steps 9–10 and the demo video.) | **(new)** `e2e/specs/09-pr-smart-diff.flow.json`, `e2e/README.md` | e2e | E | — (deterministic gates only) | `cd e2e && npm ci` once, then `./scripts/e2e.sh` (stop `next dev`, `rm -rf client/.next` first) |
| 12 | **Insights sweep + PR body** — run `/engineering-insights`. Candidates: prop-widening forced by `no-component-internals-from-app`; `GET /pulls/:id` *does* persist `pr_files` (contradicts a plausible reading); no seeded PR has a lock file → lock behaviour not e2e-testable. Recording nothing is legitimate. PR body ends with **Insights** section either way. | `INSIGHTS.md` files (append-only) | meta | main session | — | `pr-gate.yml` checks the PR body |

## Parallel orchestration

What makes parallelism safe here: **the contract both halves speak already exists, byte-identical, with a passing round-trip test** — there is no wire-crossing edit to serialise on.

```
                ┌─ Wave 1 ────────────────────────────────────┐
 (no Wave 0 —   │  implementer A  server   Steps 1-4          │
  contracts     │  implementer B  client   Steps 5-8          │  concurrent
  already exist)│  implementer E  e2e      Step 11            │
                └──────────────────┬──────────────────────────┘
                      Barrier 1   — main session runs every lane
                      Barrier 1.5 — INTEGRATION PASS (main session, live stack)
                ┌─ Wave 2 ────────────────────────────────────┐
                │  test-writer C  server tests   Step 9       │  concurrent
                │  test-writer D  client tests   Step 10      │
                └──────────────────┬──────────────────────────┘
                      Barrier 2   — main session commits
                ┌─ Wave 3 (read-only) ────────────────────────┐
                │  architecture-reviewer  ∥  plan-verifier    │  concurrent
                └──────────────────┬──────────────────────────┘
                      Wave 4  doc-writer
                      → /pr-self-review → /code-review · /security-review → PR
                      → human records the demo video
```

**File ownership — disjoint by construction** (`INSIGHTS.md:31-40`: split by file, not concern):

| Agent | Owns (may write) | Must not touch |
|---|---|---|
| **A** (implementer, server) | `server/src/modules/smart-diff/**`, `server/src/modules/index.ts` | `client/`, `e2e/`, `server/test/`, any `vendor/shared` file |
| **B** (implementer, client) | `client/src/components/diff-viewer/**`, `client/src/lib/hooks/reviews.ts`, `client/messages/en/shell.json`, `.../_components/{SmartDiffViewer/**,DiffTab/DiffTab.tsx}`, `.../page.tsx` | `server/`, `e2e/`, `client/src/vendor/**`, `prReview.json` (keys exist — **read, don't rewrite**) |
| **E** (implementer, e2e) | `e2e/specs/09-pr-smart-diff.flow.json`, `e2e/README.md` | flows 01–08, `seed.ts`, everything else |
| **C** (test-writer, server) | `server/test/smart-diff.test.ts`, `server/test/smart-diff.it.test.ts` | `server/src/**` (production incl. `mocks.ts`), `client/` |
| **D** (test-writer, client) | `.../SmartDiffViewer/SmartDiffViewer.test.tsx` | all non-test client files, `server/` |

**The three seams file ownership does not protect** (each pinned by name so A and B can be independently correct):

1. **Route path** — exactly `GET /pulls/:id/smart-diff`. A registers; B fetches. A mismatch typechecks on both sides and 404s at runtime.
2. **Response shape** — exactly `SmartDiff` from `@devdigest/shared`. Neither agent defines a local "matching" interface.
3. **`finding_lines` semantics** — new-side line numbers (`newNo`), not counts, not ids, not old-side. A produces from `findings.startLine`; B matches against `Line.newNo`. Invisible to both typecheckers — the strongest argument for Barrier 1.5.

**Barrier 1** (after A/B/E report): run every lane in §Verification. Nothing proceeds while a lane is red.

**Barrier 1.5 — the integration pass. Main session, live stack, not skippable.** Boot `./scripts/dev.sh`, then:
- `curl -s 127.0.0.1:3001/pulls/<uuid>/smart-diff | jq` on seeded #482 — 200, three groups in order, `finding_lines` matches the seeded review's line numbers (compare against the DB before trusting any UI). Use `127.0.0.1`, never `localhost` (`INSIGHTS.md:158-169`).
- Load `/repos/<id>/pulls/482?tab=diff` — groups render, badge count matches the JSON, badge click lands on the highlighted line. Drive with the e2e `agent-browser` binary, not the Browser pane (`client/INSIGHTS.md:58-65`).
- API log shows **no** LLM call for the request.

Placed *before* Wave 2 deliberately: a seam bug found here changes what the tests should assert; writing tests first would bake the bug in as the expectation.

**Barrier 2** — commit before the read-only reviewers run (test-writer writes; reviewers read; no subagent can commit — the main session does).

**Wave 3** — `architecture-reviewer` ∥ `plan-verifier` (no shared files, different questions). Pass `plan-verifier` this plan **by name** + the implementation reports.

**Not parallelised, on purpose:** the migration step (none exists), the lane runs at Barrier 1, and Barrier 1.5.

## Contract & migration impact

**Crosses the wire:** yes — and **nothing moves**. All `SmartDiff` schemas + `SmartDiffResponse` exist in both vendored copies, byte-identical; client re-export in place. **No mirror step; no contract file may be edited** (Step 0 — stated as a prohibition so its absence from the diff is a decision, not an oversight). If `reviewer-core.yml` fires on the PR, a contract was edited — go back to Step 0.

**Migrations:** none. `pr_files`, `reviews`, `findings` already hold everything the endpoint reads.

## Verification plan

```bash
# 0. reviewer-core deps FIRST — every server lane depends on this (server-unit.yml:57-66)
cd reviewer-core && npm ci

# 1. server typecheck + boundaries (server-unit.yml:66-73)
cd server && pnpm install --frozen-lockfile
cd server && pnpm typecheck
cd server && pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs

# 2. server unit lane — DB-free (server-unit.yml:110)
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'

# 3. server integration lane — needs Docker (server-integration.yml:65)
cd server && pnpm exec vitest run .it.test

# 4. client lane (client.yml:47-60)
cd client && pnpm install --frozen-lockfile
cd client && pnpm typecheck
cd client && pnpm exec depcruise src --config .dependency-cruiser.cjs
cd client && node scripts/check-ui-conventions.mjs
cd client && pnpm test

# 5. contracts really did not move — all three must print nothing
git diff --no-index server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts
git diff --no-index server/src/vendor/shared/contracts/review-api.ts client/src/vendor/shared/contracts/review-api.ts
git status --porcelain -- '*/src/vendor/shared/**'

# 6. browser flows — flow 05 is the regression gate on the Diff tab
#    Stop any `next dev` first (shared .next cache poisons both stacks — e2e/INSIGHTS.md)
rm -rf client/.next
cd e2e && npm ci
./scripts/e2e.sh          # runs 01-09; 05 and 09 matter here
```

**Manual check, once (Barrier 1.5).** The only place "no new model call" and "click navigates to the line" are observed end-to-end. Never `docker compose down -v` (drops `devdigest_pgdata`).

**Not run:** `pnpm db:migrate` (no migration), reviewer-core's lane (should not fire).

## Out of scope / left to reviewers

- **Demo video** — the human records it against a **real imported PR with a lock file** (no seeded fixture has one). Must show: core on top, lock file collapsed, badges after Run Review, badge click landing on the line.
- **Architecture review** — `architecture-reviewer`: module layering, `container.reviewRepo` vs own repository, whether the FileCard prop-widening is the smallest change that works.
- **Security review** — `/security-review`; point it at one thing: the endpoint's tenancy gate is `getPull(workspaceId, prId)` and nothing else (`pr_files` has no `workspace_id`).
- **Bug hunting** — `/code-review`.
- **Plan-vs-diff conformance** — `plan-verifier`, given this plan by name + the three implementation reports.
- **Docs** — `doc-writer`, after Wave 3, before `/pr-self-review`.
- **Opening the PR** — `/pr-self-review`, invoked by hand; body ends with Insights.
- **Deliberately not built:** `pseudocode_summary`, repo-intel rank signal, a Smart-Diff on/off toggle, Findings-tab → diff deep-linking, any `seed.ts` change.

## Risks

| Risk | Cheapest early signal |
|---|---|
| Client and server disagree on `finding_lines` semantics — both typecheck; badges point at wrong lines (exact shape of the recorded cross-agent bug). | Barrier 1.5: `curl` #482, compare a `finding_lines` entry against the seeded finding's `start_line` in the DB, before trusting any UI. |
| Flow 05 goes red (waits on `src/config.ts` now inside a `wiring` group). | `FileCard` renders the path in its header open or closed — run flow 05 first, alone, at Barrier 1. |
| Diff tab silently loses files (a `PrFile` absent from the response never renders). | Step 7's ungrouped-tail rule + Step 10's every-path-in-DOM test; compare `pr.files_count` vs rendered count at Barrier 1.5. |
| Server route trips `no-cross-module-internals` (typechecks fine; only depcruise complains, at the end). | Run depcruise immediately after Step 3, not after Step 4. |
| Client imports diff-viewer internals and trips `no-component-internals-from-app`. | Run depcruise right after Step 7. If the barrel "needs" widening, the design went wrong — back to props. |
| Missing reviewer-core deps → TS2307 cascade. | Command 0. First typecheck error naming `openai`/`zod` resolution → `npm ci` in reviewer-core. |
| DB-backed test named `smart-diff.test.ts` lands in the unit lane. | Grep new test files for `test/helpers/pg.ts` import before running — the suffix is the switch. |
| Classifier overfit to one demo PR. | Every threshold/pattern in `constants.ts` + a named unit test per rule; behaviour change without a `constants.ts` change is the tell. |
| Two implementers edit the same file; one silently overwrites. | Ownership table is disjoint by path; at Barrier 1 confirm no file appears in two agents' Files-touched reports. |
| e2e poisons the dev stack via shared `client/.next`. | `rm -rf client/.next` + stop `next dev` first; tell: browser network shows `:3101`. |

## Open questions

Each with the default the implementer assumes; none blocks a step.

1. **`SPLIT_TOO_BIG_LINES` value.** **Default:** `400`, strict `>`, pinned by boundary tests at 400/401 — changing it is a one-line edit with a failing test to point at.
2. **Badge cycles through finding lines or always jumps to the first?** **Default:** cycles (ref-held index + nonce). Fallback to first-only is a two-line change.
3. **Severity-coloured badge?** **Default:** plain count badge. `SmartDiffFile` carries no severity — colouring would need a contract change, which Step 0 forbids on this branch.
4. **Is the e2e flow worth its maintenance cost** (proves grouping/ordering only)? **Default:** build it — ~10 lines of JSON, zero review cost, fully unwindable.
