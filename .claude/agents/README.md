# Agents

Subagents for this repo. Each runs in its **own** context window with its own
tool grant, and returns a report to whoever delegated to it. Canonical location
is `.claude/agents/`; shared with the team via version control.

## Catalog

| Agent | Model | Tools | `skills:` (preloaded) | Owns | May not |
|-------|-------|-------|-----------------------|------|---------|
| [spec-creator](spec-creator.md) | opus | `Read, Grep, Glob, Bash, Write, Edit, TodoWrite` | **none — and no `Skill` tool either.** A skill is a rulebook for writing code; a spec-writer holding one starts specifying the implementation. It reads `specs/README.md` for the template on every run instead of carrying a copy | Feature specs in `specs/` and `<package>/specs/` — EARS acceptance criteria with `AC-N` ids, each with a `(← source)` trace tag and a `· verify:` hint, edge cases, NFRs, input provenance, `[NEEDS CLARIFICATION]` — plus a critical read of the supplied design (uncovered states, corner cases, cross-module gaps, UX proposals), the interview and research handshakes, and a 9-point self-check before returning | Write anywhere else — no `docs/`, no `.claude/plans/`, no code, no `e2e/specs/*.flow.json`; write architecture specs; turn a UX proposal into an AC without a human's yes; write a half-spec next to an interview or open research question; fill in a fact `researcher` could not establish; read every `INSIGHTS.md` — only the touched modules' |
| [researcher](researcher.md) | sonnet | `Read, Grep, Glob, Bash, WebSearch, WebFetch, TodoWrite` | **none — and no `Skill` tool either.** A skill arrives as an instruction, and every rule this agent meets must arrive as *evidence*; it `Read`s a `SKILL.md` as a file and cites it | Answering "how does this repo do X" and "what do the upstream docs say", with locators for every claim | Change anything; enforce a rule it cited; return prose instead of the report format |
| [implementation-planner](implementation-planner.md) | opus | `Read, Grep, Glob, Bash, Write, TodoWrite, Skill` | **none.** `Skill`-loads at most three, and only when a Step-5 answer needs the rulebook to make a *plan* decision: `onion-architecture` to name a seam, `postgresql-table-design` + `drizzle-orm-patterns` to shape a new migration, `zod` for a wire-crossing contract. Most runs load nothing. `pr-self-review` is never loaded — it is a workflow, and preloading a workflow invites running it; the load-bearing part is `routing.md`, a companion file it `Read`s | Turning a spec (`specs/`, `<package>/specs/`) or stated requirements into an Implementation Plan in [`.claude/plans/`](../plans/README.md): the requirements review, the recommendations, the execution mode (multi-agent vs single-agent), and the skills each step needs | Write or edit a spec, or state acceptance criteria the spec/caller did not; `Edit` anything; write outside `.claude/plans/` or over an existing plan; run tests or builds |
| [implementer](implementer.md) | sonnet | `Read, Edit, Write, Grep, Glob, Bash, TodoWrite, Skill` | **none.** The plan's *Skills* column names them per step; it loads each `SKILL.md` with `Skill` when that step comes up — companion files (`references/`, up to 185 KB per skill) only on an explicit pointer | Executing a plan (or a fix-pass list) across `client/`, `server/`, `reviewer-core/`, `mcp/`, `e2e/`; verifying through `scripts/verify.mjs` — `--only` while iterating, the full slice once; returning **Insight candidates** | Commit, push, open a PR; touch the do-not-touch paths; write `INSIGHTS.md` (main session does, from its candidates); pass architecture or security verdict |
| [test-writer](test-writer.md) | sonnet | `Read, Edit, Write, Grep, Glob, Bash, TodoWrite, Skill` | **none.** Loads `react-testing-library` or `onion-architecture` by slice — every run uses exactly one, so preloading both put 20 KB of RTL into every backend run | Tests in all five packages against the spec's `AC-N` / `· verify:` hints: the right file name, the right lane, run through `scripts/verify.mjs` | Write anywhere outside its may-write table (`src/**` is production, including `mocks.ts`); weaken a test or adopt its output as the expectation; write `e2e/specs/*.flow.json`; commit |
| [architecture-reviewer](architecture-reviewer.md) | sonnet | `Read, Grep, Glob, Bash, TodoWrite, Skill` | **none.** Loads `onion-architecture` / `frontend-ui-architecture` for the slices the diff actually contains. **Not** `pr-self-review`, for the reason in the `implementation-planner` row | Boundary findings with `file:line` evidence, scored on `routing.md`'s scale; deterministic gates CRITICAL by construction | Write or edit anything; edit a `.dependency-cruiser.cjs` or grow a `GRANDFATHERED` list; hunt bugs or security |
| [plan-verifier](plan-verifier.md) | sonnet | `Read, Grep, Glob, Bash, TodoWrite` | **none — and no `Skill` tool either.** A verifier holding a rulebook becomes a second code reviewer within three findings | A verdict per plan requirement with a locator, the conformance verdict, plus the changes no requirement asked for. Runs **once, last** among the reviewers; a re-run with its previous report regrades only what was not `MET` | Write or edit anything; run a mutating command even when the plan names it; offer style, naming or refactor advice; mark MET on intent; ask a question |
| [doc-writer](doc-writer.md) | sonnet | `Read, Edit, Write, Grep, Glob, Bash, TodoWrite, Skill` | **none.** `mermaid-diagram` is loaded on demand, once a diagram has earned its place — most runs (a stale-doc patch, a reference table) produce no diagram at all | Docs for shipped behaviour, the diagrams, and the layering call about which section a piece belongs in | Write rules into `AGENTS.md`, entries into `INSIGHTS.md`, or specs into `specs/`; document unbuilt behaviour; run builds or tests |

### Not in the chain

`architecture-reviewer-lite.md` is an **eval fixture, not an agent to dispatch.**
It is a frozen copy of `architecture-reviewer.md` with one dimension removed —
every requirement to attribute a finding to a named documented contract — so that
`evals/agents/architecture-reviewer-lite/` can measure what that requirement buys.
The eval imports the *strict* variant's cases on purpose, so both are graded on an
identical task and the only thing that moves is attribution. It lives in this
directory because the eval loader reads `.claude/agents/<name>.md` by relative
path, which is also why it is a copy rather than an include.

**Re-sync it from `architecture-reviewer.md` before trusting a new measurement.**
The pair will drift, and a delta across a drifted pair measures the drift — so
that is no longer left to prose. `evals/src/artifacts/pairs.ts` holds a hash of
both files plus one marker per place the removed dimension appears, and both
`cd evals && pnpm eval:quality` and `pnpm vitest run src/` fail when either side
moves or a marker survives into the copy. After a deliberate re-sync, update the
two hashes there in the same commit; the failure message prints them.

The `skills:` field **preloads full skill bodies** into the agent's startup
context, on every run, and it cannot express a condition. That makes it the
wrong tool for anything routed: preloading ten skills so a body can then order
the model to ignore six of them spends ~25k tokens of standing attention to
*create* a distraction. So the bar is narrow — **preload only what every run of
that agent uses** — and today **no agent clears it**: `test-writer` and
`architecture-reviewer` used to preload their two rulebooks, but every run of
either uses exactly one half, so the other half was 8–20 KB of standing
attention per run. Everything is `Skill`-loaded at the moment its slice comes
up, which is also when the model is actually about to apply it. The `skills:`
field stays documented below for the day an agent genuinely needs it.

Companion files (`examples.md`, `rules/`, `references/`, and
`pr-self-review/routing.md`) are **never** preloaded either way and are opened
only on an explicit pointer from the `SKILL.md` for the question at hand — the
`references/` trees run to 185 KB (`fastify-best-practices`) and 171 KB
(`zod`), and "open them to be thorough" was the single biggest token sink in
an `implementer` run.

Never given to any of them: `security` (owned by `/security-review`, and the
vendored skill targets Express + Mongoose, not Fastify + Drizzle) and
`typescript-expert` (checklist-shaped, noisy).

Two agents have no `Skill` tool at all — `researcher` and `plan-verifier`.
Withholding the loader, not just the preload, is the point: loading a skill
mid-run injects exactly the same instructions the `skills:` field would have,
only later. `plan-verifier` asks whether a requirement was met, and any rulebook
in its context turns that into a second code review; `researcher` reports what
the rules *say*, and a rule it can invoke is a rule it starts enforcing.

Opus only where the judgement *is* the product and nothing downstream can
catch a bad call: `spec-creator` deciding what the feature is, and
`implementation-planner` reviewing the requirements and choosing how to build
them. Sonnet everywhere the judgement is fixed by something else — a plan that
names its files and commands (`implementer`), the source being described
(`doc-writer`), a question with a locatable answer (`researcher`) — **and, since
2026-08-18, for both reviewers.** `architecture-reviewer` and `plan-verifier`
were opus; they are the agents that run most often per feature (the fix loop
re-runs the reviewer, a re-verify re-runs the verifier), their outputs are
locator-shaped (`file:line` or it is not a finding; a locator or it is not
`MET`), and that discipline is what guards against a wrong call, not the
model. The trade is stated: a subtler boundary break may go unflagged; the PR
still passes `/pr-self-review` and CI's dependency-cruiser, so the cost of a
miss is bounded.

The model is per agent, not per step, so a reviewer also bills its model for
its mechanical half — running `depcruise`, listing a diff, reading exit codes.
Splitting those out means a second agent and a handoff for work that is three
commands long, and the handoff would cost more than it saves.

## The chain

```
spec-creator (opus)
   ├─ design supplied? → critical read: uncovered states, corner cases, cross-module gaps, UX proposals
   ├─ two readings → two different specs? → "## Interview required" → main session asks you → re-delegate with answers
   ├─ a fact it cannot grep decides an AC? → "## Research required" → main session fans out researcher ×N in parallel → re-delegate with reports
   └─ specs/SPEC-NN-<slug>-DD-MM-YYYY.md · <package>/specs/SPEC-NN-<slug>-DD-MM-YYYY.md  (Status: draft) → ⛔ YOU APPROVE IT ← a spec nobody read is a guess with ids
   ↓
implementation-planner (opus)
   ├─ requirements review → ambiguous / untestable / conflicting? + "multi-agent or single-agent?"
   │     → "## Interview required" → main session asks you → re-delegate with answers
   └─ .claude/plans/<slug>.md  (**Mode:** multi-agent | single-agent)
        │
        ├─ single-agent → the main session executes every step itself, in one pass,
        │                 then runs the reviews below by hand
        │
        └─ multi-agent — from here on, one command: /implement .claude/plans/<slug>.md
             → implementer (sonnet) — one, or several in parallel by file ownership
                  → report: Steps done/total · Deviations
                  → ⛔ done < total? → implementer again (same plan + its report) — no reviewer yet
                  → in parallel, all three produce rework, none writes code:
                       architecture-reviewer (sonnet) — boundaries, evidence-backed findings
                       /code-review                   — bugs (architecture-reviewer does NOT hunt them)
                       /security-review               — the exploit path (neither of the other two hunts it)
                  → fix loop: implementer fix pass → architecture-reviewer re-review (scoped to prior findings + new hunks)
                       … until PASS or --max-review-loops → ⛔ YOU accept the standing WARNINGs
                  → plan-verifier (sonnet)            — ONCE, on the settled tree, with the last implementer report
                       → INCOMPLETE? → implementer on the gaps → plan-verifier re-verify (previous report supplied)
                  → doc-writer (sonnet)              — once the behaviour has stopped moving
                       → /pr-self-review → /code-review · /security-review on the FINAL diff (confirmation; discovery was the stage above) → PR → spec Status: implemented (by hand)
```

The first two stages are **manual by decision** — you delegate to
`spec-creator`, read and approve the spec, delegate to `implementation-planner`,
read and approve the plan. From the approved plan on, one command runs the
rest with the delegation prompts and the human gates baked in:
[`/implement`](../skills/implement/SKILL.md). It logs stage state and agent
token cost to `.claude/sdd/<slug>.md`, and `--from <stage>` resumes it in a new
chat.

The planner asks the mode question on every run unless the delegation states
it, and the plan carries the answer as `**Mode:**` plus an **Executor** column.
Both modes produce the same plan headings — the difference is who takes each
step and where verification sits — so `plan-verifier` grades either.

**Why the order is what it is.** Everything that can send work back to
`implementer` runs together and early: `architecture-reviewer` (a CRITICAL),
`/code-review` (a bug) and — **since 2026-08-20** — `/security-review` (an
exploit path). Security used to run only inside `/pr-self-review`, at the very
end. On the L05 Onboarding run that put the only CRITICAL of the run six
stages downstream of the code that caused it, and paying for it late cost two
extra `test-writer` passes plus a fixture repair, because the tests had been
written against the unsafe shape
(`docs/retro/ledger/2026-08-19-l05-sdd-onboarding-generator.md`). A security
finding is rework like any other, so it belongs where the rework stage is. Then the fix loop — a fix can clear one boundary
break and open another, so the reviewer re-reviews after each pass, scoped to
its own prior findings plus the hunks that changed. Then `plan-verifier`
**once**, last, on a tree nobody is still editing: running it earlier means
grading a tree the fix loop is about to change and paying for the re-verify.
The cheap early completeness signal is the `implementer` report's own
`Steps: done/total` line, and it costs nothing to read.

**`test-writer` is off the default chain, by decision (token budget).** The
agent stays in the catalog and is delegated by hand — between the fix loop and
`plan-verifier` — when a feature needs a test pass; tell the planner "no
test-writer stage" so the plan carries no rows nobody executes. When it does
run: after `implementer`, against the spec's `AC-N` and their `· verify:`
hints. **No TDD** in either case — no red-tests-first checkpoint.

`doc-writer` runs **before** `/pr-self-review`, not after the PR is open. It
still goes last among the agents, because documenting a branch that is still
changing guarantees a stale doc — but the reviewers have settled by then, and
docs written after the PR either never land or land in a second PR nobody
connects to the first. Its output is uncommitted like everything else: you
commit it into the same branch, and the review sees the docs next to the diff
that produced them.

`spec-creator` writes the spec **before** the planner reads it — its ACs carry
the `AC-N` ids the plan's **Requirements review** and `plan-verifier` cite, so
a plan written against no spec has nothing stable to point at. The spec lands
as `draft`; moving it to `approved` is a human decision, and to `implemented`
follows `plan-verifier`'s `COMPLETE` — both are a **one-line edit made by hand**
(you, or the main session), not a re-delegation: an opus run to change one word
was the most expensive edit in the chain. `spec-creator` stays the only *agent*
that writes content into `specs/` (the lifecycle table is in
[`specs/README.md`](../../specs/README.md)). `scripts/check-specs.mjs` lints
the result in `pr-gate.yml`, so a duplicated `SPEC-NN` or a dropped heading is
a red check rather than something the prompt has to hold.

**Designs reach `spec-creator` through the delegation, not through tools.** Its
`tools:` list strips MCP, so it cannot open a Figma link. Before delegating,
export the frame yourself — a screenshot on disk it can `Read`, or a pasted
`get_design_context` dump — and name the path in the prompt. A bare link
produces an interview question, not a spec.

`researcher` is not on the chain: it answers questions, it is not a stage. Its
regular caller is `spec-creator`'s **research gate** — see the handshake below —
and any question you have yourself before choosing between approaches.

| Agent | Delegate to it when |
|-------|---------------------|
| `spec-creator` | a lesson item, feature or design needs a spec; a design (screenshot, mockup, description) has to become checkable requirements; an existing spec must be revised or superseded — and **before** `implementation-planner`, so the plan has `AC-N` ids to review |
| `test-writer` | **off the default chain** (token budget). By hand, after the fix loop and before `plan-verifier`, when a feature needs a test pass; a bug needs a regression test; a lane is red. Never before `implementer` |
| `architecture-reviewer` | `/implement` stage 3, in the same message as `/code-review`; then once per fix-loop iteration with its previous report (scoped re-review). Also by hand when a `depcruise` rule fails |
| `plan-verifier` | `/implement` stage 4 — after the fix loop, once, on a settled tree — with the last implementer report (else it cannot tell a declared deviation from a dropped requirement); on a re-run pass its previous report too |
| `doc-writer` | the reviews have settled, before `/pr-self-review`, so the docs are in the diff |

**No link calls the next one.** Two tools are absent from every subagent here,
and both shape the design above:

- **`Agent`** — none of the eight lists it, so none of them can spawn a
  subagent. This is our allowlist doing the work, not a platform guarantee:
  Claude Code lets subagents nest by default, up to a depth limit, and a
  subagent that inherited its tools *would* be able to. The `tools:` line is the
  whole mechanism. The main session is the orchestrator; there is no autonomous
  pipeline here, and trying to build one is the first thing people attempt.
- **`AskUserQuestion`** — removed from every subagent by the platform itself, so
  no `tools:` line is needed for it. A subagent cannot ask you anything mid-run,
  which is why the `spec-creator` and planner interviews are two-pass handshakes
  rather than inline questions, and why `researcher` returns
  `## Clarification required` instead of asking.

## Running the interview handshake

`spec-creator` and `implementation-planner` share one shape. When either returns
`## Interview required` instead of a file path:

1. Ask the questions it listed (it supplies a default for each, so an
   unanswered question is not a dead end). The planner's block also carries a
   **Requirements review** table and **Recommendations** — put those in front
   of the human too: a recommendation is only advice until the human accepts
   it, and an accepted one has to travel back as an answer. `spec-creator`'s
   block carries **What I can already commit to** instead — show it, so the
   human answers knowing what will not change.
2. Answer the **Execution mode** question — `multi-agent` or `single-agent`.
   It is asked on every run unless your delegation already stated the mode, so
   the cheap path is to state it up front.
   (`spec-creator` asks no mode question — its blocking questions are the ones
   where two answers produce two different specs.)
3. **Continue the same run** with `SendMessage` (the agent's id is in the
   `Agent` result), carrying the answers verbatim. Its context — the map it
   read, the review table — is intact, so it goes straight to writing. Only if
   the run is gone re-invoke fresh with the **original task and the answers**;
   answers alone, without the task, produce a plan for nothing.

   The earlier rule here was "always re-invoke fresh, so the answers are visible
   in the delegation". That bought auditability the plan file already provides
   — every answer lands verbatim under **Decisions taken**, tagged
   *human-answered* or *default-assumed* — and it cost a full opus re-read of
   `AGENTS.md`, `INSIGHTS.md`, the spec, `routing.md` and the workflows on
   nearly every planning run, because the mode question makes pass 1 an
   interview almost always. The plan is the record; the delegation never was.

```
Answers to your interview:
1. <question> → <answer>
2. <question> → <answer>
Execution mode: multi-agent | single-agent      (if it asked)
Recommendations accepted: <which ones, or "none">
```

The planner copies these into the plan's **Decisions taken** section, which is
the only durable record of the conversation.

## Running the research handshake

`spec-creator` may also return `## Research required` — alone or in the same
block as its interview. These are **facts**, not decisions: what an upstream API
does on a 404, how a behaviour is actually wired across three packages, what
prior art does with the same state. Its questions are independent by
construction, so:

1. Spawn one `researcher` per question, **all in the same message**, so they run
   in parallel — they share no state and each returns its own report with
   locators and a confidence. Pass each researcher the question verbatim plus
   the "Where to look" hint; do not merge two questions into one agent, because
   one report with two confidences is one the spec cannot cite cleanly.
2. Answer any interview questions in the same round (see above) — the human
   waits once, not twice.
3. Continue the `spec-creator` run (`SendMessage`) with the **interview answers
   and every research report verbatim** — including the ones that say "could
   not establish": an unresolved fact becomes a `[NEEDS CLARIFICATION]` with a
   default, and the agent has to see it to write it. (Fresh re-invoke with the
   original task only if the run is gone.)

```
Answers to your interview:
1. <question> → <answer>

Research reports:
1. <question> →
   <researcher report, verbatim>
2. …
```

`spec-creator` tags each fact *research-answered* or *research-unresolved* under
**Decisions taken** and cites the researcher's locator in the AC's `(← …)` tag,
so a reviewer can follow an AC back to the source that justified it. It caps
itself at three research questions per run; if it keeps coming back with more,
the request is bigger than one spec — split it.

## Permissions

`.claude/settings.json` denies `Edit`/`Write` on the three do-not-touch path
families from [`AGENTS.md`](../../AGENTS.md): `server/clones/**`, applied
`server/src/db/migrations/*.sql`, and `**/src/vendor/ui/**`. Those denies are
project-wide on purpose — they are repo rules, not agent rules.

Deliberately **not** denied there: `git commit`, `git push`, `gh pr create`,
`docker compose down`. A project-wide `Bash(git commit *)` deny would block your
own commits from the main session, so those restrictions live in the
implementer's prompt instead. That means the prompt is the only guard for them —
which is why they are stated as hard constraints rather than guidance.

The same applies to the read-only agents. `researcher`,
`architecture-reviewer`, `plan-verifier` and `doc-writer`'s shell access are
read-only because their `tools` list grants no `Edit` or `Write` (or, for
`doc-writer`, because the body scopes what it may write) — and because their
bodies close the `Bash` loophole. `.claude/settings.json` cannot help here: a
project-wide `Bash` deny would break the main session too.

### Why the `Bash` guard is an allowlist, and why there is no hook

Every read-only body frames `Bash` as **"only inspection commands run"**, then
lists the tempting bypasses as examples rather than as the rule. That inversion
is deliberate. An enumeration of banned tricks is never finished — the obvious
five (`>`, `tee`, `sed -i`, `patch`, `git apply`) leave `cp`/`mv`/`rm`/`touch`,
`node -e 'fs.writeFileSync(…)'` (Node is guaranteed present; the gates run on
it), `python -c`, `perl -i`, `git restore/stash/clean`, and every `gh` write
subcommand. The allowlist closes all of them at once and stays closed as new
ones appear.

Claude Code does support a stronger mechanism: **per-agent `hooks:` in
frontmatter**, where a `PreToolUse` hook scoped to one subagent can exit 2 and
refuse a write-shaped `Bash` command without touching the main session. That
would make these guards deterministic rather than persuasive, and it is the
obvious next step for the two agents whose verdicts gate a branch.

It is **out of scope here on purpose**: this repo's agent layer is skills and
agent definitions, and a hook is a third moving part — a script to maintain,
a workspace-trust prompt to accept, and a failure mode (a crashed guard) that is
invisible from the agent file it protects. The trade is stated rather than
hidden: these bans are prompt-enforced, a determined model can route around
them, and the mitigations are the allowlist framing above plus the **Files
touched** section that makes every write auditable in the report. If that stops
being enough, the fix is a hook, not a longer list of banned tricks.

## Writing a new agent

Frontmatter, minimal and portable across Claude Code builds:

```yaml
---
name: <matches the filename>
description: <what it does + when to delegate to it + what it is NOT for>
tools: <explicit allowlist — omitting the field inherits everything, including MCP tools>
skills:                     # a YAML list, preloaded in full on every run
  - <skill-name>            # — or omit the field entirely, which is the default here
model: opus | sonnet | haiku | inherit
---
```

Only `name` and `description` are required; the other three are the levers that
matter here. Claude Code accepts more fields than these (`hooks`,
`permissionMode`, `memory`, `maxTurns`, `effort`, `isolation`, …) — keep to this
set unless a new agent genuinely needs one, so eight agents stay comparable at a
glance. See the Permissions section above for the one we deliberately left on
the table.

Write `skills:` as a **YAML list**, not a comma-separated string. A skill that
does not resolve is **skipped silently** — a line in the debug log and nothing
else — so a preload can be absent for weeks while the body keeps telling the
model to apply it. After changing the field, run `claude --debug` once and
confirm the skill is actually loaded rather than assuming it.

- The `description` is the only thing the main session sees when deciding to
  delegate. Make it name concrete triggers *and* explicit boundaries; "Not for
  X" prevents more bad delegations than any amount of detail about X. And it is
  a standing cost: it sits in every main-session
  context, whether or not the agent is ever called. Make it a *trigger*, not a
  précis of the body — every sentence that restates behaviour the agent already
  states to itself is paid for on every turn of every session.
- An explicit `tools` list is an allowlist and also strips MCP tools — grant the
  minimum. A read-only agent gets no `Edit` **and** must close the loophole in
  its own body with an allowlist ("only inspection commands run"), never with a
  list of banned tricks — `Bash` writes files through redirects, `tee`,
  `sed -i`, `git apply`, `cp`, `node -e`, and whatever is invented next.
  Withholding `Skill` is a real lever too, not an oversight — see
  `plan-verifier` and `researcher`.
- `skills:` **preloads full skill bodies** unconditionally, on every run. It
  cannot express a condition, so preload only what every run of that agent
  needs and leave the rest to on-demand `Skill` loading. Companion files
  (`examples.md`, `rules/`, `references/`, `pr-self-review/routing.md`) are
  never preloaded either way.
- The body is the system prompt. The house shape, set by `researcher.md`:
  **hard constraints → method → output format → output discipline**. State the
  return format explicitly; the report *is* the return value. Every prohibition
  carries its *why* — a constraint without a reason is one the next model talks
  itself out of.
- **Never copy an enforceable fact into a prompt.** Rule names from a
  `.dependency-cruiser.cjs`, script names from a `package.json`, path filters
  from a workflow, a `skip-worktree` flag: all of them drift, none of them
  announce it, and a prompt that implies a live rule does not exist invites the
  model to soften a deterministic failure. Name the file the agent can read and
  give it the command to read it. `architecture-reviewer` shipped with
  hardcoded lists of 9 server and 7 client rules while the configs held 12 and
  10 — nobody noticed until a review went looking.
- Add a row to the catalog above in the same change, with the cells copied from
  the frontmatter verbatim. Nothing checks this file against the agents it
  documents, and it has drifted before.
