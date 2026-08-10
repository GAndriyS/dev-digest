# Plans

Development Plans written by the [`planner`](../agents/planner.md) agent and
executed by [`implementer`](../agents/implementer.md).

One file per piece of work: `<branch-slug>-<topic-slug>.md`.

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

`planner` interviews the caller when the requirements are too vague to plan
against. That conversation happens in a chat window nobody will ever re-read,
so the answers are copied verbatim into the plan's **Decisions taken** section.
Without it, a reviewer six weeks later sees a design choice with no visible
reason and has to guess whether it was deliberate.

If the section says `none — requirements were sharp enough to plan against`,
that is also information: it says the planner considered interviewing and
decided the repo already answered everything.

## Shape

Enforced by nothing — `planner` owns it, and the headings are fixed so a plan
can be skimmed:

```
# Plan: <title>
## Context read                     path:line for every binding rule
## Decisions taken                  the interview trail, or "none"
## Constraints that bind this change
## Steps                            table, incl. the skills the implementer applies
## Contract & migration impact
## Verification plan                exact commands
## Out of scope / left to reviewers
## Risks
## Open questions                   each with the default the implementer assumes
```

A plan whose **Steps** table has an empty *Skills* column is a bug in the plan,
not a shortcut: that column is copied from `routing.md`'s skill map and is how
the plan and the implementation are kept from disagreeing about which rules
apply.
