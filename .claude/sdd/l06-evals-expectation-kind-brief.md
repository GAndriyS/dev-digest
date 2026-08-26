# Handoff brief — l06-evals-expectation-kind
Spec: specs/SPEC-05-eval-pipeline-26-08-2026.md (approved, revised 27/08/2026) · Plan: .claude/plans/l06-evals-expectation-kind.md · Branch: L06-Evals · Base: 4765abcc8fdd446942c6e0da17d984b9d0c30b6d

## Binding rules (locators, not prose)

Copied from the plan's **Context read** — do not re-derive them.

**Repo rules**
- `AGENTS.md:42-45` — `@devdigest/shared` exists twice: `server/src/vendor/shared`
  (canonical) and `client/src/vendor/shared` (trimmed, already drifted). Edit the
  server copy, mirror wire-crossing changes into the client copy, never one only.
- `AGENTS.md:46-47` — contracts are Zod-first: one schema drives request
  validation **and** response serialization; never `Schema.parse(req.body)` in a
  handler.
- `AGENTS.md:41` — migrations are NOT applied on boot: `cd server && pnpm db:migrate`.
- `AGENTS.md:48-49` — a DB-backed test must end in `.it.test.ts`; the unit and
  integration lanes split on exactly that glob.
- `AGENTS.md:16-27` — six independent packages: `server/`, `client/` → pnpm.
- `AGENTS.md:81-83` — do not touch `server/clones/**`, **applied**
  `server/src/db/migrations/*.sql`, `**/src/vendor/ui/**`.
- `AGENTS.md:71` — when prose and CI disagree, trust `.github/workflows/**`.
- `server/AGENTS.md:13-14` — module anatomy `modules/<name>/{routes,service,repository}.ts`:
  routes validate, services own logic, repositories own SQL.
- `server/AGENTS.md:18-19` — declare zod `params`/`body` **on the route** (422
  before the handler runs); throw `AppError` for anything with a status.
- `server/AGENTS.md:25-27,29` — test split; `pnpm db:generate` for a new
  migration; never edit applied `src/db/migrations/**`.
- `client/AGENTS.md:13-15,16-19,24,26-29` — types come from `@devdigest/shared`;
  all API access through `src/lib/api.ts`, data hooks in `src/lib/hooks/*`; UI
  strings in `messages/<locale>/*.json`; placement machine-enforced by `pnpm arch`.
- `.claude/skills/pr-self-review/routing.md:65-75` — slice table; `:99-107` skill map.

**Insights**
- root `INSIGHTS.md:526-530` (2026-08-05) — `drizzle-kit generate` stops with an
  **interactive** prompt when one diff both adds and drops a column; it cannot be
  answered by piping keystrokes. Keep this change purely additive.
- root `INSIGHTS.md:31-42` (2026-08-26) — a wire step touching a shared field must
  name **every** hand-built literal of that type, found by grepping the whole
  tree; an unnamed site turns `verify.mjs --slice frontend` red for every parallel
  lane at once, because typecheck is whole-tree.
- root `INSIGHTS.md:43-52` (2026-08-26) — another session may be committing to
  this branch; the main session commits with an explicit pathspec (not a step).
- `server/INSIGHTS.md:223-232` (2026-08-26) — a single generic route serving two
  owner kinds is a silent data-corruption vector when its body schema knows only
  one of them: Zod's default `z.object()` **strips** unknown keys, which is how
  `PUT /eval-cases/:id` once deleted `file`/`start_line`/`end_line` from agent
  cases. Today that body is a `z.union` + `.strict()` (`skills/routes.ts:109-128`).
- `server/INSIGHTS.md:212-221` (2026-08-26) — `no-cross-module-internals` publishes
  only a module's `constants.ts`/`types.ts`/`index.ts` across a module boundary;
  `helpers.ts` is private even for a stable 6-field schema. Duplicate the small
  shape locally with a comment naming the rule, do not widen the boundary.
- `server/INSIGHTS.md:236-245` (2026-08-26) — the driver is `postgres` (porsager):
  wire-error fields sit directly on the error, and translating them into a domain
  error belongs in the repository, not the service.
- `client/INSIGHTS.md:188-197` (2026-08-26) — `@testing-library/user-event` is
  **not installed**; every interaction test here uses `fireEvent`, keyboard
  assertions included. Do not add the dependency to satisfy a skill's default.
- `client/INSIGHTS.md:214-221` (2026-08-20) — component suites mock hook modules
  with a plain factory, so a **new export** added to `@/lib/hooks/eval` is absent
  for every suite rendering a component that imports it, and vitest raises a hard
  mock error mid-render. Add the stub in the same change as the export.
- `client/INSIGHTS.md` (2026-08-26) — the app's `QueryClient` fires a global
  `mutationCache.onError` toast; a component rendering its own failure copy opts
  out with `meta: { ownErrorToast: true }` and then owns every error branch.

**Two traps this plan names explicitly**
- The vendored `Toggle`/`Checkbox` have **no `disabled` prop** (only `Button`
  does). "Disable the toggle" is unimplementable as a prop — use a guarded
  `onChange` + `aria-disabled` wrapper. `client/src/vendor/ui` is do-not-touch.
- Both repository batch reads filter `batch_id IS NOT NULL`
  (`server/src/modules/eval/repository.ts:244,305`), so a run outside a batch is
  invisible until `recent_runs` is widened — and minting a one-case "batch"
  instead would poison the trend, the sparkline and the regression banner that
  shipped this morning.

**Pinned seam — the modal's props** (steps 9 and 10 must agree):
`{ agentId: string; evalCase: EvalCase | null; lastRun?: EvalRunRecord; onClose: () => void }`.
`lastRun` absent/`undefined` = this case has never run (AC-66's `Never run yet`
branch) — never a zero-filled object. The tab supplies `latest.get(c.id)`; the
modal replaces it with the mutation's own returned record after a run and never
merges the two.

## Ownership

| Wave | Lane | Steps | Owns | Must not touch |
|---|---|---|---|---|
| 1 | W1-A | 1 | `server/src/vendor/shared/contracts/knowledge.ts`, `client/src/vendor/shared/contracts/knowledge.ts` | `contracts/eval-ci.ts` (both copies — wave 4), `server/src/db/**`, `client/messages/**` |
| 1 | W1-B | 2 | `server/src/db/schema/eval.ts`, the **new** `server/src/db/migrations/*.sql`, `server/src/modules/eval/types.ts` | every applied `migrations/*.sql`, `server/src/vendor/shared/**`, the rest of `server/src/modules/eval/**` |
| 1 | W1-C | 3 | `client/messages/en/eval.json` | `client/src/**`, `server/**` |
| 2 | W2-A | 4 | `server/src/modules/eval/service.ts`, `server/src/modules/eval/repository.ts`, `server/src/modules/skills/helpers.ts` | `server/src/modules/eval/{runner,routes,dashboard}.ts`, the rest of `server/src/modules/skills/**`, `client/**` |
| 2 | W2-B | 5 | `client/.../EvalsTab/helpers.ts` | `EvalsTab.tsx`, `EvalsTab.test.tsx`, `_components/EvalCaseModal/**`, `client/messages/**`, `client/src/lib/**` |
| 2 | W2-C | 7 | `client/src/lib/hooks/eval.ts`, `client/src/lib/hooks/eval.test.tsx`, and **only** the `vi.mock` factory blocks of `EvalsTab.test.tsx` and `EvalCaseModal.test.tsx` | everything else in those two test files, `client/.../EvalsTab/helpers.ts`, `client/messages/**`, `server/**` |
| 3 | W3-A | 6 | `server/src/modules/eval/{runner,repository,routes}.ts` | `server/src/modules/eval/{service,dashboard}.ts`, `client/**` |
| 4 | W4-A | 8 | `server/src/modules/eval/{repository,dashboard}.ts`, the `recent_runs` comment block in both `contracts/eval-ci.ts` copies | `server/src/modules/eval/{service,runner,routes}.ts`, `contracts/knowledge.ts`, `client/src/app/**` |
| 4 | W4-B | 9 | `client/.../EvalsTab/_components/EvalCaseModal/**` | `EvalsTab.tsx`, `EvalsTab.test.tsx`, `../../helpers.ts` (consume it, do not edit it), `client/messages/**`, `client/src/lib/**`, `server/**` |
| 4 | W4-C | 10 | `client/.../EvalsTab/EvalsTab.tsx`, `.../styles.ts`, `.../EvalsTab.test.tsx` | `_components/EvalCaseModal/**` (import through its `index.ts`), `../helpers.ts`, `client/messages/**`, `server/**` |
| 5 | W5-A | 11 | `server/test/eval.it.test.ts` + point fixes wherever a seam mismatch is found | `client/src/vendor/ui/**`, applied `server/src/db/migrations/*.sql` |
| 6 | W6-A | 12 | `server/README.md`, `client/README.md` | code, `AGENTS.md`, `specs/**` |

## Amendments in force

none

## Known pre-existing failures

none — `pnpm verify:l06` was green (8/8 gates) at the base of this run.
