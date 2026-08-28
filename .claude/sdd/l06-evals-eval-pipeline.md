# Implementation run: l06-evals-eval-pipeline
Plan: .claude/plans/l06-evals-eval-pipeline.md · Spec: specs/SPEC-05-eval-pipeline-26-08-2026.md (draft) · Mode: multi · Branch: L06-Evals

| Stage | Result | Agent tokens | Note |
|---|---|---|---|
| 1 read plan | 7 waves · max 4 lanes (run ≤3 in flight) | — | DAG stated in plan; baseline verified; spec already approved; human gate answered: run as shown, nav.ts by main session (user-authorized deny exception) |
| 2 wave 1 | 4/4 lanes 1/1 | 77k + 94k + 119k + 107k | W1-A deviation: source_finding_id `.nullish()` not `.nullable()` (protects out-of-scope skills flow); W1-D: agents.json untouched (editor.tabs.evals already exists), findingAction.* keys live in eval.json → step 12 needs useTranslations("eval"); step 14 done by main session (+6 lines nav.ts, data-only) |
| 2 wave 3 | 3/3 lanes 1/1 | 120k + 156k + 128k | First wave-3 launch died with the parent session (no output); relaunched clean. W3-B: grounding via reviewer-core reviewPullRequest (same as review path); all-errored batch → recall/precision 0 (contract non-nullable, flagged). W3-C: empty state = empty arrays, current/delta are 0-filled placeholders (contract constraint) — steps 11/13 must gate on recent_batches.length; overview does per-agent listAgentCases (bounded by agent count, accepted) |
| 2 wave 4 | 3/3 lanes 1/1 | 138k + 203k + 168k | W4-A deviation (accepted): PUT/DELETE /eval-cases/:id NOT re-registered — skills/routes.ts already owns both generically (re-registering = FST_ERR_DUPLICATED_ROUTE). Pre-existing bug found: DELETE returns { deleted: id } but both client hooks expect { ok } → step 15 must fix skills/routes.ts:197 response. W4-B: Evals tab + EvalCaseModal, 468 client tests green; seam gap: no literal must_find/must_not_flag strings (badge+icon used). W4-C: FindingCard action self-contained; collateral vi.mock fixes in FindingsTab test; global mutationCache toast duplicates local 422 toast (documented codebase behavior) |
| 2 wave 5 | 1/1 | 252k | /eval pages + CompareModal; local AgentVersionSnapshot type (client mirror gap, fixed in loop 1) |
| 2 wave 6 | 1/1 | 232k | eval.it.test.ts 12 tests; DELETE /eval-cases/:id { ok } fix; integration 130/130 |
| 3 find | arch: PASS 0 CRIT 1 WARN · cr: 8 CONFIRMED · sec: 1 MEDIUM | arch 158k · 8 finders ~797k + 8 verifiers ~474k · sec 181k | cr findings: PUT strips agent expected_output (skills schema), fake alert/delta/trend nulls, top-20 last_batch window, aggregate drift, greedy matching, 23505 race, >= boundary; sec: LiteLLM proxy 0.0.0.0 |
| 3b review loop | fix pass 10/10 (loop 1) | 332k | commit 076315c; interrupted once by machine sleep, resumed; all lanes green (frontend 491, integration 135, mcp 67); scoped re-review in flight |
| 3b re-review | PASS · prior WARN cleared · 1 new WARN fixed by main session | 79k | Postgres 23505 introspection moved out of the service into the repository (`DuplicateEvalCaseError`), commit f7e73bf |
| 4 verify | INCOMPLETE → closed | 230k | 62 MET · 1 PARTIAL (AC-7: `VALID_TABS` never learned "evals" — found by the verifier AND by clicking, fixed in 6c062d5) · 1 NOT MET (step 16 docs, ran after) · 1 UNVERIFIABLE (300ms NFR, structural by plan) |
| 5 docs | AGENTS.md · server/README.md · client/README.md | 97k | check-specs green; root convention amended so "install at root does nothing" stops contradicting the new scripts-only package.json |
| — browser pass | manual click-through, 2 defects found and fixed | — | (a) `?tab=evals` fell back to Config (6c062d5); (b) one click stacked two error toasts on the 422 path (a315e78). Verified live: AC-2/5/6/8/10/11/14/17/18/26/27/29/32/33/34 + E8/E11 |
| 2 wave 2 | 2/2 lanes 1/1 | 118k + 140k | W2-A: EvalRepository, owner_kind filter in repo, batch limit via group-then-fetch (no N+1), aggregation left to dashboard.ts. W2-B deviation (accepted): additive `apiFetchWithStatus` in client/src/lib/api.ts — 201/200 discriminant needs status, fetch-gate forbids bare fetch; apiFetch unchanged, 442/442 green. Hook→route seam table recorded in W2-B report (wave 3/4 delegations carry it) |

## Execution brief — l06-evals-eval-pipeline
Mode: multi-agent · Spec: specs/SPEC-05-eval-pipeline-26-08-2026.md (draft) · Slices: frontend, backend, contracts, meta · Steps this run: 14 of 16 by implementer (row 14: human; row 16: doc-writer, stage 5)
DAG: stated in plan (Depends on column + Execution table)

| Wave | Lane | Steps | Owns (paths) | Depends on | Slice(s) | Verification |
|---|---|---|---|---|---|---|
| 1 | W1-A | 1 | shared contracts (both copies) | — | contracts | verify --slice backend --slice frontend |
| 1 | W1-B | 2 | db schema/eval.ts + generated migration | — | backend | db:generate → db:migrate → verify backend |
| 1 | W1-C | 3 | modules/eval/{scoring,helpers,constants}.ts + unit test | — | backend | verify backend |
| 1 | W1-D | 4 | root package.json, client messages | — | meta+frontend | verify frontend + pnpm verify:l06 starts |
| 2 | W2-A | 5 | modules/eval/{repository,types}.ts | 1,2 | backend | verify backend |
| 2 | W2-B | 6 | client/src/lib/hooks/eval.* | 1,4 | frontend | verify frontend |
| 3 | W3-A | 7 | modules/eval/service.ts | 5 | backend | verify backend |
| 3 | W3-B | 8 | modules/eval/runner.ts | 3,5 | backend | verify backend |
| 3 | W3-C | 9 | modules/eval/dashboard.ts | 5 | backend | verify backend |
| 4 | W4-A | 10 | modules/eval/routes.ts, modules/index.ts | 7,8,9 | backend | verify backend |
| 4 | W4-B | 11 | AgentEditor/** (Evals tab) | 6 | frontend | verify frontend |
| 4 | W4-C | 12 | FindingCard/**, FindingsPanel.tsx | 6 | frontend | verify frontend |
| 5 | W5-A | 13 | client/src/app/eval/** | 6 | frontend | verify frontend |
| — | human | 14 | client/src/vendor/ui/nav.ts | — | frontend | sidebar item + Vendor-update line in PR |
| 6 | W6-A | 15 | server/test/eval.it.test.ts + seam fixes | 10-13 | backend+integration | db:migrate → verify integration + backend + frontend |
| 7 | W7-A | 16 | AGENTS.md, server/README.md, client/README.md | 15 | meta | check-specs.mjs |

Notes:
- Wave 1 has 4 lanes but ≤3 agents in flight — W1-D starts as the first of A/B/C finishes.
- Known pre-existing: `server unit tests` gate red on macOS via test/depgraph-adapter.test.ts (tmpdir fixtures, INSIGHTS server#2026-08-20) — verified at base 4765abc before any change.
- Untracked leftover `server/src/modules/checkout/` in the tree: not this plan, not registered, left untouched, never committed.
- Spec is draft — check-specs.mjs accepts draft; building on it per plan.

## Reports

(appended per stage)
