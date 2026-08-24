---
name: workflow-retro
description: Retrospective of a multi-agent run — /workflow-retro [<slug>] [--deep]. Reconstructs from the current chat which agents ran, in what order, at what token/tool/time cost, where they struggled, what they duplicated and what they missed; prints the retro to chat, appends a ledger entry to docs/retro/ledger/, and returns concrete proposals (agent prompt, delegation, process) for the next run. Manual only — invoke when the user types /workflow-retro or explicitly asks for a retrospective / post-mortem of the agents' run. Never run it proactively, never from another skill or hook, and never as part of /implement's wrap-up.
metadata:
  version: 0.1.0
  tags: retro, workflow, subagents, telemetry, ledger, meta, command
---

# /workflow-retro — how did the agents do?

You (the main session) are the only one who saw the whole run: every `Agent`
result with its `subagent_tokens` / `tool_uses` / `duration_ms`, every
interview round, every `SendMessage` continuation, every human gate. This
skill turns that into numbers, observations and proposals — once, at the end,
when a human asks.

**Trigger: manual, by decision.** The user types `/workflow-retro` or asks
for a retro in their own words. Nothing else fires it: no hook (there is none
in `.claude/settings.json`), no stage of `/implement`, no "wrap-up" heuristic.
If you find yourself about to run it unasked — do not.

**It spawns no agents.** A retro that costs another 100k tokens defeats its
purpose. Everything below is reading and arithmetic in this context.

## Arguments

```
/workflow-retro [<slug>] [--deep] [--since <n-messages | commit>]
```

| Argument | Meaning |
|---|---|
| `<slug>` | Name for the ledger entry (feature / plan slug). If omitted: the `.claude/plans/` or `specs/` slug the run was about, else the branch name |
| `--deep` | Extend the data source beyond this chat — see **Data sources** |
| `--since` | Restrict the window: only agent calls after the n-th last user message, or after a commit. Default: the whole chat |

## Data sources

**Default — in context.** Everything the current conversation holds:

- every `Agent` / `SendMessage` result: agent type, model, `subagent_tokens`,
  `tool_uses`, `duration_ms`, whether it was a fresh spawn or a continuation;
- the agents' reports — their `Files read`, `Decisions taken`, `Open
  questions`, `Insight candidates`, verdicts (`10/10 self-check`, `COMPLETE`,
  `PASS`, `Steps N/N`, findings counts);
- interview rounds: questions asked → answers relayed → re-asks; how many
  `AskUserQuestion` calls, how many answers were defaults;
- your own orchestration cost that is visible: re-delegations, rephrasing of
  human answers, translations between agents (a handoff you had to repair);
- human gates: where the chain stopped, for what, and what came back.

**`--deep` — also read** (read-only, never write anywhere but the ledger):

- `.claude/sdd/<slug>.md` — `/implement`'s stage table and reports;
- `git log --oneline --format='%h %ad %s' --date=iso <base>..HEAD` — commits
  between stages give the wall-clock timeline;
- previous entries in `docs/retro/ledger/` for the same slug or the same
  workflow shape — for the **Delta** section;
- `.claude/agents/<name>.md` of every agent that ran — to judge whether the
  agent followed its own protocol (steps skipped, gates ignored, output format
  violated);
- task output files whose paths appeared in this chat (`…/tasks/<id>.output`)
  when a result was truncated.

Say in the ledger which mode ran. Numbers you could not observe are `—`, not
estimates; an estimate is marked `≈` and says what it was derived from.

## What to measure

Compute every row you can; a row you cannot compute is written as `—` with a
one-word reason (`not-in-context`, `no-sdd-file`). Never invent a number.

| Metric | How | Why it matters |
|---|---|---|
| **Agents run** — count by type × model, fresh vs continued | `Agent` / `SendMessage` results | Baseline |
| **Tokens** — per agent, total, share of total | `subagent_tokens` | The only place "the reviewers are expensive" becomes a number |
| **Overhead vs work** — tokens spent on the map (Step 1 of each agent: `AGENTS.md`, `INSIGHTS.md`, `routing.md`, spec) vs on the task | `Files read` × repeated across agents; `≈` from tool_uses before the first write | The main saving lever: a shared handoff brief instead of N re-reads |
| **Sequence** — order, parallelism, loops | Message order; `∥` when two spawns share one message | Shows where a barrier was unnecessary and where a loop happened |
| **Interview efficiency** — questions asked / answered by human / answered by default / answerable from the repo or spec | Interview blocks vs answers vs what the spec/repo already said | An agent asking what it could have read is a prompt defect |
| **Rework** — re-delegations, fix-loop iterations, re-verifies, `PARTIAL`/`INCOMPLETE`/`NOT MET` | Reports and stage table | The most expensive stage tends to be the loop; watch its trend |
| **Handoff fidelity** — decisions / open questions of agent A that agent B re-asked, contradicted or dropped; answers you had to rephrase or interpret | Compare `Decisions taken` across reports; your own relay messages | Loss between agents is invisible in any single report |
| **Human-gate latency** — stops, what for, tokens re-spent after each stop | Gates in order | Whether a gate should stay a gate |
| **Requirement coverage** — `AC-N` in the spec vs `AC-N` cited in plan / verifier report | `rg -o 'AC-\d+'` on both | Cheapest proxy for a missed requirement |
| **Wall clock** — per agent (`duration_ms`) and end-to-end when observable | results, `--deep`: commit times | Where the human waited |
| **Delta** vs previous ledger entry of the same slug / shape | `--deep` | One retro is an anecdote; two are a trend |

**Discipline on judgement.** "Easy" / "hard" without a signal is an
impression. Anchor every observation to an observable: rounds, tool_uses far
above the median, re-delegation, a downstream verdict about upstream work
(architecture `CRIT` → implementer missed; `NOT MET` → planner or implementer;
a spec `[NEEDS CLARIFICATION]` the planner re-asked → the default was not
usable). Mark anything subjective as *(impression)*.

## Output — chat first, then the ledger

**1. Chat**, in the user's language, compact: the run-summary table, the
sequence line, the three strongest observations, the proposals. No more than
one screen; the ledger holds the rest.

**2. Ledger entry** — `docs/retro/ledger/<YYYY-MM-DD>-<slug>.md`, English body,
headings verbatim (later retros `rg` them for **Delta**). Never overwrite an
existing entry: same day, same slug → `-2`, `-3`. Add the row to the table in
`docs/retro/README.md` in the same run. Format:

```markdown
# Retro: <slug>

Date: <YYYY-MM-DD> · Branch: <branch> · Workflow: <spec → plan | /implement | ad hoc | …> · Source: in-context | deep · Window: <whole chat | --since …>

## Run summary
| Agent | Model | Fresh/cont. | Tokens | Tool calls | Duration | Result |
|---|---|---|---|---|---|---|
| … |
| **Total** | | n agents | … | … | … | |

## Sequence
<one line per step, `→` sequential, `∥` parallel, `↺` loop, `⛔` human gate;
optionally a mermaid `sequenceDiagram` when the run had ≥ 4 agents>

## Metrics
| Metric | Value | Evidence |
|---|---|---|
<the table above, filled or `—`>

## Per-agent observations
### <agent>
- **Went well:** <observable> 
- **Struggled:** <observable> 
- **Missed:** <what a later agent or the human caught>
- **Followed its protocol:** yes | deviations (only with --deep, else "not checked")

## Duplication
<files read by ≥ 2 agents that are large or session-specific; questions
re-asked; work redone — with the token cost where derivable>

## Handoff losses
<decision / question / fact that degraded between agents, and where>

## Proposals
| # | Target | Change | Evidence | Expected effect | Cost |
|---|---|---|---|---|---|
| 1 | `.claude/agents/<x>.md` § … / delegation prompt / process / skill | <ready-to-apply wording or rule> | <metric row or observation> | <tokens, rounds, quality> | <one-line edit / new file / …> |

## Delta vs previous
<--deep only: previous entry path + what moved. Else "first entry for this slug"
or "not computed (in-context mode)">

## Insight candidates for INSIGHTS.md
<engineering findings about the *code or repo* only — the human decides
whether `/engineering-insights` records them. Agent/workflow findings stay in
this ledger; do not push them into INSIGHTS.md>
```

**Proposals are the point, not an appendix.** Every retro ends with at least
one proposal or the sentence "no proposal — the run had no observable
inefficiency", and each proposal is concrete enough to apply as written:
which file/section, what wording, what it should change in the next run's
numbers. You **propose, you do not apply**: an edit to an agent definition,
a skill or `/implement` is the human's call after reading the retro. When
they accept one, apply it in that same conversation and note the ledger
entry it came from in the commit message.

## Where things go — and where they do not

| Finding | Goes to |
|---|---|
| Anything about agents, prompts, handoffs, workflow shape, cost | `docs/retro/ledger/<date>-<slug>.md` (this skill) |
| A finding about the code, a dependency, a repo convention | `INSIGHTS.md` via `/engineering-insights` — listed under **Insight candidates**, not written by this skill |
| A change to an agent / skill / process | **Proposals** — applied only when the human accepts |

This skill writes exactly two paths: the ledger entry and the row in
`docs/retro/README.md`. Not `INSIGHTS.md`, not `.claude/agents/**`, not
`.claude/skills/**`, not `.claude/sdd/**`.

## What you must not do

- Run without being asked. Not after `/implement`, not at "session end", not
  because a run "looks retro-worthy".
- Spawn an agent to compute the retro, or to "verify" it.
- Fill a metric you did not observe. `—` is a valid cell.
- Grade agents on impressions without an observable next to them.
- Apply a proposal in the same breath as proposing it.
- Overwrite a ledger entry.
