# skill-evals

Harness that runs a skill's eval set twice — **with the skill** and **without
it** — and grades both. It answers one question: does this skill change what an
agent does, on a repository that already documents itself?

The cases and fixtures do **not** live here. They live with the skill:

```
.claude/skills/<skill>/evals/
├── evals.json      cases: prompt, fixtures, planted violations, assertions
└── fixtures/       the code under review
```

so a skill delivered elsewhere arrives with its tests attached. This folder holds
only the machinery: runner, grader brief, recorded baselines, results.

Today: `onion-architecture`. `node skill-evals/run.mjs --skill nope` lists what
ships an eval set.

## Running

```bash
node skill-evals/run.mjs --skill onion-architecture --dry-run   # writes prompts, executes nothing
node skill-evals/run.mjs --skill onion-architecture             # both configs, one run each
node skill-evals/run.mjs --skill onion-architecture --runs 3    # three runs per config
node skill-evals/grade.mjs --run skill-evals/results/<dir>      # grade + aggregate
node skill-evals/grade.mjs --run <dir> --aggregate-only         # re-aggregate after editing a verdict by hand
```

Needs the Claude Code CLI on `PATH` (or `CLAUDE_BIN=/path/to/claude`); extra CLI
flags go through `CLAUDE_ARGS`. Start with `--dry-run`: it writes every prompt
without spending a token, and is how you check wiring after editing a case.

A full run of the three onion-architecture cases cost ~490k tokens and about
five minutes of wall clock. Budget accordingly — this is not a lane you run on
every commit.

## What the two configurations are

Identical prompt, identical repo access, identical model. One difference:
`with-skill` is told to read `SKILL.md` first; `baseline` is forbidden from
reading `.claude/skills/` at all. That makes the number the skill's **marginal**
value over an agent that already has the codebase — which is the only number
worth having, since that agent is what you actually get without the skill.

## What is decided mechanically, and what is judged

The runner hashes every fixture before and after and writes
`fixture-integrity.json`; a run that edited the code it was told to review is
void, and no grader opinion enters into that. Pass counts are recomputed from
the expectations rather than trusted from the grader's arithmetic. Everything
else — "does this review actually say the adapter must come from the container"
— is judged by an agent working from `grader.md`, because no regex decides it.

Alongside the pass rate the grader reports `findings_reported` and
`false_findings`. Watch those: a review that finds all three planted violations
inside thirty invented ones has not helped anyone, and pass rate alone will not
show it.

## Baselines and the CI gate

`baseline.json` holds the last measured result per skill and the threshold a CI
run is compared against. It is a snapshot, updated in the same PR as the change
that moves it — never edited to turn a red run green.

The gate is **absolute** (`with_skill.pass_rate >= min`), not relative. On
`onion-architecture` the with/without delta is 0, so a "must beat baseline" gate
would fail on a perfectly healthy skill. The question CI can answer is narrower
and still useful: *did an edit to this skill make it worse?*

Not wired to a workflow yet. When it is, it belongs in its own
`workflow_dispatch` + nightly `schedule` workflow, never `on: pull_request` —
the runs cost money, take minutes and are not deterministic. Two consequences to
design for: pin the model explicitly (a default that moves reads as a skill
regression), and run each case 2–3 times and gate on the mean, because a single
sample of a stochastic process is not a measurement.

## A result worth knowing before you add cases

The first run of `onion-architecture` came back 18/18 for **both**
configurations. Not a bug in the harness — the baseline agent read
`server/.dependency-cruiser.cjs`, `AGENTS.md` and `container.ts` and quoted the
rule comments verbatim. In a repository whose boundaries are machine-enforced,
the enforcement config *is* the skill's content, in a file the agent finds on its
own.

So: **anything the config already checks is a weak case.** The cases that earn
their keep are the ones where the check is silent, ambiguous or wrong. The eval
set's own README lists the candidates for this skill.
