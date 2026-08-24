# Eval history — onion-architecture

Every comparison we have run, newest last, with the evidence kept verbatim. If
you have five minutes and want to see whether the skill does anything, read
[the one-screen contrast](#the-difference-in-one-screen) below and then open
[`delta-report.md`](baselines/onion-architecture-2026-08-24-case7-v2-vs-v1.1.0/delta-report.md).

All four runs: `claude-opus-5`, 24/08/2026, graded by an independent agent that
did not produce the reviews it graded.

| # | Question it answered | Runs/side | Result | Evidence |
|---|---|:--:|---|---|
| 1 | Does the skill beat **no skill at all** on rules CI already enforces? | 1 | 18/18 vs 18/18 · **Δ 0** | [`onion-architecture-2026-08-24/`](baselines/onion-architecture-2026-08-24/grading-notes.md) |
| 2 | Does **v1.1.0** (blind spots) beat **v1.0.0**? | 1 | 17/17 vs 17/17 · **Δ 0** | [`…-v1.1.0-vs-v1.0.0/`](baselines/onion-architecture-2026-08-24-v1.1.0-vs-v1.0.0/version-comparison.md) |
| 3 | Same question, but is the answer stable across runs? | 5 | 45/45 vs 45/45 · **Δ 0**, no assertion split | [`…-case6-5x/`](baselines/onion-architecture-2026-08-24-case6-5x/detection-rate.md) |
| 4 | Does **v2.0.0** (team conventions) beat **v1.1.0**? | 5 | 45/45 vs 27/45 · **Δ +0.40** | [`…-case7-v2-vs-v1.1.0/`](baselines/onion-architecture-2026-08-24-case7-v2-vs-v1.1.0/delta-report.md) |

Three zeros and one real delta. The zeros are the interesting part: they say
that in a repository whose boundaries are machine-enforced, **the skill competes
with `server/.dependency-cruiser.cjs` and loses**, because an agent reads the
config and derives the same rules — often quoting the rule comments back. Runs
1–3 are worth keeping as regression guards; they are not evidence of value.

Run 4 is different because its two rules exist in no file at all.

## The difference in one screen

Both configurations reviewed the same branch: a migration adding three columns
to `reviews`. Neither missed the lines. They disagreed about **what is wrong
with them**, and therefore about the fix.

**v2.0.0 — has the convention** (`case-7…/with-skill/run-1/outputs/review.md`):

> ### 1. Три нові колонки на `reviews` — таблиця закрита для нових колонок
> **Чому це проблема.** `reviews` закрита для нових колонок — рішення від
> 12/06/2026 після INC-42. […] анотації […] живуть **у власній таблиці з ключем
> `review_id`** і джойняться на читанні. […] Те, що поруч у схемі вже лежить
> `model`, — не прецедент: копіювання навколишнього патерну тут і є спосіб
> зламати правило.

**v1.1.0 — does not** (`case-7…/baseline/run-3/outputs/review.md`). It reads the
same lines, produces a correct and well-argued finding, and lands somewhere
else:

> Усі чотири методи ходять напряму в `t.reviews` через власний `Db`. Таблиця
> `reviews` належить модулю `reviews` […]
> Як правильно: дані чужого модуля беруться з його репозиторію на контейнері —
> `container.reviewRepo` вже існує.

Follow the second review and you route the writes through `reviewRepo` — and the
three columns stay on the hot table, which is the thing the team decided against.
**The failure mode is not silence. It is a plausible wrong fix**, argued well
enough that a reviewer would accept it.

Same story on foreign keys: all five v2 runs stated the rule (new FKs are
`RESTRICT`, the owning service deletes children); all five v1.1.0 runs caught
only the one spectacular consequence — `annotation_author_id → users ON DELETE
CASCADE` deletes whole review rows — and **three of five went on to recommend
new cascades of their own**, because every neighbouring FK cascades.

## What is in each evidence folder

```
baselines/<run>/
├── delta-report.md | detection-rate.md | version-comparison.md   ← read this
├── summary.md / summary.json          aggregate: pass rate, false findings, cost
├── fixture-integrity.json             proof no agent edited the code it reviewed
└── case-N-<name>/<config>/run-N/
    ├── outputs/review.md              the review, verbatim
    ├── grading.json                   per-assertion verdict + the quote proving it
    └── timing.json                    tokens, seconds, tool calls
```

Nothing here is summarised away: every verdict carries the sentence it was based
on, so you can disagree with the grader by reading the same review it read.

## Reproducing or extending

The cases and fixtures live with the skill —
[`.claude/skills/onion-architecture/evals/`](../.claude/skills/onion-architecture/evals/README.md).
The runner, the grader brief and the CI gate live here; see
[`README.md`](README.md) and [`baseline.json`](baseline.json).

```bash
node skill-evals/run.mjs --skill onion-architecture --dry-run   # writes prompts, spends nothing
node skill-evals/run.mjs --skill onion-architecture --runs 5
node skill-evals/grade.mjs --run skill-evals/results/<dir>
```

Before adding a case, ask the question runs 1–3 failed to ask: *could a careful
agent reach this answer by reading the repo?* If yes, the case measures the
repo, not the skill.
