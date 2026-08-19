# Retro: l05-sdd-onboarding-generator

Date: 2026-08-19 · Branch: L05-SDD · Workflow: spec-creator → implementation-planner (+ cross-model plan review) → hand-driven `/implement` shape (implementer ×5 → test-writer ×3 ∥ architecture-reviewer ∥ /code-review → fix loop → plan-verifier → doc-writer → /pr-self-review + /security-review) → live demo · Source: deep · Window: whole chat (commits 8cf893f..69904aa)

## Run summary

26 agent spawns + 6 resumes (2 killed by `API Error: ENOTFOUND`, 3 by the 600 s stream watchdog, 1 continuation by design), 1 spawn interrupted by the human. Tokens observed for 14 of them; the rest returned through `TaskOutput` without a usage block.

| Agent | Model | Fresh/cont. | Tokens | Tool calls | Duration | Result |
|---|---|---|---|---|---|---|
| spec-creator | opus | fresh + 1 cont. | 105,203 | 24 | 210 s (pass 1) | interview (4 Q) → SPEC-03, 40 AC, 0 open |
| implementation-planner | opus | fresh | 209,249 | 56 | 969 s | 19 steps, 4 waves, 3 lanes |
| cross-model plan reviewer (general-purpose) | fable | fresh | 163,248 | 54 | 423 s | APPROVE WITH CHANGES, 15 amendments |
| implementer — step 1 (contracts) | sonnet | fresh | 110,948 | 22 | 300 s | 1/1 |
| implementer — lane A (steps 2–8) | sonnet | fresh + 1 resume | — (no usage block) | — | — | 7/7 |
| implementer — lane B (steps 9–12) | sonnet | fresh + 1 resume | 173,510 | 11 | 100 s (post-resume) | 4/4 |
| implementer — step 15 (integration) | sonnet | fresh | — | — | — | 0 edits, 6 seams confirmed |
| implementer — step 14 (e2e flow) | sonnet | fresh | 74,982 | 36 | 171 s | flow written, not run |
| test-writer — step 16 (unit) | sonnet | fresh | — | — | — | 43 cases; found AC-13 defect |
| test-writer — step 17 (integration) | sonnet | fresh | — | — | — | 25 cases green |
| test-writer — step 18 (RTL) | sonnet | fresh + 1 resume | — | — | — | 25 cases |
| architecture-reviewer | sonnet | fresh | — | — | — | PASS · 0 CRIT · 1 WARN |
| /code-review angle A | — | fresh | — | — | — | 6 candidates |
| /code-review angle B | — | fresh | — | — | — | 4 candidates |
| /code-review angle C | — | fresh | 116,944 | 44 | 584 s | 5 candidates |
| /code-review cleanup angles | — | fresh + 1 resume | — | — | — | 18 candidates |
| /code-review altitude+conventions | — | fresh + 1 resume | 78,183 | 0 (post-resume) | 38 s | 11 candidates |
| implementer — fix AC-13 | sonnet | fresh | 41,600 | 12 | 110 s | red test → green |
| implementer — fix 10 CR findings | sonnet | fresh | — | — | — | **interrupted by human**, finished by main session |
| self-review backend skills | — | fresh | — | — | — | 1 WARN + 7 SUGG |
| self-review frontend skills | — | fresh | 111,256 | 38 | 295 s | 3 WARN + 4 SUGG |
| /security-review | — | fresh | — | — | — | **1 CRITICAL** + 4 WARN |
| plan-verifier | sonnet | fresh + 1 resume | 145,498 | 54 | 792 s | INCOMPLETE (4 rows) |
| doc-writer | sonnet | fresh | 87,526 | 37 | 133 s | 3 READMEs |
| test-writer — hardening | sonnet | fresh | 105,249 | 35 | 395 s | sanitizer + cache + cap tests |
| test-writer — command gate | sonnet | fresh | 81,570 | 11 | 464 s | 12 cases |
| **Total** | | 26 spawns / 6 resumes | **≈1.60 M observed** (≈2.5 M with the 10 unmeasured runs at the observed median ≈105 k) | — | ≈78 min of measured agent time | 40/40 AC met |

## Sequence

```
spec-creator ⛔(interview answered by main session, not the human) → spec
  → implementation-planner → cross-model reviewer ⛔(auto-accepted) → plan+A1–A15
  → implementer(step 1) → [implementer lane A ∥ implementer lane B ∥ main session nav.ts ⛔]
  → [implementer e2e ∥ implementer integration]
  → [test-writer×3 ∥ architecture-reviewer] → /code-review (5 angle agents) ↺ implementer fix (AC-13)
  → ⛔ human interrupts the CR fix pass → human re-issues the 10 findings → main session fixes inline
  → plan-verifier (INCOMPLETE) → main session closes 4 rows (docs ∥ AC-20 ∥ e2e install+run ⛔)
  → /pr-self-review [backend skills ∥ frontend skills ∥ /security-review] → CRITICAL ↺ main session fix
  → test-writer ×2 (hardening, command gate) ↺ command-gate redesign → PASS
  → spec→implemented → live demo (import ky → index → generate → read logs)
```

## Metrics

| Metric | Value | Evidence |
|---|---|---|
| Agents run | 26 spawns (opus 2, sonnet ~14, fable/unspecified ~10), 6 resumes | results above |
| Tokens | ≈1.60 M observed; ≈2.5 M estimated total (`≈` from the observed median × 10 unmeasured runs) | `subagent_tokens` |
| Most expensive single agent | implementation-planner 209 k (13 % of observed) | usage block |
| Review stack cost | ≈470 k observed across /code-review angles + skill subagents + security (~29 % of observed) | usage blocks |
| Overhead vs work | not measured exactly; **every** agent report lists `AGENTS.md` + module `INSIGHTS.md` + spec + plan under *Files read* — ≈14 independent re-derivations of the same map | `Files read` sections |
| Sequence | 4 parallel fan-outs (2 lanes, 3 test-writers, 5 CR angles, 3 self-review agents); no unnecessary barrier found | message order |
| Interview efficiency | 4 questions, 4 answered — **by the orchestrator, not the human**; 0 answerable from the repo (spec-creator correctly pre-settled route, cache, rank formula) | interview block vs `Decisions taken` |
| Rework | 3 fix loops (AC-13, 10 CR findings, 1 CRITICAL + 3 WARN), 2 extra test-writer passes caused by fixes landing after tests, 1 test-fixture repair, 1 command-gate redesign (verbatim-only → shape-grounded) | reports |
| Handoff fidelity | high: `AC-N` coverage 40/40 spec → plan → verifier; the amendments table (A1–A15) was read and honoured by implementer, test-writer and verifier alike | `rg -o 'AC-\d+'`, verifier report |
| Human gates | 2 `AskUserQuestion` (nav.ts vendor edit, agent-browser install) + 1 interrupt + 1 re-issued instruction | chat |
| Requirement coverage | 40 AC in spec, 40 cited in plan, 40 graded by verifier | `comm` of both `rg` outputs → empty |
| Wall clock | **5 h 28 min** first commit (18:10) → last (23:38), plus ≈25 min live demo; only ≈78 min of that is measured agent time | `git log --date=format:%H:%M:%S` |
| Wall clock by phase | spec→plan 36 m · contracts 6 m · waves 2–3 52 m · e2e+integration 9 m · **tests+arch+CR+fix 1 h 52 m** · verifier+docs+closures 1 h 06 m · self-review+security+hardening 47 m | commit deltas |
| Dead time | ≈50 min: 3 watchdog stalls (600 s each) + 2 API ENOTFOUND deaths + their resume round-trips | task notifications |
| Delta | first entry for this slug | — |

## Per-agent observations

### spec-creator
- **Went well:** pre-settled everything the repo could answer (route shape, cache table, rank formula collapsing to PageRank) and asked only the 4 questions that changed the spec; 40 AC with zero open clarifications; caught two design gaps the mockup hid (`activeKeyFor` collision, "12,450 files" vs `MAX_INDEXED_FILES`).
- **Struggled:** —
- **Missed:** stated in the spec that the two `knowledge.ts` copies are identical; the planner found 9 diff hunks. Minor, caught one stage later.
- **Followed its protocol:** yes — interview gate, no spec file written while questions were open, lint run, 10/10 self-check. It also refused an instruction, arriving through a tool-description channel, to write files via `Bash` — correct.

### implementation-planner
- **Went well:** the requirements review found three genuine contradictions before any code existed (`IndexState` has no `stats` on the facade; `MAX_INDEXED_FILES` bounding never stamps `partial`; AC-30 has no value for "not generated yet"); flagged the `nav.ts` deny rule that had already cost a stage in the previous L05 run.
- **Struggled:** most expensive agent of the run (209 k, 16 min) — the plan is 301 lines before the amendments.
- **Missed:** planned `run_locally` link semantics loosely enough that the client and server disagreed until step 15, and did not foresee the strict-`json_schema` constraint (the cross-model reviewer did).
- **Followed its protocol:** yes — mode taken from the delegation, no spec edits, recommendations kept separate from decisions.

### cross-model plan reviewer
- **Went well:** the highest value-per-token agent of the run. 4 MAJOR findings, all of which would otherwise have surfaced as failing code hours later: `z.record`/`.optional()` rejected under `strict: true`, unbounded prompt, a 409 test that would have hit the real provider, a contract fixture the wire change was about to break.
- **Struggled:** —
- **Missed:** did not question the `run_locally` `label` semantics, which became the run's only CRITICAL.

### implementer (×5)
- **Went well:** lane A and lane B ran on disjoint paths with no conflict; the integration pass (step 15) needed zero edits, which is evidence the ownership table was right.
- **Struggled:** two of five runs died mid-flight on a transient API error and needed a resume; one wrote code before loading the skills its plan row named and only cross-checked afterwards (self-reported).
- **Missed:** `critical_paths` trusted the model's link order (AC-13) — caught by test-writer, not by any reviewer.
- **Followed its protocol:** deviations declared honestly, including the one that corrected the plan (`maxBytes: 1` would have misreported every real file as absent).

### test-writer (×5)
- **Went well:** wrote from the AC text, which is exactly why it found AC-13 — the test was red on arrival and was left red rather than adjusted to the code. Later passes caught a dead `\n` branch in the security regex and repaired one fixture that encoded the pre-hardening rule, saying so explicitly.
- **Struggled:** one run stalled on a self-inflicted false positive (its own fixture text contained a banned literal) and burned the 600 s watchdog before being resumed.
- **Missed:** —

### architecture-reviewer
- **Went well:** confirmed the five load-bearing invariants with locators (one call site, code-ordered reading path, skeleton never persisted, no `stat` of model paths, no command execution) — cheap and exactly the thing config cannot check.
- **Missed:** nothing it owned; the CRITICAL was a security question, not a boundary one.

### /code-review (high, 8 angles)
- **Went well:** 10 findings, all real, all fixed; the incremental-index `stats` overwrite and the body-less-POST 422 were both genuine production bugs.
- **Struggled:** ≈400 k tokens and ~35 min across five agents on a 2.6 k-line diff; two of the five stalled and had to be asked for partial output.
- **Missed:** the copy-a-command injection path — found later by `/security-review` on the same code.

### plan-verifier
- **Went well:** graded all 40 AC + 19 steps + 15 amendments with a locator each, and its INCOMPLETE was correct on all four rows.
- **Struggled:** 145 k / 13 min, and it was cut once by an API error mid-run; it re-derived evidence the reviewers had already produced.

### /security-review
- **Went well:** the single most valuable finding of the run (C1), with a complete exploit path, plus two WARNINGs that were also fixed. Explicitly cleared eight categories with evidence, which is what made accepting W2/W4 defensible.
- **Struggled:** it ran at stage 6 — last — on code written at stage 2.

### doc-writer
- **Went well:** documented from source, not from the plan, and produced one diagram that earned its place. 88 k, 2 min.

## Duplication

- **The map, ×14+.** Every agent's *Files read* opens with root `AGENTS.md`, the package `AGENTS.md`, the module `INSIGHTS.md`, the spec and (after stage 1) the plan. At a conservative 15–25 k per sweep that is ≈250–350 k tokens spent re-deriving a context that did not change during the run.
- **The diff, ×9.** architecture-reviewer, five `/code-review` angles, two self-review skill subagents and `/security-review` each independently read `git diff 02ab3ff..HEAD` over the same files.
- **The AC list, ×3.** spec-creator wrote it, the planner restated all 40 in its requirements review, plan-verifier restated all 40 again with verdicts.
- **Tests written twice.** Hardening landed after the AC suites, so two extra `test-writer` passes (105 k + 82 k) re-entered files a previous pass had just written, and one fixture had to be repaired because it encoded the pre-hardening rule.

## Handoff losses

- **`OnboardingLink` semantics.** The plan left `label`/`path` per section implicit; lane B chose one reading, lane A another. Step 15 reconciled them by *documentation*, and the disagreement resurfaced twice more — as the `/code-review` finding #1 and then as the CRITICAL. One sentence in the plan's contract section would have closed it.
- **Interview answers laundered.** The four spec answers are recorded in SPEC-03 as *human-answered* and quoted verbatim, but the human never saw the questions — the orchestrator answered them under a standing "drive it autonomously" instruction. The spec's audit trail therefore overstates its provenance.
- **`/code-review` → `/security-review` blind spot.** `/code-review` looked at the same `run_locally` code and reported a *semantics* finding; nothing carried "this string is executed by a human" into the later security pass, which had to rediscover it from scratch.
- **Pre-existing test failures re-litigated four times.** Four separate agents each investigated the `depgraph-adapter` / `context-walk` failures and each reached the same conclusion independently; the base-commit worktree check that settled it was only run at the very end.

## Proposals

| # | Target | Change | Evidence | Expected effect | Cost |
|---|---|---|---|---|---|
| 1 | `.claude/skills/implement/SKILL.md` § Stage 3 + `.claude/agents/README.md` § The chain | Move `/security-review` into stage 3, run in the same message as `architecture-reviewer` and `/code-review`. Today it only appears inside `/pr-self-review` at stage 6. | The run's only CRITICAL was found at stage 6 in code written at stage 2; fixing it forced 2 extra `test-writer` passes (187 k) and a fixture repair | Removes a full late fix-loop; ≈200 k and ≈45 min off a comparable run | one-line stage edit in two files |
| 2 | `.claude/skills/implement/SKILL.md` § Stage 1 | Have stage 1 write `.claude/sdd/<slug>-brief.md` — the planner's **Context read** (binding rules with locators), the ownership table and the amendments — and make every delegation say "this brief is your Step 1; read only the files you will edit". | *Files read* shows ≈14 independent re-derivations of the same map | ≈250–350 k tokens; also removes the "agent read the wrong INSIGHTS" class | new template section + one line per delegation |
| 3 | `.claude/skills/pr-self-review/routing.md` § Delegation | For a feature diff > 1000 changed lines, run `/code-review medium` (not `high`) **together with** `/security-review` in one message, and spend the saved budget on the security pass. | `/code-review high` cost ≈400 k across 5 angle agents for 10 findings and still missed the exploitable one | ≈150 k saved, better finding mix | table row |
| 4 | `.claude/agents/README.md` § The chain (spec/plan gates) | State that when the human is unavailable, the main session may answer an interview **only** with the defaults the agent itself proposed, and must relay them as `default-assumed`, never as `human-answered`. | SPEC-03 records 4 orchestrator answers as *human-answered* | Keeps the spec's audit trail honest | 3-line rule |
| 5 | `.claude/agents/implementation-planner.md` § Contract & migration impact | Require the plan to pin, per wire field, **which side means what** when a field's meaning varies by variant (here: `label` = command vs description). | The `OnboardingLink` ambiguity surfaced three times: step 15, CR #1, and the CRITICAL | Removes a whole class of lane-to-lane disagreement | one bullet |
| 6 | process (main session) | Cap concurrent background agents at 3, and give each a scope it can finish in < 5 min; prefer two waves of 3 over one wave of 5. | All 3 watchdog stalls happened while ≥ 4 agents were streaming; ≈50 min of dead wall clock | Removes most of the dead time | orchestration habit |
| 7 | `.claude/agents/plan-verifier.md` § Scope | When a run has already produced an architecture review, a `/code-review` and a test suite, let the verifier grade **rows whose evidence changed** and accept the reviewers' verdicts for the rest, instead of re-deriving all 40 AC. | 145 k / 13 min, re-reading evidence three agents had already produced | ≈80 k, ≈7 min | scope paragraph |
| 8 | process (main session) | Settle "is this failure pre-existing?" **once**, at stage 2, with a base-commit worktree run, and put the answer in the run file. | 4 agents investigated the same 2–5 failures independently | small tokens, less noise in every later report | one line in the run file |

## Delta vs previous

First entry in this ledger — no prior run to compare against. Baseline for the next retro: ≈2.5 M tokens, 26 spawns, 5 h 28 min wall clock, 3 fix loops, 1 CRITICAL found at stage 6.

## Insight candidates for INSIGHTS.md

None new — the three engineering findings this run produced (Fastify body-less POST arrives as `null`; verbatim-only grounding of model-authored commands is unshippable; `find role link --name` does not resolve sidebar entries) were already recorded through `/engineering-insights` during the session, along with the root-level entry about cross-model plan review.
