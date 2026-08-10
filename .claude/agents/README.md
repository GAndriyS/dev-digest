# Agents

Subagents for this repo. Each runs in its **own** context window with its own
tool grant, and returns a report to whoever delegated to it. Canonical location
is `.claude/agents/`; shared with the team via version control.

## Catalog

| Agent | Model | Tools | `skills:` (preloaded) | Owns | May not |
|-------|-------|-------|-----------------------|------|---------|
| [researcher](researcher.md) | sonnet | `Read, Grep, Glob, Bash, WebSearch, WebFetch, TodoWrite` | **none — and no `Skill` tool either.** A skill arrives as an instruction, and every rule this agent meets must arrive as *evidence*; it `Read`s a `SKILL.md` as a file and cites it | Answering "how does this repo do X" and "what do the upstream docs say", with locators for every claim | Change anything; enforce a rule it cited; return prose instead of the report format |
| [planner](planner.md) | opus | `Read, Grep, Glob, Bash, Write, TodoWrite, Skill` | **none.** `pr-self-review` is a workflow, and preloading a workflow invites running it; the load-bearing part is `routing.md`, a companion file no preload would have brought in anyway | Turning a request into a Development Plan in [`.claude/plans/`](../plans/README.md), incl. the skills each step needs | `Edit` anything; write outside `.claude/plans/`; run tests or builds |
| [implementer](implementer.md) | sonnet | `Read, Edit, Write, Grep, Glob, Bash, TodoWrite, Skill` | **none.** The plan's *Skills* column names them per step; it loads each one with `Skill` when that step comes up | Executing a plan across `client/`, `server/`, `reviewer-core/`, `e2e/`; running the touched lanes; recording insights at the end | Commit, push, open a PR; touch the do-not-touch paths; pass architecture or security verdict |
| [test-writer](test-writer.md) | sonnet | `Read, Edit, Write, Grep, Glob, Bash, TodoWrite, Skill` | `react-testing-library`, `onion-architecture` — the two needed on every run of their half; the seven that shape *production* code stay on demand | Tests in all four packages: the right file name, the right lane, and running the lane it touched | Write anywhere outside its may-write table (`src/**` is production, including `mocks.ts`); weaken a test or adopt its output as the expectation; write `e2e/specs/*.flow.json`; commit |
| [architecture-reviewer](architecture-reviewer.md) | opus | `Read, Grep, Glob, Bash, TodoWrite, Skill` | `onion-architecture`, `frontend-ui-architecture` — its whole remit is those two skills' non-mechanical half. **Not** `pr-self-review`, for the reason in the `planner` row | Boundary findings with `file:line` evidence, scored on `routing.md`'s scale; deterministic gates CRITICAL by construction | Write or edit anything; edit a `.dependency-cruiser.cjs` or grow a `GRANDFATHERED` list; hunt bugs or security |
| [plan-verifier](plan-verifier.md) | opus | `Read, Grep, Glob, Bash, TodoWrite` | **none — and no `Skill` tool either.** A verifier holding a rulebook becomes a second code reviewer within three findings | A verdict per plan requirement with a locator, the conformance verdict, plus the changes no requirement asked for | Write or edit anything; run a mutating command even when the plan names it; offer style, naming or refactor advice; mark MET on intent; ask a question |
| [doc-writer](doc-writer.md) | sonnet | `Read, Edit, Write, Grep, Glob, Bash, TodoWrite, Skill` | **none.** `mermaid-diagram` is loaded on demand, once a diagram has earned its place — most runs (a stale-doc patch, a reference table) produce no diagram at all | Docs for shipped behaviour, the diagrams, and the layering call about which section a piece belongs in | Write rules into `AGENTS.md`, entries into `INSIGHTS.md`, or specs into `specs/`; document unbuilt behaviour; run builds or tests |

The `skills:` field **preloads full skill bodies** into the agent's startup
context, on every run, and it cannot express a condition. That makes it the
wrong tool for anything routed: preloading ten skills so a body can then order
the model to ignore six of them spends ~25k tokens of standing attention to
*create* a distraction. So the bar is narrow — **preload only what every run of
that agent uses**, which today is true for exactly two agents. Everything else
is `Skill`-loaded at the moment its slice comes up, which is also when the
model is actually about to apply it.

Companion files (`examples.md`, `rules/`, `references/`, and
`pr-self-review/routing.md`) are **never** preloaded either way and are always
opened on demand.

Never given to any of them: `security` (owned by `/security-review`, and the
vendored skill targets Express + Mongoose, not Fastify + Drizzle) and
`typescript-expert` (checklist-shaped, noisy).

Two agents have no `Skill` tool at all — `researcher` and `plan-verifier`.
Withholding the loader, not just the preload, is the point: loading a skill
mid-run injects exactly the same instructions the `skills:` field would have,
only later. `plan-verifier` asks whether a requirement was met, and any rulebook
in its context turns that into a second code review; `researcher` reports what
the rules *say*, and a rule it can invoke is a rule it starts enforcing.

Opus where the judgement *is* the product — `planner` choosing what to build,
`architecture-reviewer` deciding whether an edge is a real boundary break,
`plan-verifier` telling "met differently" from "quietly dropped". Sonnet where
the judgement is already fixed by something else: a plan that names its files
and commands (`implementer`), a sibling test that sets the shape
(`test-writer`), the source being described (`doc-writer`), a question with a
locatable answer (`researcher`).

The model is per agent, not per step, so the opus reviewers also bill opus for
their mechanical halves — running `depcruise`, listing a diff, reading exit
codes. Splitting those out means a second agent and a handoff for work that is
three commands long, and the handoff would cost more than it saves. Stated
rather than pretended away.

## The chain

```
planner (opus)
   ├─ requirements vague? → "## Interview required" → main session asks you → re-delegate with answers
   └─ .claude/plans/<slug>.md
        ├─ TDD? → test-writer (sonnet) → red tests → ⛔ YOU COMMIT THEM ← before the next step
        → implementer (sonnet) → implementation report
             → test-writer (sonnet)            — writes the tests the plan did not
             → then, in parallel, read-only:
                  architecture-reviewer (opus)   — boundaries, evidence-backed findings
                  plan-verifier (opus)           — per-requirement conformance
             → doc-writer (sonnet)             — once the behaviour has stopped moving
                  → /pr-self-review → /code-review · /security-review → PR
```

The ordering is not decorative. `test-writer` **writes**; the two reviewers
**read**. Running them alongside it grades a moving tree. Run `test-writer` to
completion, then the two reviewers together — they share no files and answer
different questions.

**The TDD checkpoint is yours and nothing else can do it.** No subagent can
commit. When `test-writer` runs first, its red tests sit in a dirty tree that
`implementer` may edit, and "loosened the assertion" is indistinguishable from
"made it pass" in a diff that never had the original. Commit the red tests
before delegating; `test-writer` will remind you in its report, but the reminder
is not the guard — the commit is.

`doc-writer` runs **before** `/pr-self-review`, not after the PR is open. It
still goes last among the agents, because documenting a branch that is still
changing guarantees a stale doc — but the reviewers have settled by then, and
docs written after the PR either never land or land in a second PR nobody
connects to the first. Its output is uncommitted like everything else: you
commit it into the same branch, and the review sees the docs next to the diff
that produced them.

`researcher` is not on the chain: it answers questions, it is not a stage.

| Agent | Delegate to it when |
|-------|---------------------|
| `test-writer` | a plan's steps shipped without coverage; a bug needs a regression test; a lane is red — or **before** `implementer`, for TDD (then commit the red tests) |
| `architecture-reviewer` | a change touches structure, or a `depcruise` rule fails. Before `/pr-self-review`, not instead of it |
| `plan-verifier` | `implementer` reports done. Its verdict is what decides whether the branch is finished — pass it the implementation report, or it cannot tell a declared deviation from a dropped requirement |
| `doc-writer` | the reviews have settled, before `/pr-self-review`, so the docs are in the diff |

**No link calls the next one.** Two tools are absent from every subagent here,
and both shape the design above:

- **`Agent`** — none of the seven lists it, so none of them can spawn a
  subagent. This is our allowlist doing the work, not a platform guarantee:
  Claude Code lets subagents nest by default, up to a depth limit, and a
  subagent that inherited its tools *would* be able to. The `tools:` line is the
  whole mechanism. The main session is the orchestrator; there is no autonomous
  pipeline here, and trying to build one is the first thing people attempt.
- **`AskUserQuestion`** — removed from every subagent by the platform itself, so
  no `tools:` line is needed for it. A subagent cannot ask you anything mid-run,
  which is why the planner's interview is a two-pass handshake rather than an
  inline question, and why `researcher` returns `## Clarification required`
  instead of asking.

## Running the interview handshake

When `planner` returns `## Interview required` instead of a plan path:

1. Ask the questions it listed (it supplies a default for each, so an
   unanswered question is not a dead end).
2. Re-invoke `planner` with the **original task and the answers verbatim**.
   Answers alone, without the task, produce a plan for nothing.

   Resending everything is a choice, not a platform limit — Claude Code can
   resume a subagent with its context intact, and a subagent can be given
   persistent `memory`. We do not use either here: an answer that has to be
   restated in the delegation is an answer a human can see and correct, and the
   planner marks each one *human-answered* or *default-assumed* in the plan.
   Context that arrives invisibly cannot be audited six weeks later, which is
   the entire reason plans are committed.

```
Original task: <paste the original request>

Answers to your interview:
1. <question> → <answer>
2. <question> → <answer>
```

The planner copies these into the plan's **Decisions taken** section, which is
the only durable record of the conversation.

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
set unless a new agent genuinely needs one, so seven agents stay comparable at a
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
