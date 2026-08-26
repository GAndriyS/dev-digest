---
name: implement
description: Executes an approved Implementation Plan end to end from one command — /implement <plan path> [--max-review-loops N] [--from plan|implement|find|verify|docs|pr]. Drives implementer → (architecture-reviewer ∥ /code-review ∥ /security-review) → the fix loop → plan-verifier → doc-writer → /pr-self-review, stops at the human gates (accepted warnings, deviations, PR), and records stage state + agent token cost in .Codex/sdd/<slug>.md (plus a <slug>-brief.md every delegation reads as its Step 1) so a later chat can resume with --from. Spec and plan are NOT part of it — run spec-creator and implementation-planner by hand first; this starts once .Codex/plans/<slug>.md exists. Use when the user invokes /implement, says "implement the plan", or wants to continue an implementation run. Not a subagent — the main session executes it.
metadata:
  version: 1.1.0
  tags: sdd, implement, workflow, orchestration, subagents, plan, command
---

# /implement — run an approved plan

You (the main session) are the orchestrator. Every agent runs in its own
context, returns a report and cannot call the next one — `Agent` is in no
subagent's `tools` list, deliberately (`.Codex/agents/README.md`). This skill
is the order, the gates and the delegation prompts.

**Before this command:** the spec (`spec-creator`, approved by hand) and the
plan (`implementation-planner`, approved by hand) already exist — both are run
manually, on purpose, so a human reads each before anything is built. This
command starts at the plan.

## Arguments

```
/implement <plan path> [--max-review-loops <n>=3] [--from plan|implement|find|verify|docs|pr] [--slug <name>]
```

| Argument | Meaning |
|---|---|
| `<plan path>` | `.Codex/plans/<slug>.md`. Required — `implementer` and `plan-verifier` refuse to guess a plan. If omitted and exactly one plan exists, take it and say so; otherwise list and stop |
| `--max-review-loops` | Cap on the architecture fix loop (stage 3b). Default 3 |
| `--from` | Resume at a stage; reads `.Codex/sdd/<slug>.md` for the earlier stages' reports |
| `--slug` | Overrides the run slug (default: the plan file's slug) |

## Stage 1 — read the plan before anyone runs

Nothing is delegated until the plan has been turned into an **execution
brief** — the tasks, their DAG, who owns which paths, and the mode. This is
the step that decides whether one `implementer` runs or four, and in what
order; skipping it is how two lanes edit the same file.

Read the whole plan file with `Read`, then extract:

1. **Header** — `**Mode:**` (multi-agent | single-agent), `**Spec:**` and its
   status, `**Slices:**`, `**Supersedes:**`. A spec still `draft` → one
   `AskUserQuestion`: build on a draft, or stop and approve it first.
2. **Tasks** — every row of the **Steps** table: `#`, Change, Files / seams,
   Slice, Satisfies, Executor, Skills, Verification, and **Depends on** (the
   column plans written after 2026-08-18 carry). Keep only rows whose Executor
   is `implementer` (or `single pass`) for the run; rows for `main session`,
   `doc-writer` or `test-writer` are listed as *not this run*.
3. **DAG** — from **Depends on**. When the column is absent (older plans),
   infer edges and **say so**: two steps that name the same file, or where one
   step's Files / seams is imported by another's, are ordered as the table
   orders them; contracts (`**/vendor/shared/**`) precede their consumers; a
   migration precedes the repository that reads it. An inferred DAG is
   confirmed at the gate below, never silently acted on.
4. **Owned paths** — from the plan's **Ownership** table when the **Execution**
   section has one; otherwise from each step's Files / seams. Two steps that
   would run in parallel and touch one path collapse into one lane. Every path
   belongs to exactly one lane; a path no step names but the work will
   obviously touch (`client/src/vendor/shared` mirror of a server contract) is
   flagged as an ownership gap.
5. **Waves** — topological order over the DAG: wave 1 = steps with no
   dependencies, wave *n* = steps whose dependencies are all in earlier waves.
   Steps in one wave with disjoint owned paths run in parallel; steps sharing
   a path serialise into one lane. Single-agent mode is one wave of one lane —
   the DAG still fixes the order you take the steps in.

Print the brief (this is also the first block of the run file):

```markdown
## Execution brief — <slug>
Mode: multi-agent · Spec: <path> (approved) · Slices: backend, frontend, contracts · Steps this run: 6 of 8 (rows 7–8: main session, doc-writer)
DAG: stated in plan | inferred (see notes)

| Wave | Lane | Steps | Owns (paths) | Depends on | Slice(s) | Verification |
|---|---|---|---|---|---|---|
| 1 | A | 1, 2 | server/src/vendor/shared/contracts/brief.ts, client/src/vendor/shared/… | — | contracts | verify.mjs --slice backend --slice frontend --slice mcp |
| 2 | B | 3, 4 | server/src/modules/brief/** | 1 | backend | verify.mjs --slice backend |
| 2 | C | 5 | client/src/app/pulls/[id]/_components/Brief/** | 2 | frontend | verify.mjs --slice frontend |
| 3 | — | 6 (integration) | — | 3, 4, 5 | backend + frontend | verify.mjs --slice backend --slice frontend |

Notes: <inferred edges · ownership gaps · rows not this run · anything in Open questions the executor inherits>
```

### The handoff brief — `.Codex/sdd/<slug>-brief.md`

Write it in this stage, once, and commit it with the run file. It is what every
delegation points at instead of making each agent re-derive the same map:

```markdown
# Handoff brief — <slug>
Spec: <path> (<status>) · Plan: <path> · Branch: <name> · Base: <merge-base sha>

## Binding rules (locators, not prose)
<the plan's **Context read**, verbatim — every rule with its `path:line`>

## Ownership
<the plan's Ownership table, or the brief's own if the plan had none>

## Amendments in force
<the plan's accepted review amendments, if any — these override step rows>

## Known pre-existing failures
<filled in at stage 2 from the base-commit check; "none observed yet" until then>
```

Then every delegation opens with:

```
Your Step 1 is .Codex/sdd/<slug>-brief.md — read it instead of re-deriving the
context. Beyond it, read only the files you will edit (and their tests).
```

**Why.** On the run this comes from, all fourteen agents whose reports carried
a *Files read* section opened it with root `AGENTS.md`, the package
`AGENTS.md`, the module `INSIGHTS.md`, the spec and the plan — the same
unchanged context, re-derived ~14 times at 15–25k a sweep. The brief is
written once by the party that already holds it. It does **not** replace an
agent reading the code it is about to change, and an agent that finds the brief
wrong says so in its report rather than silently re-deriving.

**Gate:** `AskUserQuestion` — "Run with this split? (N waves, M parallel
lanes at the widest, DAG stated | inferred)". Options: *run as shown* /
*serialise everything into one lane* / *edit* (the human names the change; you
regenerate the brief). Do not delegate before this answer. Then commit the run
file with the brief.

Echo one line when done — `slug · mode · waves · lanes · from` — and go to
stage 2.

## The run file — `.Codex/sdd/<slug>.md`

Created at the first stage (or at `--from`) next to
`.Codex/sdd/<slug>-brief.md`, appended after every stage, committed with the
branch. It is what makes the "new chat" possible: the next
session reads it and continues.

```markdown
# Implementation run: <slug>
Plan: <path> · Spec: <path> (<status>) · Mode: multi|single · Branch: <name>

| Stage | Result | Agent tokens | Note |
|---|---|---|---|
| 1 read plan | 3 waves · 4 lanes | — | DAG inferred, confirmed |
| 2 implement | 7/7 | 92k + 12k | 1 re-delegation |
| 3 find | arch: 1 CRIT 3 WARN · cr: 2 | 20k ∥ — | |
| 3b review loop | PASS after 2 loops | 15k + 11k | WARN #2, #3 accepted by human |
| 4 verify | COMPLETE | 24k | |
| 5 docs | docs/blast-radius.md | 9k | |
| 6 pr | #14 | — | spec → implemented |

## Reports
<latest implementer report · latest architecture review · plan-verifier
report — verbatim; a newer version replaces the older one>
```

Token counts come from each `Agent` result. This table is the only place
"the reviewers are expensive" ever becomes a number.

## Stage map

| # | Stage | Who | Gate |
|---|---|---|---|
| 1 | read the plan | you — execution brief: tasks, DAG, owned paths, waves, mode | ⛔ **Human confirms the split** (run as shown / one lane / edit) |
| 2 | implement | `implementer` (sonnet), wave by wave per the brief — one lane or N in parallel, then the integration step | Report `Steps: N/N`. `done < total` → same delegation again with the report; **no reviewer yet** |
| 3 | find | `architecture-reviewer` (sonnet) ∥ `/code-review` ∥ `/security-review` — one message | Collect CRITICAL / WARNING / bugs into one findings list. Empty → stage 4 |
| 3b | review loop | `implementer` fix pass → `architecture-reviewer` re-review (scoped) → … until PASS with no open item, or `--max-review-loops` | ⛔ **Human decides** on WARNINGs left standing and on a loop that hit the cap |
| 4 | verify | `plan-verifier` (sonnet), **once**, with the last implementer report; `INCOMPLETE` → implementer on Gaps → re-verify with the previous report | `COMPLETE`, or ⛔ `DEVIATED` the human accepts |
| 5 | docs | `doc-writer` (sonnet) | Commit docs |
| 6 | pr | `/pr-self-review` (re-runs `/code-review` + `/security-review` on the FINAL diff — a confirmation pass; the discovery pass was stage 3) → PR; spec `Status: → implemented` by hand in the same commit | ⛔ Human opens the PR |
| 7 | wrap-up | `/engineering-insights` with every report's **Insight candidates**; finish the run-file table | — |

**`test-writer` is not in this chain — by decision, to save tokens.** The
plan's Executor column may still name it; those rows are reported by
`implementer` under *left to others* and by `plan-verifier` as `NOT MET`
unless the plan was written without them. Tell the planner up front (in the
delegation: "no test-writer stage; test coverage is the implementer's step or
out of scope") so the plan does not carry rows nobody executes. When a feature
genuinely needs a test pass, run `test-writer` by hand between stages 3b and
4 — it is still in `.Codex/agents/`.

`--mode single` in the plan header: stage 2 is you, in one pass; stages 3–7
unchanged.

**Human gates use `AskUserQuestion`** (you have it; subagents do not). One
question, the artifact path, a 3-line summary. Whole reports go to the run
file, not the chat.

## Stage 2 — implement, wave by wave

Follow the brief. One wave at a time; the next wave starts only when every
lane of the current one reported `Steps: N/N` for its rows.

A wave with one lane, or single-agent mode collapsed to one lane:

```
Execute the plan .Codex/plans/<slug>.md, steps <n, m, …> (wave <w>). Take only those rows.
```

A wave with several lanes — **one message, one `Agent` call per lane**:

```
Execute the plan .Codex/plans/<slug>.md, lane <A> of wave <w>: steps <n, m, …>.
You own: <paths from the brief>. You must not touch: <the other lanes' paths, listed>.
Steps <…> from earlier waves are done — build on them, do not redo them.
Other lanes run in parallel on their own paths.
```

The integration step (the last wave, when the plan has one) is its own
delegation once every lane before it reported.

**At most 3 agents in flight at once, and scope each so it finishes inside
~5 minutes.** Two waves of three beat one wave of five: on the run this rule
comes from, all three stream-watchdog stalls (600s each, plus a resume
round-trip) happened while four or more agents were streaming, and that dead
wall clock — ~50 minutes with the two transient API deaths — was the single
largest non-working span of the run. A lane that cannot be cut below ~5
minutes is a lane the plan should have split.

**Settle "is this failure pre-existing?" once, here, and write the answer into
the run file.** The first lane report that comes back red on a test nobody
touched gets ONE check — a worktree at the merge base, the same lane command,
the verdict recorded as a line in `.Codex/sdd/<slug>.md`:

```bash
git worktree add /tmp/<slug>-base $(git merge-base origin/main HEAD)
# run the failing lane there, then: git worktree remove --force /tmp/<slug>-base
```

Every later delegation then carries "known pre-existing: <names> (verified on
<sha>)". Without it the same two or three failures get re-investigated by
every agent that runs a lane — four separate agents did exactly that on the
run this rule comes from, each reaching the same conclusion independently, and
the check that settled it was only run at the very end.

Read each report's first line. `Steps: 5/7` → the same delegation again with:

```
Your previous report follows. Finish steps <n, m>; do not redo the rest.
<report verbatim>
```

## Stage 3 — find (one message, three calls)

```
[architecture-reviewer]
Review the diff of this branch against origin/main plus uncommitted changes. Plan for context: .Codex/plans/<slug>.md.

[/code-review]      — invoke the skill in the same turn
[/security-review]  — invoke it in the same turn too
```

**`/security-review` runs HERE, not at stage 6** (retro
`docs/retro/ledger/2026-08-19-l05-sdd-onboarding-generator.md`). It used to
run only inside `/pr-self-review`, which meant the one CRITICAL of that run —
model-authored shell commands presented to the user with a Copy button — was
found six stages after the code was written, and fixing it cost two extra
`test-writer` passes (187k tokens) plus a fixture repair, because the tests
had already been written against the unsafe shape. Security findings send work
back to `implementer` exactly like a boundary break or a bug does, so they
belong in the stage where everything that can send work back runs together.
It still runs again inside `/pr-self-review` at stage 6, on the final diff —
that pass is now a confirmation rather than a discovery.

**Diff budget.** On a feature diff over ~1000 changed lines, invoke
`/code-review medium` here rather than `high`, and spend the difference on the
security pass: at `high` the review fans out to eight angle agents (~400k
tokens on that run) for a finding set the security pass then has to
re-examine anyway. Under ~1000 lines, `high` is still the default.

Findings list = every CRITICAL, every WARNING (see the loop for which ones go
in when), every `/code-review` finding you judge real, every `/security-review`
finding at WARNING or above. Note the SHA of the tree
the reviewer saw (`git rev-parse HEAD` + whether the tree was dirty) — the
re-review is scoped to what changed after it.

## Stage 3b — the architecture review loop

A fix can clear one boundary break and open another, and a WARNING the human
wants fixed is a fix like any other. Loop, `loop = 1..--max-review-loops`:

1. **Fix pass** — `implementer`, the findings list is its step list:

   ```
   Fix pass <loop> on .Codex/plans/<slug>.md. Address exactly these items and nothing else:
   1. <finding — file:line — source report — what would clear it>
   2. …
   Run scripts/verify.mjs on the touched slices before reporting.
   ```

   CRITICALs and `/code-review` bugs always go in. WARNINGs go in on loop 1
   when they are cheap and obviously right (a Drizzle type leaking into a
   service signature); the rest wait for the gate.

2. **Re-review** — `architecture-reviewer`, scoped:

   ```
   Re-review this branch. Your previous report follows — for each prior finding, confirm it is cleared (locator) or still open; then review only the hunks changed since <sha> (`git diff <sha>` + uncommitted). Do not re-review unchanged code.
   <previous architecture review verbatim>
   ```

3. **`/code-review` bugs** are not re-reviewed by an agent in the loop: after
   the fix pass run `node scripts/verify.mjs --slice <s>` yourself and read
   the lines; `/pr-self-review` runs `/code-review` again on the final diff at
   stage 6.

4. Exit when the re-review says `PASS` **and** every listed item is cleared or
   accepted. Gate: `AskUserQuestion` with the WARNINGs still standing —
   *accept* (record in the run file, note in the PR body) or *fix* (another
   loop). Cap reached with items open → the same question plus "N more loops /
   stop and take it to the PR as is".

Record each loop's tokens — this is the stage most likely to surprise.

## Stage 4 — verify (once)

```
Verify .Codex/plans/<slug>.md against this branch. Stage: final.
Implementer report:
<the last one — after the fix loop>
```

`INCOMPLETE` → fix-pass delegation with the **Gaps** section as the list, then:

```
Re-verify .Codex/plans/<slug>.md. Stage: final. Previous verification report follows — regrade only what was not MET, redo unrequested changes and the lane table.
<previous plan-verifier report verbatim>
<implementer fix-pass report verbatim>
```

`DEVIATED` → gate: the human accepts the deviation or sends it back.

## Stage 5 — docs

```
Document the behaviour that landed on this branch for .Codex/plans/<slug>.md / <spec path>. The reviews are settled; nothing is still moving.
```

Commit the docs.

## Stage 6 — PR

`/pr-self-review`; accepted WARNINGs and any `DEVIATED` verdict go into the PR
body under their own heading; the human opens the PR. Flip the spec to
`implemented` by hand in the same commit.

## Stage 7 — wrap-up

`/engineering-insights` with the **Insight candidates** from every report;
finish the run-file table (every stage, every token count); commit the run
file. `/workflow-retro` is **not** part of this stage — the human runs it by
hand when they want a retrospective of the run; do not invoke it from here.

## Resuming (`--from`)

Read `.Codex/sdd/<slug>.md`, take the latest reports from it, start at the
named stage. Never re-run a finished stage to "refresh" it. Run file missing →
say so and start at stage 2.

## What you must not do

- Run stage 3 or 4 while stage 2 is incomplete.
- Skip the re-review after a fix pass, or run a full un-scoped re-review.
- Run `plan-verifier` before the fix loop closed, or twice without its
  previous report.
- Delegate without the plan name, or hand `plan-verifier` no implementer
  report — every declared deviation would grade `NOT MET`.
- Let a subagent write `INSIGHTS.md` or flip a spec status; both are yours.
- Ask an agent to commit; none can — you commit between stages.
- Run `spec-creator` or `implementation-planner` from here. They are manual.
