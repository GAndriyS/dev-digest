# Plans

Implementation Plans written by the
[`implementation-planner`](../agents/implementation-planner.md) agent and
executed by [`implementer`](../agents/implementer.md) (multi-agent mode) or by
the main session in one pass (single-agent mode). The planner turns a spec from
`specs/` — or the request itself — into a plan; it never writes the spec.

One file per piece of work: `<branch-slug>-<topic-slug>.md` — or just
`<topic-slug>.md` when the plan was written before its branch existed, which is
the normal case. A plan filed under `main-…` is one nobody finds from the branch
that implements it.

A plan is never overwritten. A second attempt at the same topic is
`<slug>-v2.md` with `**Supersedes:**` in its header line pointing at the first —
the earlier plan stays readable, which is the point of committing them.

**Name the plan when you delegate.** `implementer` and `plan-verifier` both
refuse to guess: given no name and more than one plan here, they list the
directory and stop. Picking "the newest by mtime" was the old rule and it is a
coin flip after any checkout or rebase — the plan decides everything those two
agents do, so getting it wrong produces confident work on the wrong branch.

## These are committed on purpose

Unlike `.claude/reviews/` — which is gitignored, regenerated per branch, and
means nothing once the PR is open — a plan is worth keeping. It lets a reviewer
compare *what the branch set out to do* against *what the diff actually does*,
which is a question the diff alone cannot answer.

The `meta` slice in
[`pr-self-review/routing.md`](../skills/pr-self-review/routing.md) covers
`.claude/**`, so plans are listed in the review report but no skill review runs
against them. They add no noise to the gate.

## Why **Decisions taken** is load-bearing

`implementation-planner` interviews the caller when a requirement is ambiguous,
untestable or conflicts with a repo rule — and, on every run, asks whether the
plan will run **multi-agent** (the subagent chain) or **single-agent** (one
pass). That conversation happens in a chat window nobody will ever re-read, so
the answers are copied verbatim into the plan's **Decisions taken** section,
each tagged *human-answered* or *default-assumed*. Without it, a reviewer six
weeks later sees a design choice with no visible reason and has to guess
whether it was deliberate.

If the section says `none — the delegation stated the mode and every
requirement was clear`, that is also information: it says the planner reviewed
the requirements, considered interviewing, and found the repo and the
delegation already answered everything.

**Recommendations** are the other half of that trail: the planner's advice on
doing it better, kept apart from the requirements. An accepted recommendation
moves into **Decisions taken** and shapes the **Steps**; the rest stay listed
as advice with `Default: as requested`, and `plan-verifier` does not grade them.

## Shape

Enforced by nothing — `implementation-planner` owns it, and the headings are
fixed so a plan can be skimmed:

```
# Plan: <title>                     header line carries Branch · Slices · Spec (+ status) · Mode · Supersedes
## Context read                     path:line for every binding rule
## Requirements review              every spec criterion, edge case, NFR / stated requirement, verbatim, with a verdict
## Decisions taken                  the interview trail incl. the mode, or "none"
## Recommendations                  advice not turned into a decision, or "none"
## Constraints that bind this change
## Steps                            table, incl. Satisfies (AC-N), Depends on (the DAG /implement builds waves from), Executor, Skills, Verification
## Execution                        multi-agent: delegation order, Ownership table + integration step when implementers run in parallel · single-agent: "one pass"
## Contract & migration impact
## Verification plan                `node scripts/verify.mjs --slice <s>` per touched slice, plus anything the script does not cover
## Out of scope / left to reviewers
## Risks
## Open questions                   each with the default the executor assumes
```

A plan whose **Steps** table has an empty *Skills* column is a bug in the plan,
not a shortcut: that column is copied from `routing.md`'s skill map and is how
the plan and the implementation are kept from disagreeing about which rules
apply. The *Executor* column follows the mode: agent names from
[`agents/README.md`](../agents/README.md) in multi-agent, `single pass` on
every row in single-agent.
