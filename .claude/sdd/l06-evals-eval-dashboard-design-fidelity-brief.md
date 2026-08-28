# Handoff brief — l06-evals-eval-dashboard-design-fidelity
Spec: specs/SPEC-05-eval-pipeline-26-08-2026.md (approved, revised 2026-08-26) · Plan: .claude/plans/l06-evals-eval-dashboard-design-fidelity.md · Branch: L06-Evals · Base: 4765abcc8fdd446942c6e0da17d984b9d0c30b6d

## Binding rules (locators, not prose)

- `AGENTS.md:42-45` — `@devdigest/shared` exists twice; the wire addition of
  AC-41 edits `server/src/vendor/shared/contracts/eval-ci.ts` **and**
  `client/src/vendor/shared/contracts/eval-ci.ts` in one step, never one alone.
- `AGENTS.md:46-47` — Zod-first contracts: `GET /eval/overview` already serves
  its response straight off `EvalDashboardOverview` (`server/src/modules/eval/routes.ts:132-139`),
  so adding `trend` to the schema is the whole of the wire change; no handler-side
  parsing is added.
- `AGENTS.md:48-49` — DB-backed tests end in `*.it.test.ts`; the new overview
  coverage goes into the existing `server/test/eval.it.test.ts`.
- `AGENTS.md:16-27` — `client/` and `server/` are pnpm; the root `package.json`
  is scripts-only and already carries `verify:l06`.
- `AGENTS.md:81-83` — do-not-touch: `**/src/vendor/ui/**`. Already resolved:
  the sidebar row AC-26 asks for is in `client/src/vendor/ui/nav.ts:65`. No step
  touches a vendored file; no `Vendor-update:` line needed in the PR body.
- `client/AGENTS.md:21` — pages are thin; feature logic lives in a colocated
  `_components/<Name>/` with `Name.tsx`, `constants.ts`, `styles.ts`, `index.ts`,
  `Name.test.tsx`.
- `client/AGENTS.md:24` — UI strings live in `messages/<locale>/*.json`; only
  `en` exists. Every new label in AC-36…AC-52 lands in `client/messages/en/eval.json`.
- `client/AGENTS.md:26-29` — placement is machine-enforced (`pnpm arch`). A
  nested `_components/<X>/` importing `../../helpers` / `../../constants` is an
  established, legal pattern (precedent: `pulls/_components/PRRow/PRRow.tsx:11`).
- `server/AGENTS.md:20-22` — adapters only through the DI container; the
  dashboard read model takes a `Container`, never a `FastifyRequest`
  (`server/src/modules/eval/dashboard.ts:17-33`).
- `client/INSIGHTS.md` 2026-08-20 — logic moved into `lib/hooks/*` drops out of
  every route suite (they `vi.mock` the module wholesale); write the hook-level
  test in the same change.
- `client/INSIGHTS.md` 2026-08-20 (Recurring errors) — a NEW export on a mocked
  hook module is a hard vitest mock error for every suite whose factory omits
  it. `EvalOverview.test.tsx:17-25` mocks `@/lib/hooks/eval` with a plain
  factory and needs the new hook stubbed in the same step that consumes it.
- `client/INSIGHTS.md` 2026-08-26 — the app's `QueryClient` fires a global
  `mutationCache.onError` toast for every mutation; a component rendering its
  own failure copy opts out with `meta: { ownErrorToast: true }` and then owns
  every error branch. The fan-out surfaces per-agent failures itself (AC-51).
- `INSIGHTS.md` 2026-08-04 — parallel subagents split by FILE OWNERSHIP, not by
  concern; the seams between them are covered by the dedicated integration step.
- `INSIGHTS.md` 2026-08-26 — clicking the finished feature caught two defects a
  full review chain missed; a manual click-through stage follows the reviews.
- `INSIGHTS.md` 2026-08-18 — `.claude/settings.json` denies `Edit` on
  `**/src/vendor/ui/**` to agents and the main session. This plan needs no such
  edit.
- `.claude/skills/pr-self-review/routing.md:65-75` — slice table: `client/**` →
  `frontend`, `client/src/vendor/shared/**` → `frontend` + `contracts`,
  `server/**` → `backend`, `server/src/vendor/shared/**` → `backend` +
  `contracts`, `*.md`/`docs/` → `meta`.
- `scripts/verify.mjs:106-133` — lane contents. `frontend` = client typecheck +
  depcruise + `check-ui-conventions` + vitest; `backend` = server typecheck +
  depcruise + unit vitest; `integration` = `.it.test` vitest (Docker + migrated DB).
- Current page: `client/src/app/eval/_components/EvalOverview/EvalOverview.tsx:71-115`
  (card grid), `:126-176` (table, agent name as the link), `helpers.ts:13`
  (`dateStyle: "medium"`).
- Read model: `server/src/modules/eval/dashboard.ts:221-256` (`getEvalOverview`),
  `:335-338` (the `traces_total > 0` trend filter AC-40 must reuse),
  `constants.ts:16` (`BATCH_TABLE_LIMIT = 20`).
- Repository: `server/src/modules/eval/repository.ts:279-321`
  (`latestBatchPerAgent`) and `:331-399` (`runRowsGroupedByBatch`) — the seam
  the per-agent trend read extends.
- Runner error codes the fan-out branches on:
  `server/src/modules/eval/runner.ts:67-73` → `AppError('empty_eval_set', …, 422)`;
  `:249` → `NoProviderKeyError` → 409 `no_provider_key`
  (`server/src/platform/errors.ts:46`).
- Existing client seam: `client/src/lib/hooks/eval.ts:153-162`
  (`useRunAgentEvalBatch` → `POST /agents/:id/eval-runs`, invalidates
  `["agent-eval-dashboard", id]` and `["eval-overview"]`) and `:45-47`
  (`isNoProviderKeyError`) — both reused as-is.
- UI kit inventory: `Sparkline` (`charts/Sparkline.tsx`), `ProgressBar`/
  `PercentProgress` (`primitives/ProgressBar.tsx`), `Modal` (`kit/Modal.tsx` —
  overlay click closes, **no Escape handler** — the new dialog adds its own
  `keydown` listener), `Button` (`icon="Play"`, `loading`, `disabled`),
  `Icon.ChevronRight`, `Icon.Play`.
- The fan-out hook's exported shape and the `trend`/`last_batch` per-variant
  meanings are pinned in the plan's **Contract & migration impact** — read that
  section before implementing steps 4, 6 or 8.

## Ownership

| Wave | Lane | Steps | Owns | Must not touch |
|---|---|---|---|---|
| 1 | W1-A | 1 | `server/src/vendor/shared/contracts/eval-ci.ts`, `client/src/vendor/shared/contracts/eval-ci.ts`, and **only** the `trend: []` placeholder lines in `server/src/modules/eval/dashboard.ts` and `client/src/app/eval/_components/EvalOverview/EvalOverview.test.tsx` | `client/messages/**`, `client/src/lib/hooks/**`, `EvalOverview/helpers.ts`, `EvalOverview/constants.ts`, `server/src/modules/eval/repository.ts` |
| 1 | W1-B | 2 | `client/messages/en/eval.json` | `client/src/**`, `server/**` |
| 1 | W1-C | 3 | `client/src/app/eval/_components/EvalOverview/helpers.ts`, `.../constants.ts` | `.../EvalOverview.tsx`, `.../styles.ts`, `.../EvalOverview.test.tsx`, `client/messages/**`, `client/src/lib/**`, `server/**` |
| 1 | W1-D | 4 | `client/src/lib/hooks/eval.ts`, `client/src/lib/hooks/eval.test.tsx` | `client/src/app/**`, `client/messages/**`, `client/src/vendor/**`, `server/**` |
| 2 | W2-A | 5 | `server/src/modules/eval/repository.ts`, `server/src/modules/eval/dashboard.ts` | `client/**`, the rest of `server/src/modules/eval/**` |
| 2 | W2-B | 6 | `client/src/app/eval/_components/EvalOverview/_components/AgentRow/**` | `.../_components/RunAllDialog/**`, `.../EvalOverview.tsx`, `.../styles.ts`, `.../helpers.ts`, `.../constants.ts`, `server/**` |
| 2 | W2-C | 7 | `client/src/app/eval/_components/EvalOverview/_components/RunAllDialog/**` | `.../_components/AgentRow/**`, `.../EvalOverview.tsx`, `.../styles.ts`, `server/**` |
| 3 | W3-A | 8 | `client/src/app/eval/_components/EvalOverview/EvalOverview.tsx`, `.../styles.ts`, `.../EvalOverview.test.tsx` | `client/src/vendor/**`, `client/messages/**`, `server/**`, and the two sub-component folders (consume their barrels, do not edit them) |
| 4 | W4-A | 9 | `server/test/eval.it.test.ts` + point fixes anywhere a seam mismatch is found | `client/src/vendor/ui/**`, `server/src/db/migrations/*.sql` |
| 5 | W5-A | 10 | `client/README.md`, `server/README.md` | code, `AGENTS.md` |

## Amendments in force

none

## Known pre-existing failures

none observed yet
