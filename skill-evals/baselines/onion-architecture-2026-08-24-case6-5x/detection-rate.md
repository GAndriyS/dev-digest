# Case 6 — `secret-cache-invalidation`, 5×5 A/B

**Question asked:** not *can* the skill find the planted blind spot, but *how often*.
Ten independent reviews of the same six fixtures — five with `onion-architecture`
v1.1.0 (which carries the "Blind spots — where the config is silent" section,
rule 3 being the secret-derived cache), five with the v1.0.0 snapshot, which has
no such section.

Graded strictly against the nine assertions in
`.claude/skills/onion-architecture/evals/evals.json` (case id 6). An assertion
passes only where the review actually makes the claim.

---

## 1. Per-assertion detection rate

| # | Assertion | Disc. | with-skill (v1.1.0) | baseline (v1.0.0) | Δ |
|---|---|:--:|:--:|:--:|:--:|
| a6-stale-secret-cache | `_slack` cached but never cleared; rotated token used until restart | ✅ | **5/5** | **5/5** | 0 |
| a6-names-invalidate-path | Names `invalidateSecretCaches()` **and** knows the settings route calls it after writing a secret | ✅ | **5/5** | **5/5** | 0 |
| a6-missing-overrides | `slack()` skips `this.overrides.slack`; no `slack` in `ContainerOverrides` | ✅ | **5/5** | **5/5** | 0 |
| a6-links-mock-to-cause | The test's `vi.mock` presented as a *consequence*, not a standalone style nit | ✅ | **5/5** | **5/5** | 0 |
| a6-missing-mock | No `MockSlackClient` in `adapters/mocks.ts` (control) | — | **5/5** | **5/5** | 0 |
| a6-unscoped-listRecent | `listRecent()` queries by `prId` with no `workspaceId` (control) | — | **5/5** | **5/5** | 0 |
| a6-no-false-lane-claim | Does **not** claim the test file is misnamed | — | **5/5** | **5/5** | 0 |
| a6-cites-locations | Every finding names a file and a line | — | **5/5** | **5/5** | 0 |
| a6-fixtures-untouched | Fixtures byte-identical after the run | — | **5/5** | **5/5** | 0 |
| | **Total** | | **45/45** | **45/45** | **0** |

Two grading conventions, stated so the numbers can be re-derived:

- **`a6-names-invalidate-path` needed both halves.** Naming the method alone
  would have been a fail. All ten runs cleared the bar: nine cite
  `server/src/modules/settings/routes.ts:84` (one says `:85`) and place it
  "immediately after `container.secrets.set(...)`". with-skill run-3 and
  baseline run-4 go further and name the actual route, `POST
  /settings/test-connection` — note that the *skill's own* rule 3 says `PUT
  /settings/secrets`, which does not exist in this repo, so those two runs read
  the file rather than copying the skill.
- **`a6-cites-locations` was graded over findings about existing code.** Every
  run also carries a closing "not in the fixture set" section — module not
  registered in `modules/index.ts`, `publications` table missing, contracts not
  mirrored into `client/src/vendor/shared` — where a file exists to name but no
  line does. Graded strictly line-by-line, all ten would fail identically and
  the assertion would measure nothing.

---

## 2. Variance

**Every assertion was unanimous in both configurations. Nothing split.**

That is the unusual result here, and it cuts both ways:

- On the four **discriminating** assertions, a single run per side would have
  told you the same thing as five. No sampling error to correct for — 0/5 splits
  out of 18 assertion×configuration cells.
- Which also means these five runs contain **no evidence at all** about
  reliability at the margin. A 5/5-vs-5/5 result is consistent with a true
  detection rate anywhere from ~55% to 100% on either side (the exact-binomial
  95% lower bound for 5/5 is 0.478). What five runs rule out is a *big* gap; a
  10-percentage-point difference in either direction is entirely invisible at
  this sample size.

Where the runs *did* differ is below the assertion layer — in what else they
found, and in what they got wrong (§4). That variance is real and would have
been misread from a single run:

| Non-graded defect | with-skill | baseline |
|---|:--:|:--:|
| `err.status` on `AppError` (field is `statusCode`) | 5/5 | 4/5 (baseline-3 asserts the broken branch works) |
| `attempts`/`sqlIncrement()` stub → unbounded retries | 5/5 | 5/5 |
| `retryFailed` ignores `row.target` | 5/5 | 5/5 |
| `reviewRepo.getReview` / `listReviews` signature mismatch | 5/5 | 5/5 |
| `toDto` drops `body` → markdown target returns nothing | 3/5 | 0/5 |
| DTO/row mismatch: service reads `row.reviewId` off a snake_case `PublishRecord` | 0/5 | 1/5 (baseline-5 only) |

---

## 3. The four discriminating assertions, one by one

### a6-stale-secret-cache — 5/5 vs 5/5

The new rule changed nothing, because the baseline already had a hook: v1.0.0's
composition-root section says a secret is "read through `SecretsProvider` **at
resolve time, not at boot**". Three baseline runs quote exactly that line and
then argue that a permanent cache turns "at resolve time" into "at first
resolve, forever" (baseline-5: «без неї “at resolve time” перетворюється на “at
first resolve, назавжди”»). The with-skill runs reach the same place through
rule 3's explicit framing — "a hardcoded set of fields, not a sweep" — which
several reproduce almost verbatim.

No failing runs to explain.

### a6-names-invalidate-path — 5/5 vs 5/5

Both arms locate the call site by reading `settings/routes.ts`, not by trusting
the skill. Two runs (with-skill run-3, baseline run-4) explicitly correct the
route to `POST /settings/test-connection`; nobody in either arm invented a `PUT
/settings/secrets` handler, which is the failure mode rule 3's wording could
have induced.

Worth flagging as a skill bug rather than an eval result: **v1.1.0 rule 3 cites
a route that does not exist.** `SKILL.md:174` says `PUT /settings/secrets`
writes the value and then calls `container.invalidateSecretCaches()`; the repo's
only call site is inside `POST /settings/test-connection` (`routes.ts:84`, in
the `if (key)` branch). It did no damage in five runs, but it is a wrong fact
sitting in the skill.

### a6-missing-overrides — 5/5 vs 5/5

Unanimous and, in both arms, argued the same way: every other resolver in the
file checks overrides first, this one does not. Six of the ten runs enumerate
the neighbours (`github()` at :60, `llm()` at :82, `embedder()` at :92) to make
the omission visible rather than asserted.

### a6-links-mock-to-cause — 5/5 vs 5/5

This was expected to be the hardest, and it was not. No run in either arm filed
`vi.mock` as a standalone style violation. The causal sentence is explicit
everywhere:

- with-skill run-5: «Це не окрема помилка автора тесту — це **симптом A2**.»
- baseline run-3: «саме тому тест звалився на `vi.mock`. Це причина, а не збіг —
  виправлення п. 1 автоматично розблоковує п. 4.»
- baseline run-1: «Це прямий наслідок B1 — автор не мав чим підмінити порт.»

Both arms also ordered their remediation accordingly (fix the container first,
the test falls out), which is the behaviour the assertion is a proxy for.

**Summary for §3:** v1.1.0's rule 3 did not move any discriminating rate,
because the baseline was already at ceiling on this case.

---

## 4. Cost

From the ten `timing.json` files.

| | with-skill | baseline | Δ |
|---|---|---|---|
| Tokens, mean | **89,902** | **89,804** | +98 (+0.1%) |
| Tokens, range | 87,824 – 92,079 (spread 4,255) | 80,323 – 101,667 (spread 21,344) | 5× tighter |
| Seconds, mean | **329.1** | **367.5** | −38.4 (−10.4%) |
| Seconds, range | 291.6 – 368.7 (spread 77.1) | 330.5 – 433.7 (spread 103.2) | tighter |
| Tool calls, mean | 24.4 | 26.8 | −2.4 |

Reading: the extra section costs nothing in tokens — the mean difference is
0.1%, far inside the noise. What it appears to buy is **predictability**: the
with-skill token spread is a fifth of the baseline's, and the with-skill worst
case (92k) is below the baseline mean. Baseline run-1 spent 101,667 tokens and
433s to arrive at the same nine passes that with-skill run-1 reached in 87,824
tokens and 292s. With n=5 per side the wall-clock difference is suggestive, not
established.

---

## 5. Signal-to-noise

| | with-skill | baseline |
|---|---|---|
| Findings reported, mean | **20.2** (19, 17, 17, 22, 26) | **21.4** (25, 27, 20, 19, 16) |
| Runs with a false finding | **0/5** | **3/5** |
| False findings, total | **0** | **3** |

The fixture references tables, contracts and helpers that do not exist in this
repo (`t.publications`, `Publish*`, `SlackClient`, `test/helpers/db.js`,
`config.slackDefaultChannel`). Every run reports these; per the grading rules
they are legitimate and are neither graded nor counted as noise.

**Every false finding recorded, all three in the baseline arm:**

1. **baseline run-1, B5.3** — claims a test file under `server/src/` trips the
   depcruise rule `not-to-dev-dep` at severity `error`. The rule reads `from: {
   path: '^src/', pathNot: '\.(test|spec)\.ts$' }`
   (`server/.dependency-cruiser.cjs:145-151`): test files are explicitly
   excluded. The tag-along «і, ймовірно, у `no-orphans`» is wrong in direction
   too — the file imports other modules, so it is not an orphan. This is what
   escalates a folder-convention nit into a CI-failure argument.
2. **baseline run-3, finding 9** — states as fact that «`isRetryable` ловить
   будь-який `AppError` зі `status >= 500`». `AppError` has no `status`; the
   field is `statusCode` (`server/src/platform/errors.ts:9-19`), so that branch
   is dead. This run is the only one of ten that misses the bug, and it inverts
   it — describing the broken comparison as working in order to make its
   markdown-retry scenario reachable.
3. **baseline run-5, D1** — claims a missing `modules/index.ts` entry makes «CI
   впаде на правилі `no-orphans` (severity `error`)». `no-orphans` is declared
   `severity: 'warn'` (`.dependency-cruiser.cjs:42-47`); depcruise reports it and
   still exits green. Four other runs — including with-skill run-1 and
   baseline-3 — state the warn severity correctly.

Two near-misses I checked and deliberately did **not** record, applying one rule
consistently (a false finding asserts a defect that does not exist, or a repo
fact that is materially wrong and drives the severity; a loose supporting aside
inside a correct finding does not):

- with-skill run-3 calls the `vi.mock` path «єдиний імпорт адаптера з-під
  `src/modules/**`» — there are four, though all four are the `PURE_ADAPTERS`
  the rule deliberately exempts, so the architectural point stands.
- with-skill run-4 says the `invalidateSecretCaches()` call «стоїть і на записі
  секретів» as well — there is only one call site.

Everything else I sampled against the tree held up on both sides:
`AppError.statusCode`, `ReviewRepository.getReview(reviewId)` / no `listReviews`
/ `reviewsForPull(prId)`, the container members, `no-orphans` /
`not-to-dev-dep` / `no-direct-adapter-clients` rule names and severities, the
14 `*.it.test.ts` files under `server/test/`, `httpStatusOf` in
`platform/resilience.ts`, `NoProviderKeyError` usage in three modules,
`app.ts:108` gating the rate limit on `nodeEnv !== 'test'`, and the
`OkResponse` / response-schema convention in `_shared/schemas.ts`. Both arms
were reading the repository, not guessing at it.

---

## 6. Verdict

**On detection, rule 3 does not earn its place on this case — because there is
nothing left to earn.** Both arms are at 45/45. All four discriminating
assertions are 5/5 versus 5/5, including `a6-links-mock-to-cause`, which was
designed to be the hard one. The case was built on the premise that the
blind-spot pair is findable "only by cross-referencing three places"; five
v1.0.0 runs cross-referenced those three places anyway, working from the
composition-root line about reading secrets at resolve time. Case 6 is
therefore **saturated** and, as currently written, cannot discriminate between
these two skill versions with this model. Its value from here is as a
regression guard — a run that drops below 5/5 signals a real loss — not as an
A/B instrument.

The differences that did show up are secondary, and only one of them is
suggestive enough to act on: **all three false findings are in the baseline
arm**, and all three are of one kind — confident, specific, wrong claims about
what CI will do (`not-to-dev-dep` severity, `no-orphans` severity, a dead
comparison described as live). The with-skill arm produced none in five runs,
at a slightly lower finding count (20.2 vs 21.4), for the same tokens and about
10% less wall-clock. A plausible mechanism exists — the blind-spots section is
largely about *what the config cannot see*, which is exactly the register these
three errors got wrong — but 3 versus 0 out of five runs a side is a difference
that a fair coin produces often enough (Fisher exact, two-tailed: p = 0.17). It
is a hypothesis to test, not a result.

**What five runs per side can establish here:** that neither version's detection
of these nine behaviours is fragile — no assertion split, so no single-run
artefact is hiding in the numbers; and that the added section costs no tokens.

**What they cannot:** any detection difference smaller than roughly 40
percentage points; whether the 0-vs-3 false-finding gap is real; and whether
the ~10% wall-clock advantage survives more samples. To move the false-finding
question specifically, the honest next step is not more runs of case 6 — it is
a case whose planted violations are *not* also reachable from v1.0.0's
composition-root text, plus a scoring pass that counts false CI claims as a
first-class metric rather than a side note.

One concrete action falls out regardless of the A/B: **fix `SKILL.md:174`.**
Rule 3 names `PUT /settings/secrets` as the caller of
`container.invalidateSecretCaches()`; the repo's only caller is `POST
/settings/test-connection` at `modules/settings/routes.ts:84`. Two of ten runs
noticed and silently corrected it. The next one may not.
