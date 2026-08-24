# Case 7 — team conventions · onion-architecture v2.0.0 vs v1.1.0

**Run:** `case-7-team-conventions`, 5 runs per configuration, same prompt, same fixtures.
**with-skill** = v2.0.0 (`.claude/skills/onion-architecture/SKILL.md`, has the section
"Team decisions the code cannot tell you").
**baseline** = v1.1.0 (`skill-evals/snapshots/onion-architecture-1.1.0/SKILL.md`, does not).

The case plants two decisions that are *not* derivable from the repo, and that the
surrounding schema argues against:

1. `reviews` is closed for new columns (12/06/2026, after INC-42) — per-review data
   goes in its own table keyed by `review_id`.
2. New foreign keys are `ON DELETE RESTRICT`; the owning service deletes children
   explicitly. Existing cascades are grandfathered — and 50 of the 55 `.references(...)`
   in `server/src/db/schema/` cascade, so "be consistent" points the wrong way.

---

## 1. Per-assertion detection rate

| Assertion | disc. | v2.0.0 | v1.1.0 | Δ |
|---|:--:|:--:|:--:|:--:|
| `a8-reviews-closed` — flags the three new columns, says the data belongs in its own table keyed by `review_id` | ✔ | **5/5** | **0/5** | **+5** |
| `a8-reviews-rationale` — gives the operational reason (hottest table, ALTER rewrites/locks it, run dies mid-flight) | ✔ | **5/5** | **0/5** | **+5** |
| `a8-cascade-restrict` — flags the new cascading FKs and states new ones should be `RESTRICT`, service deletes children | ✔ | **5/5** | **0/5** | **+5** |
| `a8-no-cascade-endorsement` — does not endorse cascade / does not recommend matching the surrounding cascading style | ✔ | **5/5** | 2/5 | +3 |
| `a8-unscoped-delete` — `deleteAttachment()` deletes by id with no `workspaceId` (control) | | 5/5 | 5/5 | 0 |
| `a8-mirror-contracts` — new wire contracts must be mirrored into the client copy of `@devdigest/shared` (control) | | 5/5 | 5/5 | 0 |
| `a8-no-false-side-table-claim` — does not argue `annotation_attachments` should be folded into `reviews` | | 5/5 | 5/5 | 0 |
| `a8-cites-locations` — every finding names a file and a line | | 5/5 | 5/5 | 0 |
| `a8-fixtures-untouched` — fixtures byte-identical after the run | | 5/5 | 5/5 | 0 |

**Discriminating total: 20/20 vs 2/20.**
Controls: 25/25 both sides — v1.1.0 is not a weaker reviewer in general, it is blind
in exactly the two places the new section addresses.

One honesty note on the 2/5: both baseline passes on `a8-no-cascade-endorsement`
(runs 3 and 5) are **vacuous**. Neither run endorses a cascade because neither run ever
discusses the two new cascades on `annotation_attachments` at all. Read as
"took the correct position", the baseline score is 0/5; read as written (a negative
assertion), it is 2/5. The table reports the literal reading.

---

## 2. The framing table — the core evidence

How each run framed **the three new columns on `reviews`**, and how each framed
**the new `ON DELETE CASCADE` foreign keys**.

| Run | New columns on `reviews` | New cascading FKs |
|---|---|---|
| **v2 run-1** | **team convention → side table** (Blocker 1) — *and separately* cross-module write → `container.reviewRepo` (Blocker 5) | **general RESTRICT rule**, all three FKs, service deletes children; author_id row-deletion given as worst case |
| **v2 run-2** | **team convention → side table** (B1); cross-module write is a separate blocker (B5) | **general RESTRICT rule** (B3) + `AnnotationsService.deleteForReview()` called by the reviews service |
| **v2 run-3** | **team convention → side table** (Blocker 1); cross-module write separate (Blocker 5) | **general RESTRICT rule** (Blocker 2), traced to both real delete paths (`review.repo.ts:83`, `run.repo.ts:78`) |
| **v2 run-4** | **team convention → side table** (B1); cross-module write separate (B3) | **general RESTRICT rule** (B2), all three FKs, `container.annotationsRepo.deleteForReview(...)` |
| **v2 run-5** | **team convention → side table** (B1), incl. rebuttal of "three nullable columns are cheap" | **general RESTRICT rule** (B3) *and* author_id consequence as its own blocker (B2) |
| **v1.1 run-1** | cross-module write → `reviewRepo`; side table offered as option 1 of 2, option 2 = "if the columns stay on `reviews`" | **only the author_id consequence** → `set null`; *endorses surrounding style*: "каскади в цій схемі свідомо йдуть тільки по власнику" |
| **v1.1 run-2** | cross-module write → `reviewRepo`; side table = preferred option A, option B keeps the columns | **only the author_id consequence** → `set null`; *endorses cascade*: its own proposed table is `review_id PK → reviews.id ON DELETE CASCADE`, reused as the fix for orphans |
| **v1.1 run-3** | cross-module write → `reviewRepo` (primary fix moves methods into `ReviewRepository`); side table as "найчистіший варіант" alternative | **only the author_id consequence** → `set null`; other two cascades never mentioned |
| **v1.1 run-4** | cross-module write → `reviewRepo`; "два варіанти, обидва прийнятні" — own table (with `ON DELETE CASCADE`) or columns stay | **only the author_id consequence** → `set null`; *endorses cascade*: "`annotation_attachments.review_id`, де `CASCADE` доречний" |
| **v1.1 run-5** | **cross-module write → `reviewRepo`, no side table anywhere** — and it asks to declare `reviews_annotated_at_idx` in the Drizzle schema, cementing the shape | **only the author_id consequence** → `set null`; other two cascades never mentioned |

Two things this table is saying that a "did it mention the file" check would miss:

- **Every baseline run cites the same lines and reaches a different finding.** All five
  flag `repository.ts:24-68` writing to `t.reviews`; the fix is "route the write through
  `container.reviewRepo`", which leaves the three columns on `reviews`. That is a real
  finding — the v2 runs report it too — but it is a *different* one, with a different
  remedy, and it does not protect the hot table.
- **All five baseline runs treat "columns stay on `reviews`" as acceptable.** Runs 1, 2
  and 4 state it as an explicit option; run 3 makes it the primary recommendation;
  run 5 has no alternative at all. None objects to the `ALTER TABLE reviews ADD COLUMN`
  lines as such — those lines are never flagged in any baseline review.

---

## 3. Did any baseline run reach the conventions on its own?

**Convention 1 — partially, and for the wrong reason.** Four of five baseline runs
(1, 2, 3, 4) do float a `review_annotations` table keyed by `review_id`. Their
justifications, verbatim:

- run-2: "Тоді модуль `annotations` володіє **своїми** таблицями, `reviews` не чіпає
  взагалі, один-до-одного забезпечує PK, а `DELETE` нотатки стає справжнім `DELETE`,
  а не «занулити три колонки»." — module ownership + mechanics.
- run-3: "винести анотацію в окрему таблицю-сателіт `review_annotations` (PK =
  `review_id`, FK → `reviews`, **як уже зроблено для `pr_intent` та `pr_brief`**) …
  Це найчистіший варіант і він відповідає патерну, який у схемі вже двічі
  застосований." — pattern symmetry with an existing precedent (verified real:
  `db/schema/reviews.ts:48`, `:75`).
- run-1: "Винести нотатку у власну таблицю `review_annotations` … Плюсом зникає
  `UPDATE` по чужому рядку." — coupling.
- run-4: "Тоді annotations володіє своїми даними, `reviews` взагалі не змінюється, а
  `saveAnnotation` стає чесним `INSERT ... ON CONFLICT`." — ownership + a cleaner write.

So the *shape* is guessable — the repo contains two precedents for it. The *rule* is
not: **0/5 baseline runs state that `reviews` may not take new columns**, 0/5 give any
operational reason, and 5/5 leave the columns-on-`reviews` route open. A reviewer who
says "either is fine" does not stop this PR.

**Convention 2 — no.** Zero baseline runs reached it, and three actively argued against
it. The author_id cascade (`annotation_author_id → users ON DELETE CASCADE`, which
deletes whole review rows) is caught by 5/5 baseline runs — it is visible by reading the
FK — but that is the trap: it is spectacular enough to feel like the cascade finding has
been made. Meanwhile runs 2 and 4 wrote **new** cascading FKs into their own proposed
schema, and run 1 defended the ambient cascade style as deliberate. Consistency with the
surrounding schema is exactly the instinct the decision exists to override, and the
baseline followed it.

---

## 4. Cost

| | v2.0.0 (with-skill) | v1.1.0 (baseline) | Δ |
|---|---|---|---|
| Mean tokens | **77,258** (sd ≈ 3,221) | 87,993 (sd ≈ 6,503) | **−10,736 (−12.2 %)** |
| Token range | 72,497 – 81,001 | 78,515 – 94,447 | — |
| Mean wall time | **281.1 s** (sd ≈ 49.0) | 323.2 s (sd ≈ 44.3) | **−42.1 s (−13.0 %)** |
| Time range | 226.0 – 339.4 s | 270.5 – 391.3 s | — |
| Mean tool uses | 20.2 | 25.2 | −5.0 |

The better configuration is also the cheaper one, and its spread is tighter on tokens
(sd 3.2k vs 6.5k). The plausible mechanism is that the two decisions are handed over as
text instead of being reverse-engineered: baseline runs spent tool calls grepping the
schema for cascade patterns and precedents (`pr_intent`, `pr_brief`, `ci.ts`,
`repos.createdBy`) to reason their way toward an answer they then got wrong. At n=5 the
token ranges overlap (81.0k vs 78.5k), so treat the cost delta as directional, not as a
measured 12 %.

---

## 5. Signal-to-noise

| | v2.0.0 | v1.1.0 |
|---|---|---|
| Mean findings per review | **19.0** (16, 20, 21, 15, 23) | 21.8 (20, 29, 18, 21, 21) |
| False findings | **0** | **0** |

**No false findings in either configuration.** Every load-bearing repo claim across the
ten reviews was checked against the real files and held: `container.reviewRepo` at
`platform/container.ts:111-113`; `ReviewRepository.getReview` at
`modules/reviews/repository.ts:69` genuinely not workspace-scoped; `deleteReview` at
`:105-107`; `review.repo.ts:83` / `run.repo.ts:78`; migrations end at
`0017_shallow_swordsman` with `_journal.json` at `idx: 17`; `0000_init.sql` has zero
`IF NOT EXISTS`; `OkResponse` really is unused; `brief/routes.ts:43` and
`onboarding/routes.ts:30` really do declare response schemas; `db/schema.ts:50` really
builds an explicit `schema` const; `no-orphans` really is at `.dependency-cruiser.cjs:43`.
Both configurations correctly flag that the fixture references contracts and helpers
that do not exist — legitimate and not graded.

Three imprecisions were found and deliberately **not** counted as false findings,
because in each case the finding itself is true and only a supporting detail is off.
They are recorded in the per-run `grading.json` notes:

- v2 run-1 and run-3: "depcruise впаде на `no-orphans`" — that rule is severity `warn`
  (`.dependency-cruiser.cjs:44`), so it warns without failing. Baseline run-4 is the one
  run that gets this exactly right.
- v2 run-4: "У схемі зараз 50 FK і всі до одного `cascade`" — 50 of 55 cascade; three
  are `set null` (`ci.ts:17`, `runs.ts:23-24`).
- v2 run-5: "(53 входження)" of cascade — the real count in `db/schema/*.ts` is 50.

Noise is if anything *lower* in v2: fewer findings on average, all four discriminating
ones hit, and no cascade advice that would have to be walked back later.

---

## 6. Verdict

**The delta is real, and it is the delta the case was built to measure.**

On the three assertions that require a positive statement of a team decision —
`a8-reviews-closed`, `a8-reviews-rationale`, `a8-cascade-restrict` — the split is
**5/5 vs 0/5**, three times, with no partial credit anywhere on either side. It is a
clean separation, not a graded one: no baseline run half-reached the rule, and no
with-skill run half-missed it. Fisher's exact test on a single 5/5-vs-0/5 table gives
p ≈ 0.008 two-tailed; three independent-in-content assertions splitting the same way,
plus 25/25 vs 25/25 on the controls, makes "v1.1.0 happened to have a bad day" hard to
sustain.

**What five runs a side does not license:**

- **Not a point estimate.** With 0/5 observed, the rule of three puts the 95 % upper
  bound on the baseline's true detection rate at ≈ 45 %; with 5/5 observed, the 95 %
  lower bound on v2's is ≈ 55 % (Wilson: [0.57, 1.00] and [0.00, 0.43]). The honest
  claim is "v2 usually gets this and v1.1 usually does not", not "v2 gets it 100 % of
  the time".
- **The 5/5 vs 2/5 split on `a8-no-cascade-endorsement` is not significant on its own**
  (Fisher one-tailed p ≈ 0.083). It only carries weight read together with
  `a8-cascade-restrict`, and with the observation that both baseline "passes" are
  silences rather than positions.
- **The cost delta is directional.** −12 % tokens and −13 % seconds with n=5 and
  overlapping ranges is suggestive, not measured.
- **It does not generalise past this case.** What was demonstrated is that written-down
  team decisions get applied when written down. Nothing here says v2 is better at
  anything the code *can* tell you — the controls say the opposite: identical, 25/25
  both sides.

**One qualifier that cuts against the strongest reading of convention 1.** Four of five
baseline runs did independently arrive at a `review_annotations` side table keyed by
`review_id` — the repo contains two precedents (`pr_intent`, `pr_brief`) and a competent
reviewer finds them. So the *shape* is partly guessable. What is not guessable is that
it is mandatory: every baseline run left "columns stay on `reviews`, just route the
write through `reviewRepo`" on the table as an acceptable outcome, and none could say
why the alternative is unacceptable. The v2 section converts a preference into a
constraint with a reason attached — and that, not the table shape, is what shows up as
5/5 vs 0/5 on `a8-reviews-rationale`.

**Convention 2 is the stronger result of the two.** It is not that the baseline missed
the cascades — it is that it went the wrong way on them. Runs 2 and 4 wrote new
`ON DELETE CASCADE` foreign keys into their own recommended fixes, and run 1 justified
the ambient cascade style as deliberate design. A reviewer following the baseline's
advice would have shipped a second violation while believing the cascade issue had been
addressed, because the one FK it did catch (`annotation_author_id`) is dramatic enough
to feel like the whole finding. That is the case for keeping the "the schema will argue
against you here" sentence in the skill: without it, the surrounding code wins the
argument 5 times out of 5.
