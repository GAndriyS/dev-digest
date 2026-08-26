# Implementation run: l06-evals-expectation-kind
Plan: .claude/plans/l06-evals-expectation-kind.md · Spec: specs/SPEC-05-eval-pipeline-26-08-2026.md (approved) · Mode: multi · Branch: L06-Evals

| Stage | Result | Agent tokens | Note |
|---|---|---|---|
| 1 read plan | 5 waves this run · 3 lanes at widest | 255k (planner) | DAG stated in plan; step 12 → doc-writer (stage 5). **Split gate skipped** — the human pre-authorised going straight from plan to implementation, and authorised resolving any remaining judgement call without asking |

## Execution brief — l06-evals-expectation-kind
Mode: multi-agent · Spec: specs/SPEC-05-eval-pipeline-26-08-2026.md (approved) · Slices: contracts, backend, frontend, meta · Steps this run: 11 of 12 (row 12: doc-writer)
DAG: stated in plan

| Wave | Lane | Steps | Owns (paths) | Depends on | Slice(s) | Verification |
|---|---|---|---|---|---|---|
| 1 | A | 1 | both `contracts/knowledge.ts` copies | — | contracts | verify.mjs --slice backend --slice frontend |
| 1 | B | 2 | `db/schema/eval.ts`, new migration, `modules/eval/types.ts` | — | backend | db:migrate → verify.mjs --slice backend |
| 1 | C | 3 | `client/messages/en/eval.json` | — | frontend | verify.mjs --slice frontend |
| 2 | A | 4 | `modules/eval/{service,repository}.ts`, `modules/skills/helpers.ts` | 1, 2 | backend | verify.mjs --slice backend |
| 2 | B | 5 | `EvalsTab/helpers.ts` | 1 | frontend | verify.mjs --slice frontend |
| 2 | C | 7 | `lib/hooks/eval.ts` + test, two `vi.mock` factory blocks | 1 | frontend | verify.mjs --slice frontend |
| 3 | A | 6 | `modules/eval/{runner,repository,routes}.ts` | 2, 4 | backend | verify.mjs --slice backend |
| 4 | A | 8 | `modules/eval/{repository,dashboard}.ts`, `recent_runs` comment in both `eval-ci.ts` | 2, 6 | backend + contracts | verify.mjs --slice backend --slice frontend |
| 4 | B | 9 | `EvalCaseModal/**` | 3, 5, 7 | frontend | verify.mjs --slice frontend |
| 4 | C | 10 | `EvalsTab.tsx`, `styles.ts`, `EvalsTab.test.tsx` | 3, 5 | frontend | verify.mjs --slice frontend |
| 5 | — | 11 (integration) | `server/test/eval.it.test.ts` + point seam fixes | 4, 6, 8, 9, 10 | backend + integration | db:migrate → verify.mjs --slice integration → pnpm verify:l06 |
| 6 | — | 12 — not this run (doc-writer, stage 5) | `server/README.md`, `client/README.md` | 11 | meta | check-specs.mjs |

Notes: concurrency cap 3, and the widest wave is exactly 3 — no batching needed.
This run adds a **migration**, so `cd server && pnpm db:migrate` runs after wave 1
and again before the integration lane. Open questions the executors inherit, all
defaults taken by the planner and all reversible: a PUT carrying
`expectation_kind` 422s rather than being ignored; `Save` keeps the modal open
when `Run on save` is on; `Run case` is disabled on an unsaved case; the
JSON-derivation fallback stays for unmigrated rows.

## Reports
(appended per stage)
