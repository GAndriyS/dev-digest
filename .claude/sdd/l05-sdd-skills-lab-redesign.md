# Implementation run: l05-sdd-skills-lab-redesign
Plan: .claude/plans/l05-sdd-skills-lab-redesign.md · Spec: specs/SPEC-02-skills-lab-redesign-18-08-2026.md (approved) · Mode: multi · Branch: L05-SDD

| Stage | Result | Agent tokens | Note |
|---|---|---|---|
| 1 read plan | 5 waves · 3 lanes at widest | — | DAG stated in plan; human: run as shown |
| 2 implement | 10/10 steps · 359 tests · e2e 10/10 | 1.22M | 7 delegations, no re-delegation; wave 5 fixed 2 seam defects |
| 3 find | arch: PASS 0 CRIT 0 WARN 2 SUGG · /code-review: 3 bugs | 127k ∥ main session | code-review run at `high` in the main session |
| 3b review loop | PASS after 1 loop | 128k + 57k | 3 bugs + SUGGESTION #1 fixed; SUGGESTION #2 left standing |
| 4 verify | 46 MET · 0 PARTIAL · 0 NOT MET · 0 gaps | 138k | verdict INCOMPLETE only because rows 11–12 run after it; e2e UNVERIFIABLE for the agent (no mutating commands) but run green 10/10 in waves 4 and 5 |
| 5 docs | — | — | plan row 11 (doc-writer) |
| 6 pr | — | — | plan row 12 (spec Status → implemented, PR body) |

## Execution brief — l05-sdd-skills-lab-redesign
Mode: multi-agent · Slices: frontend, e2e, meta · Steps this run: 10 of 12 (row 11: doc-writer · row 12: main session)
DAG: stated in plan

| Wave | Lane | Steps | Owns (paths) | Depends on |
|---|---|---|---|---|
| 1 | — | 1 | `client/src/lib/use-media-query.ts`, `client/src/test/setup.ts` | — |
| 2 | — | 2 | `skills/{layout,page}.tsx`, `SkillsLabShell/**`, `SkillsListView/**`, `SkillPreviewPane/**` (delete), `SkillDetailView/**`, `messages/en/skills.json` (frozen after) | 1 |
| 3 | A | 3 | `SkillsListView/**` | 2 |
| 3 | B | 4 → 7 → 8 | `SkillEditor/{constants.ts,SkillEditor.tsx}`, `{ConfigTab,ContextTab,StatsTab}/**`, `skills/helpers.ts`, `SkillCard/helpers.ts` | 2 |
| 3 | C | 5 | `SkillEvalRun/**`, `SkillDetailView/**`, `EvalsTab/**` | 2 |
| 4 | — | 6, then 9 | `SkillsLabShell/**`, `ConfigTab/**`, dirty seam; `e2e/specs/08-skills.flow.json` | 3,4,5 · 2,4 |
| 5 | — | 10 (integration) | anything from 1–9 | 3,6,7,8,9 |

## Accepted / left standing

- **architecture-reviewer SUGGESTION #2 — accepted as is.** `useMediaQuery` lives in `client/src/lib/` with exactly one consumer (`SkillsLabShell`). The reviewer's own note: generic infra with no domain knowledge, and `theme.tsx`/`toast.tsx`/`providers.tsx` already establish `src/lib/` as the home for that class of hook; "no fix required now". Goes in the PR body.

## Commits

| Commit | What |
|---|---|
| 2a0a182 | step 1 — `useMediaQuery` + `matchMedia` test stub |
| 9aadcd2 | step 2 — master-detail layout, list column, select prompt |
| 30ef29b | steps 3,4,5,7,8 — Context tab, keyboard list, Run on evals, body tokens, stats links |
| 6a8a04f | steps 6,9 — unsaved-changes gate, e2e flow |
| 74d7afe | step 10 — integration pass over the lane seams |
| 9fab778 | fix pass 1 — 3 `/code-review` bugs + architecture SUGGESTION #1 |

## Reports

### /code-review (high) — 3 findings, all fixed in 9fab778

1. `ConfigTab.tsx:40` — flipping `enabled` on a left-column card makes the right-column form falsely dirty (`useUpdateSkill` primes `["skill", id]` under an untouched form): false AC-7 discard prompt, and Save PUTs the stale value back, silently reverting the toggle. New in the redesign — before it, list and editor were separate screens.
2. `use-media-query.ts:19` — default `true` means "matches", but the only caller passes a `max-width` query, so every desktop first paint rendered the narrow single-column layout (no list at all on `/skills/:id`) until hydration. The jsdom stub returns `false`, so no test saw it.
3. `SkillsLabShell/helpers.ts:11` — `decodeURIComponent` on the raw path segment throws `URIError` on a malformed escape, taking down the whole layout instead of showing "Skill not found".

### architecture-reviewer — PASS (0 CRITICAL, 0 WARNING, 2 SUGGESTION)

Machine gates clean: client depcruise 0 (430 modules), check-ui-conventions 0 (4 grandfathered barrels, pre-existing and unchanged). Verified as correct rather than trusted: the app's first nested `layout.tsx`; the `SkillEvalRun` and `SkillDirtyGate` contexts (right seams, right levels); the helper moves; the drawer rename; `SkillsLabShell` reaching `DEFAULT_TAB` through `SkillEditor`'s public barrel.

- SUGGESTION #1 — `typeColor`/`isUntrusted` left at route level after this branch deleted their second consumer (`SkillPreviewPane`), docstring still citing it → fixed in 9fab778.
- SUGGESTION #2 — `useMediaQuery` in `src/lib/` with one consumer → accepted, see above.

Scoped re-review after the fix pass: **PASS, no findings**; SUGGESTION #1 confirmed cleared.

### Insight candidates (for /engineering-insights at wrap-up)

- `client` — a form seeded from a server-owned prop via `useEffect(…, [prop.id])` silently goes dirty, and on Save reverts a concurrent background write, whenever that same record is mutated elsewhere on screen without the id changing. The fix is a per-field "follow only if still equal to the last-seen value" merge. Reaches any master-detail layout where a list control and a detail form edit the same field.
- `client` — when a plan splits file ownership so a shared UI-state seam must cross a component another lane owns, prop-drilling is not available even between ancestor and descendant; the seam is a colocated React context, and it belongs in the plan's Ownership table explicitly rather than being inferred from the "must not touch" list.
- `client` — there was no responsive pattern and no nested `layout.tsx` anywhere in the client before this branch, so an AC about viewport width introduces a mechanism from scratch (plus a jsdom `matchMedia` stub) rather than following an existing screen.
- `client` — RTL's `getByDisplayValue` normalises the element's value but not a plain-string query, so an exact multi-line string never matches a multi-line `<textarea>`; use a regex.
- `e2e` — `find text "<label>" click` can report success and click nothing on this app's `<Button>` components (label wrapped in nested markup); `find role button click --name "<label>"` is the reliable locator. Same silent-no-op family as the 2026-08-18 entry.
- root — this machine's Bash tool starts with a Windows-style `PATH`, which POSIX `PATH`-splitting cannot parse; `node`/`npm`/`pnpm`/`docker`/`git` and even `cat`/`ls` read as "not found" until `PATH` is rebuilt with `/c/…` entries, and it must be exported in the same call that uses it (shell state does not persist).
