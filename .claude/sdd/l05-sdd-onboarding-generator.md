# Implementation run: l05-sdd-onboarding-generator
Plan: .claude/plans/l05-sdd-onboarding-generator.md · Spec: specs/SPEC-03-onboarding-generator-19-08-2026.md (approved) · Mode: multi · Branch: L05-SDD

Run driven by hand (user-specified stage order: implementer → test-writer + architecture-reviewer → plan-verifier, one commit per stage), logged in the `/implement` run-file shape.

| Stage | Result | Agent tokens | Note |
|---|---|---|---|
| 0 spec | SPEC-03 approved, 40 AC, 0 open | 105k (spec-creator, 2 passes) | interview answered by main session with option (a) ×4 (user asked for autonomous drive) |
| 1 plan | 19 steps, 4 waves, 3 lanes | 209k (planner) + 163k (cross-model review) | cross-model review APPROVE WITH CHANGES — 15 amendments accepted, appended to plan; gate auto-accepted |

## Execution brief — l05-sdd-onboarding-generator
Mode: multi-agent · Spec: specs/SPEC-03-onboarding-generator-19-08-2026.md (approved) · Slices: contracts, backend, frontend, e2e · Steps this run: 15 of 19 (row 13: main session; 16–18: test-writer stage; 19: doc-writer)
DAG: stated in plan (Depends on column) + amendments A1–A15

| Wave | Lane | Steps | Owns (paths) | Depends on | Slice(s) | Verification |
|---|---|---|---|---|---|---|
| 1 | A | 1 | server/src/vendor/shared/contracts/knowledge.ts, client/src/vendor/shared/contracts/knowledge.ts, server/test/contracts.test.ts (fixture only) | — | contracts | verify.mjs --slice backend --slice frontend |
| 2 | A | 2–8 | server/src/modules/onboarding/**, server/src/modules/index.ts, server/src/modules/repo-intel/{types,repository,service}.ts, server/src/prompts/onboarding.system.md | 1 | backend | verify.mjs --slice backend |
| 2 | B | 9–12 | client/src/app/repos/[repoId]/onboarding/**, client/src/lib/hooks/onboarding.ts, client/src/lib/hooks/index.ts, client/src/lib/api.ts (comment), client/src/components/app-shell/helpers.ts, client/messages/en/onboarding.json, client/src/app/globals.css (R5) | 1 | frontend | verify.mjs --slice frontend |
| 2 | main | 13 | client/src/vendor/ui/nav.ts | 9 | frontend | pr-gate Vendor-update line |
| 3 | C | 14 | e2e/specs/11-onboarding-tour.flow.json, e2e/README.md | 11, 13 | e2e | ./scripts/e2e.sh |
| 3 | A | 15 (integration) | seams only | 7, 11, 13 | backend + frontend | verify.mjs --slice backend --slice frontend --slice integration |

Notes: gate auto-accepted (autonomous run). Amendments A1–A15 are binding. R1/R2 not adopted, R5 adopted.

## Reports

### Implementer reports (stage 2)
- Wave 1 / lane A, step 1 — 1/1 · 111k tokens. Contracts in both shared copies; `contracts.test.ts` fixture + mirror-on-disk assertion (A1). backend: typecheck/depcruise PASS, 5 pre-existing unit failures (context-walk ×3, depgraph-adapter ×2 — env-bound, identical on base); frontend PASS.
- Wave 2 / lane A, steps 2–8 — 7/7 · ~2 runs (first cut by API ENOTFOUND, resumed). repo-intel `IndexState` +`totalCandidates`/`bounded`; `modules/onboarding/{constants,types,helpers,facts,repository,service,routes}`; five-kind prompt. Deviations: `buildSkeleton(reason, index)` (no clone reads on skeleton); A14 probe uses `MAX_FILE_BYTES` (readInsideClone rejects oversize → `maxBytes:1` would misreport); model-supplied section titles, `SECTION_TITLES` for skeleton; rate-limit on POST /generate; `response[200]` declared. Insight candidates: `completeStructured` throws on exhausted retries without accumulated usage; `readInsideClone` is not an existence probe.
- Wave 2 / lane B, steps 9–12 — 4/4 · 174k. `activeKeyFor` regex for `/repos/:id/onboarding`; hooks always send `{ locale }`; `OnboardingTourView` (states: loading/error/skeleton/empty/full; `generated_at === null` discriminator; TOC scroll-spy with IntersectionObserver guard); onboarding.json rewritten. frontend PASS (367 tests). R5 `.dd-md` already on branch (83d11ec).
- Wave 2 / step 13 — main session, via Bash with explicit user authorization (Edit denied by settings): NAV row `onboarding-tour` (`Workflow`, `g o`) + SHORTCUTS + declared-vendor-update comment.
- Wave 3 / step 15 (integration) — 1/1 · verification-only, 0 edits: six seams confirmed consistent; integration lane 80/82 (2 = documented `reviews.it.test.ts` specs_read race).
- Wave 3 / step 14 (e2e) — 1/1 · 75k. `e2e/specs/11-onboarding-tour.flow.json` (viewport 1280×900, role-link navigation, asserts skeleton title/CTA, reason on the seeded stand = `not_indexed`) + README row. Not run: `agent-browser` not installed on this machine.

### Stage 3/4 — tests, architecture review, code review, fix loop
- **architecture-reviewer** (sonnet): PASS · 0 CRITICAL · 1 WARNING (`nav.ts` declared vendor update — PR body must carry `Vendor-update: client/src/vendor/ui/nav.ts`) · depcruise server/client + ui-conventions exit 0 · five invariants confirmed with locators: exactly one `completeStructured` call site (`service.ts`), reading path ordered by code (`orderReadingPath`), skeleton never persisted (single `upsertTour` in the success branch), no `stat` of model paths (`filterToKnownPaths` over `knownPathsOf(facts)`), no command execution (zero `child_process`/`exec`/`spawn`).
- **test-writer ×3** (from the spec's AC `· verify:` hints, not from the code): step 16 `server/test/onboarding-{helpers,facts}.test.ts` (AC-11/13/16/17/18/19/20/21/22/31/34/39/40 + A2/A3/A5/A14/A15) — found RED: **AC-13 `critical_paths` trusted model order** → fixed by `orderByTopFileRank` (one ordering primitive); step 17 `server/test/onboarding.it.test.ts` 25 cases (AC-3/4/5/9/15/21/23/25/26/27/28/29/30/32/33/35/36) green; step 18 `OnboardingTourView.test.tsx` (19 cases, AC-1/3/6/7/8/10/12/13/14/15/16/20/24/37/38, D9 sentinel test) + `app-shell/helpers.test.ts` (AC-2) green. One stall (stream watchdog) resumed; a sentinel false-positive on fixture text fixed in the test.
- **/code-review high** (8 finder angles, 2 stalled and resumed): 10 findings (5 CONFIRMED, 5 PLAUSIBLE) — all 10 **fixed**: run_locally link semantics pinned in the prompt (`label` = command, `path` = source file, ≤6); incremental index carries `totalCandidates`/`bounded` forward (+unit test); generate hook `setQueryData` so a skeleton result renders; skeleton telemetry carries `error`, `attempts: null` (honest); POST body `.nullish()` (Fastify passes `null` for a body-less POST; it-test added); `TASK_SCAN_FILES` fetched once via `max(TOP_FILES_N, TASK_SCAN_FILES)`; `siblingTestCandidates` → 7 fixed probes incl. `test/`/`tests/` mirrors and cross-ext; `isEmptyTour` `== null`; `CommandRow` timer ref + cleanup; `NoProviderKeyError`/`NO_PROVIDER_KEY_CODE` hoisted to `platform/errors.ts` (conventions, skills, onboarding import it) and `clipHead` to `modules/_shared/prompt-text.ts`.
- Lanes after the fix loop: backend typecheck/depcruise PASS, unit 2 failures = pre-existing env-bound `depgraph-adapter` ×2 (context-walk ×3 pass under Node 22); integration 108/108; frontend 394/394.

### plan-verifier (stage 5)
MET 68 · PARTIAL 2 · NOT MET 1 · UNVERIFIABLE 3 · N/A (declared deviations) 8 → **INCOMPLETE** on the settled tree at a59bac8, for exactly these rows: Step 19 docs NOT MET (doc-writer not yet run); Step 14 e2e UNVERIFIABLE (flow not executed); AC-20/Step 11 PARTIAL (the "no signals" message was model-supplied, not code-enforced); Step 13 pr-gate UNVERIFIABLE (no PR body yet). 39/40 ACs MET; traceability matrix filled (AC → step → test name/file → commit: 35f1cef contracts · 7eb3150 code · a59bac8 tests/fix loop · 5df35bd e2e). Unrequested changes listed: platform/errors `NoProviderKeyError`, `_shared/prompt-text.ts`, conventions/skills constants+service (fix-loop hoists), `indexer-pipeline.test.ts`, `hooks/onboarding.test.tsx`. ~145k+ tokens (one API cut, resumed).

Closed by the main session after the verdict:
- AC-20 → **MET**: the view renders `firstTasks.noSignals` (i18n) whenever `first_tasks.links` is empty (code-enforced; server already guarantees `links: []` without signals); RTL test updated. frontend 394/394.
- Step 19 → **MET**: doc-writer — `server/README.md` (API map + onboarding paragraph + generate flowchart), `client/README.md` (route map + states), `repo-intel/README.md` (IndexState counters, onboarding consumer). 88k tokens.
- Step 14 → **MET**: user authorized `npm i -g agent-browser && agent-browser install`; `./scripts/e2e.sh` on alternate ports (5433 was taken): first run 10/11 — `find role link --name "Onboarding Tour"` does not resolve the sidebar entry; switched to the same `find text … click` flow 10 uses → **11/11 flows passed**.
- Step 13 pr-gate → closes with the PR body (`Vendor-update: client/src/vendor/ui/nav.ts`) at stage 6.
→ effective verdict **COMPLETE** (40/40 AC MET; steps 1–19 MET).

### Stage 6 — /pr-self-review
PASS (report-only; 0 surviving CRITICAL). Gates: backend typecheck/depcruise PASS + 2 pre-existing `depgraph-adapter` failures **reproduced on base 5d82522 in a clean worktree**; frontend 402/402; integration 108/108; mcp PASS; `./scripts/e2e.sh` 11/11; check-specs clean; contract mirror asserted on disk.
- /security-review: **1 CRITICAL fixed** — `run_locally` `label` is a copyable shell command and was unvalidated model output attributed to a real config file (injected README → `curl … | sh` with a Copy button). Now `filterToSourcedCommands`: path ∈ files actually read, unsafe shell class rejected outright, then verbatim-or-grounded-bootstrap-shape. Verbatim-only was tried first and emptied the section (`npm install` is not literally in `package.json`) — the it-test caught it. W1 arch-link cap and W3 markdown-body sanitization also fixed; W2 (`.env.example` reaches the provider — it is the feature) and W4 (read amplification, local-first, rate-limited) accepted with reasons.
- Skill subagents: 4 WARNINGs → 3 fixed (run_locally gate narrowed to `facts.runFiles`, hook invalidates only on `ready` so a skeleton reason survives, client `SECTION_KINDS` derived from the wire enum); 1 accepted (`OnboardingTourView.tsx` component split — pure move, deferred as follow-up #1). 11 SUGGESTIONs recorded, not applied.
- Artifacts: `.claude/reviews/self-review-L05-SDD-onboarding.md`, `.claude/reviews/pr-body-L05-SDD-onboarding.md`, `.git/pr-self-review.json`.

### Stage 7 — wrap-up
INSIGHTS +4: `server/INSIGHTS.md` ×2 (Fastify body-less POST arrives as `null` → `.nullish()`, invisible to `payload: {}` tests; verbatim-only command grounding is unshippable — reject the unsafe class + grounded shapes), `e2e/INSIGHTS.md` (role-link locator does not resolve sidebar entries), root `INSIGHTS.md` (cross-model plan review as a binding amendments table).
Follow-ups recorded, not done: split `SectionCard`/`LinkRow`/`CommandRow` into `_components/`; `existsInsideClone` stat-only probe in `_shared/clone-fs.ts`; in-degree facade method for AC-19's third signal (R2); `'empty'` as a third `Onboarding.status` (R1).
Agent cost this run ≈ 1.6M tokens (spec 105k · planner 209k · cross-model review 163k · implementers 111k+~180k+174k+75k+42k · test-writers 105k+81k+~120k · architecture-reviewer ~60k · code-review angles ~330k · plan-verifier 145k · doc-writer 88k · security 65k).
