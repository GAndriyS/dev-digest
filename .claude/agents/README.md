# Agents

Subagents for this repo. Each runs in its **own** context window with its own
tool grant, and returns a report to whoever delegated to it. Canonical location
is `.claude/agents/`; shared with the team via version control.

## Catalog

| Agent | Model | Tools | `skills:` (preloaded) | Owns | May not |
|-------|-------|-------|-----------------------|------|---------|
| [researcher](researcher.md) | sonnet | `Read, Grep, Glob, Bash, WebSearch, WebFetch, TodoWrite, Skill` | **none, deliberately** — a preloaded skill arrives as an instruction, and every rule this agent meets must arrive as *evidence* | Answering "how does this repo do X" and "what do the upstream docs say", with locators for every claim | Change anything; invoke `/deep-research` |
| [planner](planner.md) | opus | `Read, Grep, Glob, Bash, Write, TodoWrite, Skill` | `pr-self-review` — so it plans against the review the branch will face. It *assigns* the implementation skills rather than applying any | Turning a request into a Development Plan in [`.claude/plans/`](../plans/README.md), incl. the skills each step needs | `Edit` anything; write outside `.claude/plans/`; run tests or builds |
| [implementer](implementer.md) | sonnet | `Read, Edit, Write, Grep, Glob, Bash, TodoWrite, Skill` | the nine routed skills — `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`, `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`, `zod` — plus `engineering-insights` for the closing sweep | Executing a plan across `client/`, `server/`, `reviewer-core/`, `e2e/`; running the touched lanes; recording insights at the end | Commit, push, open a PR; touch the do-not-touch paths; pass architecture or security verdict |
| [test-writer](test-writer.md) | sonnet | `Read, Edit, Write, Grep, Glob, Bash, TodoWrite, Skill` | `react-testing-library`, `onion-architecture` — the two needed on every run of their half; the seven that shape *production* code stay on demand | Tests in all four packages: the right file name, the right lane, and running the lane it touched | Edit production code to make a test pass; weaken a test to go green; write `e2e/specs/*.flow.json`; commit or open a PR |
| [architecture-reviewer](architecture-reviewer.md) | opus | `Read, Grep, Glob, Bash, TodoWrite, Skill` | `onion-architecture`, `frontend-ui-architecture` — its whole remit is those two skills' non-mechanical half. **Not** `pr-self-review`: that is a workflow, and preloading a workflow invites running it; only its `routing.md` is needed, read on demand | Boundary findings with `file:line` evidence, scored on `routing.md`'s scale; deterministic gates CRITICAL by construction | Write or edit anything; edit a `.dependency-cruiser.cjs` or grow a `GRANDFATHERED` list; hunt bugs or security |
| [plan-verifier](plan-verifier.md) | opus | `Read, Grep, Glob, Bash, TodoWrite` | **none, deliberately — and no `Skill` tool either.** A verifier holding a rulebook becomes a second code reviewer within three findings | A verdict per plan requirement with a locator, plus the changes no requirement asked for | Write or edit anything; offer style, naming or refactor advice; mark MET on intent; ask a question |
| [doc-writer](doc-writer.md) | sonnet | `Read, Edit, Write, Grep, Glob, Bash, TodoWrite, Skill` | `mermaid-diagram` — the one skill every run of this agent uses | Docs for shipped behaviour, the diagrams, and the layering call about which section a piece belongs in | Write rules into `AGENTS.md` or specs into `specs/`; document unbuilt behaviour; run builds or tests |

The `skills:` field **preloads full skill bodies** into the agent's startup
context, on every run. It cannot express a condition, so `implementer` carries
all nine even on a backend-only change; the slice table in its body is what
decides which ones it actually *applies*. Companion files (`examples.md`,
`rules/`, `references/`, and `pr-self-review/routing.md`) are **not** preloaded
and are still opened on demand with the `Skill` tool.

Never given to any of them: `security` (owned by `/security-review`, and the
vendored skill targets Express + Mongoose, not Fastify + Drizzle) and
`typescript-expert` (checklist-shaped, noisy). `mermaid-diagram` was on this
list too — "nothing here produces diagrams" — until `doc-writer`, which is
exactly what changed the premise. It is preloaded there, and nowhere else.

`plan-verifier` is the only agent with no `Skill` tool at all. Withholding the
loader, not just the preload, is the point: its question is whether a
requirement was met, and any rulebook in its context turns that into a second
code review.

Opus where the judgement *is* the product — `planner` choosing what to build,
`architecture-reviewer` deciding whether an edge is a real boundary break,
`plan-verifier` telling "met differently" from "quietly dropped". Sonnet where
the judgement is already fixed by something else: a plan that names its files
and commands (`implementer`), a sibling test that sets the shape
(`test-writer`), the source being described (`doc-writer`), a question with a
locatable answer (`researcher`).

## The chain

```
planner (opus)
   ├─ requirements vague? → "## Interview required" → main session asks you → re-delegate with answers
   └─ .claude/plans/<slug>.md
        → implementer (sonnet) → implementation report
             → test-writer (sonnet)            — writes the tests the plan did not
             → then, in parallel, read-only:
                  architecture-reviewer (opus)   — boundaries, evidence-backed findings
                  plan-verifier (opus)           — per-requirement conformance
             → /pr-self-review → /code-review · /security-review → PR
                  → doc-writer (sonnet)        — once the behaviour has stopped moving
```

The ordering is not decorative. `test-writer` **writes**; the two reviewers
**read**. Running them alongside it grades a moving tree. Run `test-writer` to
completion, then the two reviewers together — they share no files and answer
different questions. `doc-writer` goes last, because documenting a branch that
is still changing guarantees a stale doc.

`researcher` is not on the chain: it answers questions, it is not a stage.

| Agent | Delegate to it when |
|-------|---------------------|
| `test-writer` | a plan's steps shipped without coverage; a bug needs a regression test; a lane is red — or **before** `implementer`, for TDD |
| `architecture-reviewer` | a change touches structure, or a `depcruise` rule fails. Before `/pr-self-review`, not instead of it |
| `plan-verifier` | `implementer` reports done. Its verdict is what decides whether the branch is finished |
| `doc-writer` | the reviews have settled and a shipped feature needs writing up |

**No link calls the next one.** Two tools are stripped from every subagent's
pool, and both shape the design above:

- **`Agent`** — a subagent cannot spawn another subagent. The main session is
  the orchestrator; there is no autonomous pipeline here, and trying to build
  one is the first thing people attempt.
- **`AskUserQuestion`** — a subagent cannot ask you anything mid-run. That is
  why the planner's interview is a two-pass handshake rather than an inline
  question.

## Running the interview handshake

When `planner` returns `## Interview required` instead of a plan path:

1. Ask the questions it listed (it supplies a default for each, so an
   unanswered question is not a dead end).
2. Re-invoke `planner` with the **original task and the answers verbatim**. The
   second pass is a fresh run with no memory of the first — answers alone,
   without the task, produce a plan for nothing.

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

The same applies to the two read-only agents. `architecture-reviewer` and
`plan-verifier` are read-only because their `tools` list grants no `Edit` or
`Write` — and because their bodies close the `Bash` loophole explicitly (no
`>`/`>>`, `tee`, `sed -i`, `patch`, `git apply`). `.claude/settings.json` does
not enforce it and cannot: a project-wide `Bash` deny would break the main
session. Same prompt-only footing as the implementer's commit ban.

## Writing a new agent

Frontmatter, minimal and portable across Claude Code builds:

```yaml
---
name: <matches the filename>
description: <what it does + when to delegate to it + what it is NOT for>
tools: <explicit allowlist — omitting the field inherits everything, including MCP tools>
skills: <comma-separated, preloaded in full on every run — or omit the field entirely>
model: opus | sonnet | haiku | inherit
---
```

Only `name` and `description` are required; the other three are the levers that
matter here. Claude Code accepts more fields than these — keep to this set
unless a new agent genuinely needs one, so seven agents stay comparable at a
glance.

- The `description` is the only thing the main session sees when deciding to
  delegate. Make it name concrete triggers *and* explicit boundaries; "Not for
  X" prevents more bad delegations than any amount of detail about X.
- An explicit `tools` list is an allowlist and also strips MCP tools — grant the
  minimum. A read-only agent gets no `Edit` **and** must close the loophole in
  its own body, because `Bash` writes files through redirects, `tee`, `sed -i`
  and `git apply`. Withholding `Skill` is a real lever too, not an oversight —
  see `plan-verifier`.
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
- Add a row to the catalog above in the same change, with the cells copied from
  the frontmatter verbatim. Nothing checks this file against the agents it
  documents, and it has drifted before.
