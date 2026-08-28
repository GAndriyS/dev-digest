# Implementation run: l06-evals-expectation-kind
Plan: .claude/plans/l06-evals-expectation-kind.md · Spec: specs/SPEC-05-eval-pipeline-26-08-2026.md (approved) · Mode: multi · Branch: L06-Evals

| Stage | Result | Agent tokens | Note |
|---|---|---|---|
| 1 read plan | 5 waves this run · 3 lanes at widest | 255k (planner) | DAG stated in plan; step 12 → doc-writer (stage 5). **Split gate skipped** — the human pre-authorised going straight from plan to implementation, and authorised resolving any remaining judgement call without asking |
| 2 implement | 11/11 | 70k+108k+69k ∥ 84k+81k+108k ∥ 120k ∥ 154k+208k+133k ∥ 224k | one wave-4 lane went red on the pinned `lastRun` seam until its sibling landed — expected, and it correctly did not touch the other lane's file |
| 3 find | arch: PASS 0 findings · code-review: 1 · security: empty report | 105k ∥ — ∥ 103k | `/code-review medium` — hand-written delta ≈2000 lines (3836 of the diff are a generated drizzle snapshot) |
| 3b review loop | PASS after 1 loop, 2 fix passes | 102k + 122k + 57k | the one finding turned up a second bug of the same root; both fixed rather than half-fixed |
| 4 verify | 87 MET · 0 PARTIAL · 0 NOT MET · Gaps: none | 166k | verdict INCOMPLETE only because docs had not landed at verification time — stage 5 closed it |
| 5 docs | `server/README.md`, `client/README.md` | 147k | `client/README.md` had no Evals-tab description at all; written from scratch rather than patched |
| 6 pr | PASS · 0 CRITICAL · `pr-gate-ci` clean · `verify:l06` 8/8 | — | body + report in `.claude/reviews/`; **human opens the PR and flips the spec to `implemented`** |
| 7 wrap-up | 4 insights + 1 session note | — | root ×2 (1 dated follow-up, 1 session note), `client/INSIGHTS.md` ×3, `server/INSIGHTS.md` ×1 |

Total agent spend: ~2.1M tokens across 17 subagent runs.

## Findings this run

One `/code-review` finding — and the fix pass surfaced a second bug of the same
root, which was fixed rather than deferred:

1. `EvalCaseModal.tsx` — after `Run on save` created a case, the modal kept
   reading the never-changing `evalCase` prop: no kind banner for a case that
   now had a stored kind, and `Run case` disabled with "save it first" on an
   already-saved case.
2. The same stale prop drove `submit()`'s create-vs-update branch, so a second
   `Save` minted a **duplicate** case instead of updating the row just created.
   Fixing only the first symptom would have made this likelier, not rarer — the
   modal would have looked settled and invited that second Save.

## Judgement calls made without asking

The human authorised resolving these directly. Recorded so a reviewer can
disagree with them:

- **Scope of the modal work** — the design screenshots also show Input tabs
  (Diff / Files / PR meta) and a `+ Finding skeleton` button. Neither was asked
  for; both were left out and recorded as deferred in the spec's Non-goals.
- **Finishing the second bug in the same run** rather than filing it as a
  follow-up, because the half-fix made it easier to hit.
- **The modal title still reads the prop**, so a case created in this session
  keeps its `New eval case` heading rather than renaming itself mid-edit.

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
