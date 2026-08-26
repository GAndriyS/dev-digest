# Plan: Expectation kind — a stored, visible fact (SPEC-05 · AC-3, AC-4, AC-7, AC-53…AC-71)

**Branch:** L06-Evals · **Slices:** contracts · backend · frontend · meta · **Spec:** specs/SPEC-05-eval-pipeline-26-08-2026.md (approved, revised 27/08/2026) · **Mode:** multi-agent · **Supersedes:** none

Lineage, not supersession: `.claude/plans/l06-evals-eval-pipeline.md` shipped the
eval module, the batch runner and the Evals tab; `.claude/plans/l06-evals-eval-dashboard-design-fidelity.md`
shipped `/eval` and `Run all agents`. This plan adds the one requirement both
missed — the expectation kind as a stored fact — and the three surfaces that
make it visible and useful. AC-1, AC-2, AC-5…AC-6, AC-8…AC-52 are already
implemented on this branch and are **not** re-planned or re-graded here.

## Context read

Binding lines, not a reading list.

**Repo rules**
- `AGENTS.md:42-45` — `@devdigest/shared` exists twice: `server/src/vendor/shared`
  (canonical) and `client/src/vendor/shared` (trimmed, already drifted). Edit the
  server copy, mirror wire-crossing changes into the client copy, never one only.
- `AGENTS.md:46-47` — contracts are Zod-first: one schema drives request
  validation **and** response serialization; never `Schema.parse(req.body)` in a
  handler.
- `AGENTS.md:41` — migrations are NOT applied on boot: `cd server && pnpm db:migrate`.
- `AGENTS.md:48-49` — a DB-backed test must end in `.it.test.ts`; the unit and
  integration lanes split on exactly that glob.
- `AGENTS.md:16-27` — six independent packages: `server/`, `client/` → pnpm.
  The root `package.json` carries `verify:l06` and no dependencies.
- `AGENTS.md:81-83` — do not touch `server/clones/**`, **applied**
  `server/src/db/migrations/*.sql`, `**/src/vendor/ui/**`.
- `AGENTS.md:71` — when prose and CI disagree, trust `.github/workflows/**`.
- `server/AGENTS.md:13-14` — module anatomy `modules/<name>/{routes,service,repository}.ts`:
  routes validate, services own logic, repositories own SQL.
- `server/AGENTS.md:18-19` — declare zod `params`/`body` **on the route** (422
  before the handler runs); throw `AppError` for anything with a status.
- `server/AGENTS.md:25-27,29` — test split; `pnpm db:generate` for a new
  migration; never edit applied `src/db/migrations/**`.
- `client/AGENTS.md:13-15,16-19,24,26-29` — types come from `@devdigest/shared`
  (never hand-duplicated); all API access through `src/lib/api.ts`, data hooks in
  `src/lib/hooks/*`; UI strings in `messages/<locale>/*.json`; placement is
  machine-enforced by `pnpm arch`.
- `.claude/skills/pr-self-review/routing.md:65-75` — slice table (this plan:
  `client/**` → frontend, `server/**` → backend, both `vendor/shared/**` → also
  `contracts`, `.claude/**`+`*.md` → meta) and `:99-107` — skill map.

**Insights**
- root `INSIGHTS.md:526-530` (2026-08-05) — `drizzle-kit generate` stops with an
  **interactive** prompt when one diff both adds and drops a column; it cannot be
  answered by piping keystrokes. Keep this change purely additive.
- root `INSIGHTS.md:31-42` (2026-08-26) — a wire step that makes a shared field
  required must name **every** hand-built literal of that type, found by grepping
  the whole tree; an unnamed site turns `verify.mjs --slice frontend` red for
  every parallel lane at once, because typecheck is whole-tree.
- root `INSIGHTS.md:43-52` (2026-08-26) — another session may be committing to
  this branch; commit with an explicit pathspec (main session's rule, not a step).
- `server/INSIGHTS.md:223-232` (2026-08-26) — a single generic route serving two
  owner kinds is a silent data-corruption vector when its body schema knows only
  one of them: Zod's default `z.object()` **strips** unknown keys, which is how
  `PUT /eval-cases/:id` once deleted `file`/`start_line`/`end_line` from agent
  cases. Today that body is a `z.union` + `.strict()` (`skills/routes.ts:109-128`).
- `server/INSIGHTS.md:212-221` (2026-08-26) — `no-cross-module-internals` publishes
  only a module's `constants.ts`/`types.ts`/`index.ts` across a module boundary;
  `helpers.ts` is private even for a stable 6-field schema. Duplicate the small
  shape locally with a comment naming the rule, do not widen the boundary.
- `server/INSIGHTS.md:236-245` (2026-08-26) — the driver is `postgres` (porsager):
  wire-error fields sit directly on the error, and translating them into a domain
  error belongs in the repository, not the service.
- `client/INSIGHTS.md:188-197` (2026-08-26) — `@testing-library/user-event` is
  **not installed**; every interaction test here uses `fireEvent`, keyboard
  assertions included. Do not add the dependency to satisfy a skill's default.
- `client/INSIGHTS.md:214-221` (2026-08-20) — component suites mock hook modules
  with a plain factory, so a **new export** added to `@/lib/hooks/eval` is absent
  for every suite rendering a component that imports it, and vitest kills the
  whole file with `No "<name>" export is defined on the mock`. Add the stub in the
  same change.
- `client/INSIGHTS.md:114-121` (2026-08-26) — the app's `QueryClient` fires a
  global `mutationCache.onError` toast; a mutation that renders its own error
  branch must opt out with `meta: { ownErrorToast: true }` and then owns every
  error branch.
- `client/INSIGHTS.md:105-112` (2026-08-26) — `apiFetchWithStatus` is the
  sanctioned way to see an HTTP status; a bare `fetch` outside `lib/api.ts`
  hard-fails `check-ui-conventions.mjs` and silently bypasses the test mock.

**Code facts this plan is built on** (verified today)
- `server/src/db/schema/eval.ts:19-48` — `eval_cases` has no kind column;
  `:50-77` — `eval_runs.batchId` is a plain nullable `uuid` already.
- `server/src/vendor/shared/contracts/knowledge.ts:144-165` — `EvalCase` has no
  kind field; `source_finding_id` is the `.nullish()` precedent to copy.
  Client mirror: `client/src/vendor/shared/contracts/knowledge.ts:132-149`.
- `server/src/modules/eval/service.ts:156-186` — creation from a finding already
  branches on accepted/dismissed; only the resulting kind is not persisted.
  `:223-236` — the eval module's own `toEvalCaseDto`.
- `server/src/modules/eval/helpers.ts:18-45` — `ExpectedFinding` /
  `expectedFindings` (safeParse → `[]`), the rule AC-54 names.
- `server/src/modules/eval/scoring.ts:96-120` — pure functions over counts; no
  parameter for a kind exists (AC-57 is already true and must stay true).
- `server/src/modules/eval/routes.ts:24-34,121-128` — only the batch
  `POST /agents/:id/eval-runs`; the doc comment records that the router is one
  flat table with no per-module prefix, so re-registering a method+path throws
  `FST_ERR_DUPLICATED_ROUTE` at boot.
- `server/src/modules/skills/routes.ts:239-258` — the **skills** module owns
  `PUT /eval-cases/:id` (body `.strict()`, `expected_output` a union),
  `DELETE /eval-cases/:id` and `POST /eval-cases/:id/run`;
  `skills/service.ts:295-301` refuses agent-owned cases there with
  `unsupported_eval_owner`.
- `server/src/modules/skills/helpers.ts:71-83` — the DTO the shared `PUT` answers
  with. It omits `source_finding_id` today and would omit the new field too.
- `server/src/modules/eval/repository.ts:241-246` and `:301-307` — both batch
  reads filter `isNotNull(evalRuns.batchId)`; `dashboard.ts:361-364` builds
  `recent_runs` from those batches, so a run outside a batch is invisible.
- `client/.../EvalsTab/helpers.ts:52-56` — `expectationType()` derives the kind
  from JSON on every render; `EvalsTab.tsx:147-149` prints only an icon and the
  expectation count; `EvalsTab.tsx:11` states "there is no per-case run for agents".
- `client/.../EvalCaseModal/EvalCaseModal.tsx:79-127` — name + diff + expected
  JSON + Cancel/Save; title uses `evalsTab.newCase` ("New case") although
  `caseEditor.newCase` ("New eval case") already exists.
- `client/messages/en/eval.json` — `caseEditor.runCase`, `.running`,
  `.lastRunPassed`, `.lastRunFailed`, `.resultSummary`, `.newCase` already exist
  and are unused; no key exists for `must_find`/`must_not_flag`, the banner,
  `Actual output`, `Never run yet`, `Run on save` or the mismatch warning.
- `client/src/vendor/ui/kit/Modal.tsx:4-17` — `Modal` already takes a `subtitle`.
- `client/src/vendor/ui/primitives/Toggle.tsx:3-11` and `kit/Checkbox.tsx:5-13` —
  **neither takes a `disabled` prop** (`Button` does). `vendor/ui` is do-not-touch.
- `scripts/verify.mjs:107-133` — the five lanes; `scripts/pr-gate-ci.mjs:119-132`
  — an **added** migration file is explicitly fine (`addedIsFine: true`), only
  modifying an applied one is CRITICAL; the same gate checks the two
  `@devdigest/shared` copies for drift.
- `.github/workflows/evals.yml` — runs on PRs touching `.claude/**`; this branch
  touches only `.claude/plans/*.md`, which routes to a printed SKIP.

## Requirements review

Every requirement in scope, quoted verbatim from the spec. The trailing
provenance/`verify:` tail of each AC (`(← … · verify: …)`) is metadata about the
criterion, not the criterion, and is omitted from the quote — nothing else is
trimmed. AC-1, AC-2, AC-5…AC-6, AC-8…AC-52 are out of scope (shipped) and are
not graded here.

| # | Requirement (verbatim) | Verdict | How the plan handles it |
|---|------------------------|---------|-------------------------|
| AC-3 | КОЛИ користувач натискає `Turn into eval case` на **прийнятій** знахідці, система повинна (shall) створити eval-кейс із `owner_kind: "agent"`, `expectation_kind: "must_find"`, власником — агентом рев'ю цієї знахідки, `input_diff` — патчем файлу знахідки з цього PR і `expected_output.findings` — одним записом із `file`, `start_line`, `end_line`, `severity`, `category`, `title` знахідки, без проміжної форми. | clear | Everything but `expectation_kind` already ships (`service.ts:156-186`). Step 4 persists `must_find` from the **decision** (`accepted`), never from the JSON it just built. Step 11 asserts the row. |
| AC-4 | КОЛИ користувач натискає `Turn into eval case` на **відхиленій** знахідці, система повинна (shall) створити кейс із `expectation_kind: "must_not_flag"`, тим самим `input_diff` і `expected_output.findings: []`, а посилання на відхилену знахідку (`file`, рядки, заголовок) зберегти в `notes` як довідку для людини, не як предмет скорингу. | clear | Same step 4 branch; `notes` and the empty `findings` already ship unchanged. |
| AC-7 | Система повинна (shall) показувати в редакторі агента вкладку `Evals` (`?tab=evals`) поряд із `Config` · `Skills` · `Context`, а в ній — усі кейси набору агента з ім'ям, типом очікування, **надрукованим словами `must_find` або `must_not_flag`** (іконка й лічильник очікувань лишаються, але жоден із них не є носієм типу), статусом останнього прогону (`passed` / `failed` / `errored` / `never run`) і кількістю «пройдено з усіх». | clear | Tab, name, status and the counter already ship. Step 10 adds the word next to the existing icon+count badge, read from the **stored** field via step 5's helper (step 3 supplies the two keys). |
| AC-53 | Система повинна (shall) зберігати тип очікування агентського кейса окремим полем зі значенням `must_find` або `must_not_flag` і віддавати його на дроті як `expectation_kind` у контракті `EvalCase`, присутньому в **обох** копіях `@devdigest/shared`; значення призначає сервер (клієнт його не надсилає, надіслане — ігнорується), а кейси з `owner_kind: "skill"` лишаються без нього. | clear | Step 1 (both copies, one step) + step 2 (column) + step 4 (server assigns). The field is deliberately **not** added to `EvalCaseInput`, so a client that sends it is stripped by the existing `z.object()` on `POST /eval-cases`; on `PUT` the existing `.strict()` body 422s it — see **Open questions** for that reading. |
| AC-54 | КОЛИ користувач створює кейс вручну (`New case` → `POST /eval-cases`), система повинна (shall) один раз, у момент створення, визначити `expectation_kind` за `expected_output` (непорожній `findings` → `must_find`; порожній, відсутній або нерозпізнаний скорером → `must_not_flag`) і зберегти результат. | clear | Step 4 in `EvalService.create`, using the module's own `expectedFindings()` (`helpers.ts:42-45`) — the same function the scorer reads, so the two cannot drift. |
| AC-55 | ЯКЩО користувач редагує кейс (ім'я, `input_diff` або `expected_output`), ТОДІ система не повинна (shall not) змінювати збережений `expectation_kind`: після будь-якого збереження `GET /eval-cases/:id` віддає той самий тип, що й до нього. | clear | Structural: `UpdateEvalCase` (step 2) never carries the field, and neither `EvalRepository#updateCase` nor `SkillsRepository#updateEvalCase` can set it. Step 4 also makes the shared `PUT` **answer** with the unchanged kind, so step 11 can assert it as observable behaviour — the spec's own demand that this not be a side effect of a Zod strip. |
| AC-56 | Система повинна (shall) після міграції мати `expectation_kind` проставленим у **кожного** наявного агентського кейса за тим самим правилом, що AC-54 (непорожній `expected_output.findings` → `must_find`, інакше `must_not_flag`), і порожнім у кожного кейса скіла. | clear | Step 2: the backfill `UPDATE … WHERE owner_kind = 'agent'` rides in the **same** new migration as the `ADD COLUMN`, so `pnpm db:migrate` leaves no agent row without a kind. Skill rows are untouched and stay `NULL`. Edge divergence on a malformed `findings` array is named in **Risks**. |
| AC-57 | Система повинна (shall) обчислювати метрики й `pass` виключно з `expected_output` кейса: `expectation_kind` є записаним наміром і підписом, скорер його не читає й не приймає як аргумент. | clear | Already true (`scoring.ts:96-120` takes counts only) and this plan adds no parameter to it. Step 11 asserts a case whose stored kind contradicts its expectations still scores by the expectations. |
| AC-58 | ЯКЩО збережений `expectation_kind` суперечить `expected_output` (`must_find` без жодного очікування або `must_not_flag` з непорожнім `findings`), ТОДІ система повинна (shall) показати в редакторі кейса й у його рядку вкладки `Evals` текстове попередження, що називає і збережений тип, і фактичну кількість очікувань, при цьому не змінюючи ні тип (AC-55), ні спосіб скорингу (AC-57). | clear | Step 5's `expectationMismatch()` (one predicate, both surfaces), rendered by step 10 (row) and step 9 (modal) from step 3's single key with both placeholders. |
| AC-59 | КОЛИ користувач відкриває редактор кейса, система повинна (shall) показати в шапці модалки заголовок `New eval case` (для нового кейса) і під ним підзаголовок, що називає походження кейса; для кейса, зробленого з **прийнятої** знахідки, підзаголовок дослівно `Seeded from an accepted finding · assert the expected output`. | clear | Step 9 switches the title to the existing `caseEditor.newCase` key and passes step 5's `caseOrigin()` to pick one of three subtitles (step 3); `Modal` already accepts `subtitle`. Origin derivation is pinned in **Contract & migration impact**. |
| AC-60 | ПОКИ відкритий кейс має `expectation_kind: "must_find"`, редактор повинен (shall) показувати банер із заголовком `POSITIVE CASE` і рядком `MUST find "<заголовок очікування>" at <file>:<start_line>` на кожен запис `expected_output.findings`; коли в записі немає `title`, у лапки береться ім'я кейса. | clear | Step 9, one line per entry (not just the first), `title ?? evalCase.name`, all copy from step 3's `caseEditor.banner.*`. |
| AC-61 | ПОКИ відкритий кейс має `expectation_kind: "must_not_flag"`, редактор повинен (shall) показувати банер із заголовком `NEGATIVE CASE` і текстом `MUST NOT flag`. | clear | Step 9, same component, other branch. |
| AC-62 | Система повинна (shall) передавати тип кейса в банері словами (`POSITIVE CASE` / `NEGATIVE CASE`, `MUST find …` / `MUST NOT flag`), а не кольором: два варіанти візуально різні (синій і бурштиновий у макеті), але зміст лишається читабельним без кольору, а вся копія банера береться з `client/messages/en/eval.json`, не хардкодиться в компоненті. | clear | Step 3 owns the copy; step 9 reads keys only and colours the banner additively (`--accent` / `--warn`). Its test asserts the words, never a colour token. |
| AC-63 | КОЛИ користувач натискає в підвалі редактора кнопку прогону (`Run case`), система повинна (shall) прогнати рівно цей один кейс проти агента-власника — один виклик моделі — і показати результат у панелі `Actual output`. | clear | Step 6 adds `POST /agents/:id/eval-cases/:caseId/run` (mechanism decided in **Decisions taken**), step 7 the hook, step 9 the footer button and the panel. Step 11 asserts exactly one provider call and one new `eval_runs` row. |
| AC-64 | ПОКИ триває прогін кейса, кнопка прогону повинна (shall) бути у стані `Running…` і вимкненою, а повторне натискання — не стартувати другий виклик моделі. | clear | Step 9 binds `disabled` to `mutation.isPending` and returns early in the handler (the same two-layer guard `EvalsTab.tsx:78-81` uses); label from the existing `caseEditor.running`. |
| AC-65 | КОЛИ прогін кейса завершився успішно, панель `Actual output` повинна (shall) показати ознаку `pass`/`fail`, три метрики й тривалість цього прогону і знахідки, які видала модель, — екранованим текстом. | clear | Step 9, from the returned `EvalRunRecord` (`pass`, three metrics, `duration_ms`, `actual_output.findings`); copy reuses the existing `lastRunPassed`/`lastRunFailed`/`resultSummary` keys. Text nodes only. |
| AC-66 | ПОКИ кейс не має жодного прогону, панель `Actual output` повинна (shall) показувати `Never run yet` і не показувати нулів метрик, які читаються як результат. | clear | Step 9 branches on "no run object at all" (the `lastRun` prop from step 10 is `undefined`), never on a zero-filled metrics object — the same rule `EvalsTab.tsx:20-26` documents for `dashboard.current`. |
| AC-67 | ДЕ увімкнено перемикач `Run on save`, система повинна (shall) після **успішного** збереження кейса одразу прогнати саме цей кейс; перемикач вимкнений при кожному відкритті модалки, сам по собі нічого не запускає, а при вимкненому перемикачі збереження не робить жодного виклику моделі. | clear | Step 9: `useState(false)` (never persisted), the run fires only after `mutateAsync` resolves, and the existing `catch { return; }` guarantees a failed save reaches no run. Provider-call counts asserted in step 9's RTL test and step 11. |
| AC-68 | ЯКЩО ключ LLM-провайдера агента не налаштований (409 `no_provider_key`), ТОДІ редактор кейса повинен (shall) вимкнути і кнопку прогону, і перемикач `Run on save`, показавши те саме пояснення, що AC-24, і не повторювати запитів, які не можуть удатися. | clear | Step 9 via the existing `isNoProviderKeyError` predicate and the existing `evalsTab.noProviderKey` copy. **The vendored `Toggle` has no `disabled` prop** — the sanctioned route is a guarded handler + `aria-disabled` wrapper + the textual reason; see **Risks**. |
| AC-69 | ЯКЩО прогін кейса з редактора впав (помилка провайдера, таймаут, порожній `input_diff`), ТОДІ система повинна (shall) показати причину в панелі `Actual output`, лишити модалку відкритою з набраним текстом кейса на місці й не змінити жодного агрегату агента. | clear | Step 6 mirrors the batch's per-case degradation: the route answers **200** with an errored `EvalRunRecord` (`pass: null`, `error: {code,message}`, never the diff text). Step 9 renders the reason and never closes the modal. Aggregates are batch-derived, so they cannot move (AC-71). |
| AC-70 | КОЛИ прогін одного кейса завершився, вкладка `Evals` повинна (shall) показати для цього кейса новий статус останнього прогону (`passed` / `failed` / `errored`) без ручного перезавантаження сторінки. | clear | Step 8 widens `EvalDashboard.recent_runs` to also carry the newest **batch-less** run per case; step 7's mutation invalidates `["agent-eval-dashboard", agentId]` so the tab re-reads it. No client-side merging of a mutation result — the same rule `helpers.ts:5-11` already states. |
| AC-71 | ЯКЩО прогін зроблено для одного кейса, ТОДІ він не повинен (shall not) з'являтися як батч у таблиці прогонів дашборда, у тренді, у sparkline і в банері регресії: прогін одного кейса не порівнюваний із прогоном усього набору. | clear | Structural: `recentBatches`/`recentBatchesPerAgent` keep their `isNotNull(batchId)` filter (`repository.ts:244`, `:305`), and `recent_batches`/`trend`/`alert`/`current`/`GET /eval/overview` all derive from them. Step 8 touches only `recent_runs`; step 7 does **not** invalidate `["eval-overview"]`. |
| Edge case | **Кейс, створений до появи `expectation_kind`** → міграція проставляє тип за сьогоднішнім виведенням із `expected_output`; кейси скілів лишаються без типу. → AC-56 | clear | Rides on AC-56 (step 2), asserted in step 11 against rows inserted before the column existed. |
| Edge case | **`must_find`-кейс відредаговано до `expected_output.findings: []`** → тип лишається `must_find` … скоринг іде за очікуваннями — recall 1, будь-яка знахідка б'є precision, — а редактор і рядок кейса показують попередження про розбіжність. → AC-55, AC-57, AC-58 | clear | Steps 4/11 (kind survives the PUT), step 5+9+10 (warning). |
| Edge case | **Тип і очікування суперечать одне одному** → у скорингу виграють очікування, у підписі й наміру — збережений тип; обидва названі поруч у попередженні, автоматичного «виправлення» не відбувається. → AC-57, AC-58 | clear | Same three steps; nothing anywhere rewrites the stored kind. |
| Edge case | **`must_not_flag`-кейс, якому руками дописали очікування** → дзеркальний випадок того самого правила … → AC-55, AC-57, AC-58 | clear | `expectationMismatch()` (step 5) covers both directions; step 10's test asserts both. |
| Edge case | **Кейс, у якого в очікуванні немає `title`** (руками створений `must_find`) → банер бере в лапки ім'я кейса замість заголовка. → AC-60 | clear | Step 9, asserted. |
| Edge case | **`must_find`-кейс із кількома очікуваннями** → банер друкує рядок `MUST find …` на кожне очікування, а не лише перше. → AC-60 | clear | Step 9, asserted with two entries. |
| Edge case | **Прогін кейса, якого ще жодного разу не проганяли** → `Actual output` показує `Never run yet`, нулів метрик немає. → AC-66 | clear | Step 9. |
| Edge case | **Прогін кейса з редактора, коли ключа провайдера немає** → кнопка прогону й перемикач `Run on save` вимкнені з тим самим поясненням, запиту немає. → AC-68 | clear | Step 9 + the `Toggle` workaround in **Risks**. |
| Edge case | **Прогін кейса з редактора впав посеред виконання** → причина в `Actual output`, модалка лишається відкритою з набраним текстом, агрегати агента не рухаються. → AC-69 | clear | Steps 6 + 9; step 11 asserts the agent's dashboard aggregates before/after. |
| Edge case | **Прогін одного кейса й дашборд** → рядок кейса у вкладці оновлюється, але окремим батчем у таблиці, тренді й банері регресії цей прогін не стає. → AC-70, AC-71 | clear | Step 8 (one read widened, three left alone); step 11 asserts both halves in one test. |
| Edge case | **`Run on save` увімкнено, а збереження впало** → прогін не стартує (умова — саме **успішне** збереження), модалка лишається відкритою з помилкою збереження. → AC-67, AC-10 | clear | Step 9: the run call sits after `await mutateAsync(...)` inside the existing try, so the `catch { return; }` short-circuits it. |
| Edge case | **Кейс скіла в спільних роутах** (`PUT /eval-cases/:id`, `POST /eval-cases/:id/run`) → `expectation_kind` лишається порожнім, банер і per-case агентський прогін до нього не застосовуються. → AC-53, AC-56, **Non-goals** | clear | The skills module keeps its own route and its 400 `unsupported_eval_owner`; the new agent run route is a different path (step 6). Step 4's one-line DTO change adds the field for **both** owners, which for a skill case is `null`. |
| NFR | **Вартість і побічні ефекти** — … Прогін одного кейса з редактора коштує рівно один виклик моделі (AC-63) і теж лишається людським жестом: або натиснута кнопка прогону, або `Save` при перемикачі `Run on save`, який користувач у цій самій модалці свідомо ввімкнув і який вимкнений при кожному відкритті (AC-67). Відкриття модалки, редагування полів і збереження без перемикача не коштують нічого. | clear | Steps 6, 7, 9. Nothing runs on mount, on open or on save with the toggle off; step 9's test counts provider calls on both save paths, step 11 counts them server-side. |
| NFR | **Тестові лейни** — прогін витрачає гроші, тому e2e-флоу його не торкається … Усе, що вимагає моделі, перевіряється в `*.it.test.ts` з провайдером, підміненим через слот контейнера. | clear | Step 11 only; no e2e flow is added or touched, and no lane in the **Verification plan** spends a token. |
| NFR | **Контракти** — … Те саме стосується `expectation_kind` (AC-53): поле перетинає дріт, тож живе в канонічній `server/src/vendor/shared/contracts/knowledge.ts` і **дзеркалиться** в `client/src/vendor/shared/contracts/knowledge.ts` … Спільний `PUT /eval-cases/:id` … мовчки обрізає невідомі ключі тіла …, тож незмінність типу (AC-55) має бути **перевіреною поведінкою**, а не побічним ефектом Zod-стрипу. Прогін одного агентського кейса (AC-63) теж є новою зовнішньою поверхнею: шлях `POST /eval-cases/:id/run` уже зайнятий скіловим модулем …, тому повторна реєстрація того самого method+path неможлива. | clear | Step 1 moves both copies in one step; step 11 asserts the PUT round-trip explicitly; step 6 registers a **new** path in the `eval` module — mechanism and trade-off in **Decisions taken**. |
| NFR | **Міграції** — нові колонки `eval_runs` і `eval_cases.expectation_kind` додаються окремими міграціями, лише адитивно … Заповнення типу для вже наявних рядків (AC-56) — частина того самого адитивного кроку, а не окрема ручна процедура: після `pnpm db:migrate` жоден агентський кейс не лишається без типу. | clear | Step 2: one new additive migration (`ADD COLUMN` + backfill `UPDATE` + `CHECK`), no applied file edited, `pnpm db:migrate` named in the **Verification plan**. |
| NFR | **Секрети** — … `input_diff` кейса … не логується і не потрапляє в повідомлення про помилки. | clear | Step 6 reuses the batch runner's `describeCaseFailure` (`runner.ts:254-260`), which builds every message from the case **name** or the underlying error, never from `row.inputDiff`. |
| NFR | **Доступність** — … Тип кейса читається словами, а не іконкою чи кольором: `must_find` / `must_not_flag` у списку кейсів (AC-7) і `POSITIVE CASE` / `NEGATIVE CASE` в банері редактора (AC-62); розбіжність типу й очікувань теж текстова (AC-58), а вимкнені кнопка прогону й перемикач `Run on save` несуть текстову причину (AC-68). | clear | Steps 9 + 10; every assertion is on text, and the disabled reason renders as a visible node, not only as a `title` attribute. |
| NFR | **Спостережуваність** — кожен прогін лишає рядок `eval_runs` з тривалістю, вартістю й версією агента; прогін одного кейса лишає такий самий рядок, але поза батчем, тож він видимий у статусі кейса (AC-70) і невидимий в агрегатах агента (AC-71). Нових логів недовіреного тексту не додається. | clear | Step 6 persists one row per single-case run — **including a failed one** — with `batch_id: null` and `agent_version` stamped. This NFR is what settles "does a failed run leave a row": it does. |
| NFR | **i18n** — … з доопрацювання 27/08/2026 — підзаголовок редактора кейса, заголовки й тексти банерів `POSITIVE CASE` / `NEGATIVE CASE`, підписи `must_find` / `must_not_flag`, `Actual output`, `Never run yet`, `Run on save` і текст попередження про розбіжність типу й очікувань — живуть у `client/messages/en/eval.json` поруч із наявними ключами і не хардкодяться в компонентах. | clear | Step 3 owns the file and adds exactly that list; steps 9 and 10 read keys only. Nothing enforces this mechanically — see **Risks**. |
| Untrusted inputs | **Текст банера позитивного кейса** — рядок `MUST find "<заголовок>" at <file>:<line>` (AC-60) складається із заголовка й координат **очікування** … Обидва рендеряться лише як екранований текстовий вузол усередині рядка з `client/messages/en/eval.json`, ніколи як розмітка й ніколи не як інструкція; довгий заголовок обрізається візуально, а не ламає модалку. | clear | Step 9: `next-intl` interpolation into a text node, no `dangerouslySetInnerHTML`, no `Markdown`; overflow clipped in `styles.ts`. |
| Untrusted inputs | **Знахідки в панелі `Actual output`** — вивід моделі з прогону одного кейса (AC-65) і причина збою (AC-69) — той самий режим …: екранований текст, без інтерпретації розмітки, без потрапляння в логи. | clear | Step 9, text nodes only; the reason string comes from the server's `{code,message}`, which step 6 keeps free of diff content. |

## Decisions taken

- **Execution mode: multi-agent.** *human-answered* — stated in the delegation
  ("Execution mode: multi-agent — executed by the `/implement` chain. Do not ask
  the mode question").
- **The four requirements in scope** — *human-answered* (27/08/2026): "(1) the
  expectation kind becomes a stored, wire-visible fact set from the finding's
  decision (accepted → `must_find`, dismissed → `must_not_flag`); (2) the case
  editor gets the `POSITIVE CASE` / `NEGATIVE CASE` banner with the design's
  verbatim copy; (3) a single case can be run from the case editor; (4) the agent
  editor's `Evals` list labels each case with its kind in words."
- **Input tabs (`Diff`/`Files`/`PR meta`) and `+ Finding skeleton` are out of
  scope** — *human-answered* (27/08/2026). Recorded verbatim under **Out of
  scope**; the unused `caseEditor.tabs.*` / `titleLabel` / `bodyLabel` /
  `preview` keys stay in place, untouched.
- **The spec's four new `[NEEDS CLARIFICATION]` defaults are taken as answers** —
  *human-answered* (27/08/2026, "they are the spec's own defaults and the human
  accepts them"): subtitle copy for dismissed-seeded and hand-made cases
  (`Seeded from a dismissed finding · assert the expected output` /
  `Created by hand · assert the expected output`); the kind is immutable after
  creation and no control exists to flip it; `Run on save` is off at every
  opening and is never persisted; no single-case run history beyond the latest
  result in `Actual output`.
- **Per-case run mechanism: a new agent-scoped path in the `eval` module,
  `POST /agents/:id/eval-cases/:caseId/run`.** *planner-decided* (the spec
  delegates the mechanism: "Який саме механізм обрати … — рішення плану; спека
  фіксує лише спостережувану поведінку", and the human authorised resolving it).
  Trade-off: the `agentId` is redundant (it is derivable from the case row), and
  the route must therefore 404 when the case is not owned by that agent — a check
  step 6 owns. Bought with that redundancy: the path mirrors the module's
  existing `POST /agents/:id/eval-runs`, ownership is visible in the URL, and no
  `FST_ERR_DUPLICATED_ROUTE` risk exists on the flat router. **Rejected:**
  (a) teaching the skills-owned `POST /eval-cases/:id/run` to dispatch on
  `owner_kind` — it would make the skills module call the eval runner across a
  boundary `no-cross-module-internals` does not publish (`server/INSIGHTS.md:212-221`)
  and would move agent behaviour into the wrong module; (b) `POST /eval-cases/:id/agent-run`
  — no collision, but an owner-kind-qualified verb on a shared resource reads as
  a workaround and hides the ownership check the route still has to make.
- **AC-70/AC-71 visibility mechanism: widen `EvalDashboard.recent_runs` (the
  per-case read) to include the newest batch-less run per case; leave every
  batch-derived field alone.** *planner-decided*. `recent_runs` has exactly one
  consumer, the Evals tab (`EvalsTab.tsx:62` → `latestRunByCase`), while
  `recent_batches`, `trend`, `alert`, `current` and `GET /eval/overview` all come
  from the two `isNotNull(batchId)` reads — so AC-71 holds structurally rather
  than by a filter somebody must remember. Trade-off: the field's meaning widens
  ("every run row of the recent batches" → "per-case rows: recent batches plus
  the latest single-case run per case"), which is a wire-semantics change carried
  by a doc comment in both copies rather than by a new field. **Rejected:** a new
  `EvalDashboard.case_runs` array — a third wire field for data the tab already
  reduces to "latest per case", and two per-case reads that could disagree.
- **A failed single-case run answers 200 with an errored `EvalRunRecord` and
  persists its row.** *planner-decided*, settled by the spec's own NFR
  Спостережуваність ("кожен прогін лишає рядок `eval_runs` … прогін одного кейса
  лишає такий самий рядок, але поза батчем"). Only "agent/case not found" (404)
  and "no provider key" (409, raised before any model call or DB write) are
  non-2xx. Trade-off: the client must read `error` on a 200 body, not only the
  mutation's rejection — pinned in **Contract & migration impact**.
- **`expectation_kind` is `text` + a `CHECK`, nullable, no index.**
  *planner-decided*, per `postgresql-table-design` ("for business-logic-driven and
  evolving values → use TEXT + CHECK"), matching the table's existing
  `owner_kind` style; `NULL` passes a CHECK by three-valued logic, which is
  exactly what skill rows need. No index: nothing filters on it.
- **The modal stays open after a `Run on save` save.** *planner-decided*.
  Closing on save would make the panel AC-65 describes flash away unread and the
  toggle's only observable effect invisible. Trade-off: `Save` no longer always
  closes the modal — it closes only when the toggle is off. See **Open questions**.

## Recommendations

- **Delete `expectationType()` (the JSON derivation) in a follow-up once every
  environment has run the migration.** Why: it is the mechanism the spec calls
  "мовчки перетворює його на `must_not_flag`" (`client/.../EvalsTab/helpers.ts:54-56`),
  and this plan keeps it only as a defensive fallback for a row with no stored
  kind. If accepted later: step 5's helper loses its fallback branch and a null
  kind renders no label at all. Default: as requested (keep the fallback now).
- **`skills/helpers.ts#toEvalCaseDto` also omits `source_finding_id`.** Why: the
  shared `PUT /eval-cases/:id` answers with that DTO, so an agent case
  round-tripped through it loses provenance the eval module's own DTO carries
  (`service.ts:234`). Step 4 fixes the new field only. If accepted: one more line
  in the same DTO and one more assertion in step 11. Default: as requested.
- **Add `data-testid`-free but stable anchors when step 9 grows the modal.** Why:
  the modal will hold four regions (banner, form, footer, `Actual output`) and
  RTL queries by text will be the only handle. If accepted: step 9 gives each
  region a heading or `role="region"`+`aria-label` from an i18n key. Default: as
  requested.

## Constraints that bind this change

- **Does anything cross the wire?** Yes — `EvalCase.expectation_kind` (AC-53) and
  the widened meaning of `EvalDashboard.recent_runs` (AC-70). Both copies of
  `@devdigest/shared` move in **one** step each (step 1, step 8), never in two
  that could be split across lanes. `scripts/pr-gate-ci.mjs` checks the two
  copies for drift.
- **Contracts are Zod-first.** The new field is a `z.enum` in the canonical
  contract; the new route declares `params` and `response` on the route
  (`EvalRunRecord`, an existing contract — no new response shape is invented).
  No handler parses a body by hand.
- **Migrations.** One **new** additive migration (`ADD COLUMN` + backfill
  `UPDATE` + `CHECK`), generated by `pnpm db:generate`; the backfill is
  hand-appended to that new, **unapplied** file. No applied `*.sql` is edited.
  `pnpm db:migrate` does not run on boot and is named in the verification plan.
- **Test lane.** Every DB-backed assertion lands in the existing
  `server/test/eval.it.test.ts` (`.it.test.ts` glob = integration lane). Pure
  helpers and components stay in the unit/frontend lanes.
- **Package manager per step.** `server/` and `client/` → pnpm. No `reviewer-core/`,
  `e2e/` or `mcp/` file is touched, so no npm package is installed anywhere.
- **`reviewer-core` never emits JS** — not affected: it is consumed unchanged
  through `reviewPullRequest`, and no file in it is edited.
- **Do-not-touch paths** — `server/clones/**`: not affected. Applied
  `server/src/db/migrations/*.sql`: not edited; a new file is added, which
  `pr-gate-ci.mjs:119-132` explicitly allows. `**/src/vendor/ui/**`: not edited —
  and AC-68 must be satisfied **without** adding a `disabled` prop to the
  vendored `Toggle` (see **Risks**).
- **Layering.** Backend work stays inside the existing `eval` module's
  routes → service/runner → repository split; no new port, adapter, DI slot or
  module is introduced, so `server/.dependency-cruiser.cjs` sees no new edge. The
  one cross-module touch is a single line in `skills/helpers.ts`, inside that
  module's own file — not an import across the boundary.

## Steps

| # | Change | Files / seams | Slice | Satisfies | Depends on | Executor | Skills the executor applies | Verification |
|---|--------|---------------|-------|-----------|------------|----------|-----------------------------|--------------|
| 1 | Wire: add `ExpectationKind = z.enum(['must_find','must_not_flag'])` and `expectation_kind: ExpectationKind.nullish()` to `EvalCase` in **both** `@devdigest/shared` copies, with the doc comment pinning: server-assigned at creation, immutable afterwards (AC-55), absent/`null` for `owner_kind: "skill"`, never sent by a client. **Do not** add it to `EvalCaseInput` — the existing non-strict `z.object()` on `POST /eval-cases` already strips a sent value, which is AC-53's "ignored". Before finishing, grep the whole tree for hand-built `EvalCase` literals (`rg -n 'owner_kind: *"agent"' client/src server/src`) and confirm `.nullish()` leaves every one of them compiling (root `INSIGHTS.md` 2026-08-26) | `server/src/vendor/shared/contracts/knowledge.ts:144-165`, `client/src/vendor/shared/contracts/knowledge.ts:132-149` | contracts (backend + frontend) | AC-53, NFR Контракти | — | `implementer` | `zod` | `node scripts/verify.mjs --slice backend --slice frontend` |
| 2 | DB: add `expectationKind: text('expectation_kind', { enum: ['must_find','must_not_flag'] })` (nullable) to `evalCases`, plus a `check('eval_cases_expectation_kind_ck', …)` in the table's extra config; run `cd server && pnpm db:generate` (additive-only, so no interactive prompt — root `INSIGHTS.md` 2026-08-05), **keep the generated file name**, and hand-append to that same new, unapplied migration the AC-56 backfill: `UPDATE "eval_cases" SET "expectation_kind" = CASE WHEN jsonb_typeof("expected_output"->'findings') = 'array' AND jsonb_array_length("expected_output"->'findings') > 0 THEN 'must_find' ELSE 'must_not_flag' END WHERE "owner_kind" = 'agent';` (statements separated by `--> statement-breakpoint`; skill rows deliberately untouched). If `db:generate` did not emit the CHECK, write the `ALTER TABLE … ADD CONSTRAINT` into the same file, after the backfill. Read the generated SQL before applying. Also in `types.ts`: `InsertEvalCase.expectationKind?: 'must_find' \| 'must_not_flag'`, `UpdateEvalCase` deliberately **without** it (AC-55 is structural), and widen `InsertEvalRun.batchId` to `string \| null` (a one-line forward declaration step 6 needs) | `server/src/db/schema/eval.ts:19-48`, `server/src/db/migrations/00xx_*.sql` (**new** file), `server/src/modules/eval/types.ts:21-62` | backend | AC-53, AC-55, AC-56, NFR Міграції | — | `implementer` | `drizzle-orm-patterns`, `postgresql-table-design` | `cd server && pnpm db:migrate` → `node scripts/verify.mjs --slice backend` |
| 3 | i18n: add to `eval.json` — `evalsTab.kind.mustFind` = `must_find`, `evalsTab.kind.mustNotFlag` = `must_not_flag`; `evalsTab.kindMismatch` (one string naming **both** the stored kind and the actual expectation count, reused by the row and the modal); `caseEditor.subtitleAccepted` = `Seeded from an accepted finding · assert the expected output` (verbatim, AC-59), `caseEditor.subtitleDismissed` = `Seeded from a dismissed finding · assert the expected output`, `caseEditor.subtitleManual` = `Created by hand · assert the expected output`; `caseEditor.banner.positiveTitle` = `POSITIVE CASE`, `banner.negativeTitle` = `NEGATIVE CASE`, `banner.mustFind` = `MUST find "{title}" at {file}:{line}`, `banner.mustNotFlag` = `MUST NOT flag`; `caseEditor.actualOutput` = `Actual output`, `caseEditor.neverRun` = `Never run yet`, `caseEditor.runOnSave` = `Run on save`, `caseEditor.runFailed` (reason line), `caseEditor.runNeedsSave` (why `Run case` is disabled on an unsaved case). Reuse — do not duplicate — the existing `caseEditor.newCase`/`runCase`/`running`/`lastRunPassed`/`lastRunFailed`/`resultSummary` and `evalsTab.noProviderKey`. Leave `caseEditor.tabs.*`, `titleLabel`, `bodyLabel`, `preview` unused and in place (Non-goals) | `client/messages/en/eval.json` | frontend | AC-7, AC-58, AC-59, AC-60, AC-61, AC-62, AC-65, AC-66, AC-67, AC-68, NFR i18n | — | `implementer` | `frontend-ui-architecture` | `node scripts/verify.mjs --slice frontend` |
| 4 | Server write path: in `EvalService.create`, derive the kind **once** with the module's own `expectedFindings(input.expected_output)` (non-empty → `must_find`, else `must_not_flag` — AC-54) and pass it to `insertCase`; in `createCaseFromFinding`, set it from the **decision** (`accepted ? 'must_find' : 'must_not_flag'` — AC-3/AC-4), never from the `expectedOutput` it just built; map the column in the eval module's `toEvalCaseDto`. In `EvalRepository#insertCase` write the column; `updateCase` stays untouched (AC-55). One line in `skills/helpers.ts#toEvalCaseDto`: `expectation_kind: row.expectationKind ?? null`, so the **shared** `PUT`/`DELETE` surface stops answering with a field-less case (AC-55 becomes observable, per NFR Контракти). Nothing else in the skills module changes | `server/src/modules/eval/service.ts:64-84,156-186,223-236`, `server/src/modules/eval/repository.ts:122-146`, `server/src/modules/skills/helpers.ts:71-83` | backend | AC-3, AC-4, AC-53, AC-54, AC-55 | 1, 2 | `implementer` | `onion-architecture`, `drizzle-orm-patterns` | `node scripts/verify.mjs --slice backend` |
| 5 | Client helpers (pure, no rendering): `expectationKindOf(evalCase)` — the **stored** field, falling back to the existing `expectationType(expected_output)` only when it is absent (documented as defensive: after AC-56 no agent case lacks one); `expectationMismatch(evalCase)` → `null` or `{ kind, count }` when `must_find` has zero expectations or `must_not_flag` has some (AC-58, both directions); `caseOrigin(evalCase)` → `"accepted" \| "dismissed" \| "manual"` from `source_finding_id` + the stored kind (pinned in **Contract & migration impact**). Keep `expectedFindings`/`expectationType` exported — the fallback and the count both read them. Extend `helpers.test.ts`-style unit coverage in the tab's existing test file if none exists standalone | `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/helpers.ts` | frontend | AC-7, AC-58, AC-59 | 1 | `implementer` | `frontend-ui-architecture`, `react-best-practices` | `node scripts/verify.mjs --slice frontend` |
| 6 | Per-case agent run: extract the batch runner's per-case preamble (agent lookup, `resolveLlm`, enabled linked-skill bodies) into one private helper so the single-case path assembles the **same** prompt the batch does — a second, subtly different assembly would make a single-case result incomparable with the batch's for the same case. Add `EvalRunner#runSingleCase(workspaceId, agentId, caseId)`: 404 when the agent or the case is missing **or the case is not agent-owned or not owned by that agent**; 409 `no_provider_key` before any DB write; then run one case, catch failure exactly as the batch loop does (`describeCaseFailure` — never the diff text), persist **one** `eval_runs` row with `batchId: null` and `agentVersion` stamped, and return an `EvalRunRecord`. Add `EvalRepository#insertRun(row): Promise<EvalRunRow>` (single-row sibling of `insertRunBatch`). Register `POST /agents/:id/eval-cases/:caseId/run` in the eval module with a local two-param zod `params` schema and `response: { 200: EvalRunRecord }` | `server/src/modules/eval/runner.ts:62-260`, `server/src/modules/eval/repository.ts:180-203`, `server/src/modules/eval/routes.ts:119-128` | backend | AC-63, AC-69, NFR Спостережуваність, NFR Секрети | 2, 4 | `implementer` | `onion-architecture`, `fastify-best-practices`, `zod` | `node scripts/verify.mjs --slice backend` |
| 7 | Client hook `useRunAgentEvalCase()`: `mutationFn: ({ agentId, caseId }) => api.post<EvalRunRecord>(\`/agents/${agentId}/eval-cases/${caseId}/run\`)`, `onSuccess` invalidates `["agent-eval-dashboard", agentId]` **only** — never `["eval-overview"]` (AC-71) — and `meta: { ownErrorToast: true }` because the modal renders its own reason (`client/INSIGHTS.md` 2026-08-26). Add its own hook test (`QueryClientProvider` + URL-suffix-matched `fetch` stub, pattern in `hooks/onboarding.test.tsx`). **In the same step**, add the stub to the `vi.mock("@/lib/hooks/eval", …)` factories of every suite whose render path reaches `EvalCaseModal` — `EvalsTab.test.tsx:24` and `EvalCaseModal.test.tsx:19` — or the whole file dies with `No "useRunAgentEvalCase" export is defined on the mock` (`client/INSIGHTS.md` 2026-08-20); run the full frontend lane to catch any other | `client/src/lib/hooks/eval.ts:148-163`, `client/src/lib/hooks/eval.test.tsx`, `client/.../EvalsTab/EvalsTab.test.tsx` (mock factory only), `client/.../EvalCaseModal/EvalCaseModal.test.tsx` (mock factory only) | frontend | AC-63, AC-70, AC-71 | 1 | `implementer` | `frontend-ui-architecture`, `react-best-practices`, `react-testing-library` | `node scripts/verify.mjs --slice frontend` |
| 8 | Dashboard read: add `EvalRepository#latestBatchlessRunPerCase(workspaceId, agentId)` — for `owner_kind = 'agent'` cases of that agent, the **newest** `eval_runs` row per case where `batch_id IS NULL` (one row per case, joined for `case_name`, one query) — and merge it into `getEvalDashboard`'s `recent_runs` through the existing `toRunRecord`. `recent_batches`, `trend`, `delta`, `alert`, `current` and `getEvalOverview` keep reading the two `isNotNull(batchId)` paths untouched (AC-71). Update the `recent_runs` doc comment in **both** `@devdigest/shared` copies to say what it now carries | `server/src/modules/eval/repository.ts` (new method), `server/src/modules/eval/dashboard.ts:280-377`, `server/src/vendor/shared/contracts/eval-ci.ts:182-186`, `client/src/vendor/shared/contracts/eval-ci.ts` (same block) | backend + contracts | AC-70, AC-71, NFR Продуктивність | 2, 6 | `implementer` | `onion-architecture`, `drizzle-orm-patterns` | `node scripts/verify.mjs --slice backend --slice frontend` |
| 9 | `EvalCaseModal` rewrite (same folder, same modal shape): title from `caseEditor.newCase` for a new case (AC-59); `Modal`'s existing `subtitle` prop fed by `caseOrigin()`; the kind banner above the form — `POSITIVE CASE` + one `MUST find "{title}" at {file}:{line}` line **per** expectation (`title ?? evalCase.name`), or `NEGATIVE CASE` + `MUST NOT flag` — colour additive only; the mismatch warning from step 5; an `Actual output` panel rendering `Never run yet` when there is no run at all, else pass/fail + the three metrics + duration + the model's findings as **text nodes**, and the `{code,message}` reason on an errored run; footer gains `Run case` (disabled while pending and on an unsaved new case, label `caseEditor.running` while running) and a `Run on save` toggle (`useState(false)`, never persisted) that fires the run **after** `mutateAsync` resolves — inside the existing try, so a failed save reaches no run — and keeps the modal open. 409 `no_provider_key` disables both: the button by its `disabled` prop, the toggle by a guarded `onChange` + `aria-disabled` wrapper + the visible `evalsTab.noProviderKey` reason (**the vendored `Toggle` has no `disabled` prop** — do not edit `vendor/ui`). New props `{ lastRun }` per **Contract & migration impact**. Tests with `fireEvent`, never `userEvent` (`client/INSIGHTS.md` 2026-08-26) | `client/.../EvalsTab/_components/EvalCaseModal/EvalCaseModal.tsx`, `.../helpers.ts`, `.../constants.ts`, `.../styles.ts`, `.../EvalCaseModal.test.tsx` | frontend | AC-58, AC-59, AC-60, AC-61, AC-62, AC-63, AC-64, AC-65, AC-66, AC-67, AC-68, AC-69, NFR Доступність, Untrusted inputs | 3, 5, 7 | `implementer` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library` | `node scripts/verify.mjs --slice frontend` |
| 10 | `EvalsTab` row: print the kind **in words** next to the existing icon+count badge, from `expectationKindOf()` (stored field), and render the mismatch warning as text on the row (AC-58); pass `lastRun={latest.get(c.id)}` into `EvalCaseModal` (it is the same `latestRunByCase` map the row already builds, which after step 8 also knows about single-case runs); update the file's header comment, which currently states "there is no per-case run for agents". Nothing else about the row changes — status badge, recall suffix, edit/delete and the metrics section stay as they are | `client/.../EvalsTab/EvalsTab.tsx:1-26,132-165`, `.../styles.ts`, `.../EvalsTab.test.tsx` | frontend | AC-7, AC-58, AC-66, AC-70 | 3, 5 | `implementer` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library` | `node scripts/verify.mjs --slice frontend` |
| 11 | **Integration pass** — its own step because unit tests on either side of a seam agree with themselves by construction (`INSIGHTS.md` 2026-08-04). In `server/test/eval.it.test.ts`: an accepted finding mints `expectation_kind: "must_find"` and a dismissed one `must_not_flag` (AC-3/AC-4, row **and** wire); `POST /eval-cases` derives the kind once (AC-54) including the malformed-`expected_output` branch; `PUT /eval-cases/:id` that rewrites `expected_output` to `[]` leaves the kind unchanged **in the PUT response and on a subsequent `GET /eval-cases/:id`** (AC-55), and a PUT carrying `expectation_kind` is rejected rather than silently applied; rows inserted **before** the column existed come back typed after `db:migrate`, and a skill-owned row stays `NULL` (AC-56); a case whose stored kind contradicts its expectations still scores by the expectations (AC-57); the new run route runs exactly one case with exactly **one** provider call (mock provider via the container slot), writes one `eval_runs` row with `batch_id NULL` + `agent_version` set, answers `EvalRunRecord` (AC-63), and on a provider failure answers 200 with `pass: null` + `error` and a persisted row while the agent's `current`/`recent_batches`/`trend`/`alert` are byte-identical before and after (AC-69, AC-71); that same run shows up in `GET /eval/dashboard`'s `recent_runs` for its case (AC-70) and in **no** batch, trend point or `GET /eval/overview` row (AC-71); 404 for a case belonging to another agent and 409 when no provider key is configured. Plus the cross-lane seam checks: the client copy of `EvalCase` matches the server copy field-for-field, and the method+path step 7's hook posts to is the one step 6 registers | `server/test/eval.it.test.ts`; point fixes anywhere a seam check finds a mismatch | backend + integration | AC-3, AC-4, AC-53…AC-57, AC-63, AC-69, AC-70, AC-71 | 4, 6, 8, 9, 10 | `implementer` | `onion-architecture`, `drizzle-orm-patterns` | `cd server && pnpm db:migrate` → `node scripts/verify.mjs --slice integration` → `pnpm verify:l06` |
| 12 | Docs: `server/README.md`'s API map gains `POST /agents/:id/eval-cases/:caseId/run` (one case, no batch, one model call) and a line that `eval_cases.expectation_kind` is server-assigned and immutable; `client/README.md`'s Evals-tab/case-editor description gains the kind label, the positive/negative banner, the `Actual output` panel and `Run on save`. No `AGENTS.md` edit — nothing here changes a repo-wide convention | `server/README.md`, `client/README.md` | meta | AC-53, AC-63 (scaffolding — documents the shipped surface) | 11 | `doc-writer` | — (`meta`) | `node scripts/check-specs.mjs`; re-reading |

## Execution

**multi-agent** — the `/implement` chain, orchestrated by the main session, which
commits between stages (with an explicit pathspec: another session may be on this
branch, root `INSIGHTS.md` 2026-08-26).

| Wave | Lanes | Steps | Why this split |
|---|---|---|---|
| 1 | 3 | 1 · 2 · 3 | Three disjoint roots: the wire, the database, the copy. Nothing in wave 1 imports anything else in wave 1. |
| 2 | 3 | 4 · 5 · 7 | The server write path, the client pure helpers and the client hook. Disjoint files; step 7's route contract is pinned in the plan, so it does not wait for step 6. |
| 3 | 1 | 6 | Alone: it edits `repository.ts` and `runner.ts`, and `repository.ts` was step 4's in wave 2. |
| 4 | 3 | 8 · 9 · 10 | Server read model, the modal folder, the tab file. Disjoint; step 9 and step 10 meet only at the `lastRun` prop, whose shape is pinned below. |
| 5 | 1 | 11 | Integration pass. Starts only when every wave-4 lane has reported `Steps: N/N`. |
| 6 | 1 | 12 | `/implement`'s docs stage. |

**Ownership** (paths a lane owns / must not touch):

| Wave | Lane | Steps | Owns | Must not touch |
|---|---|---|---|---|
| 1 | W1-A | 1 | `server/src/vendor/shared/contracts/knowledge.ts`, `client/src/vendor/shared/contracts/knowledge.ts` | `contracts/eval-ci.ts` (both copies — wave 4), `server/src/db/**`, `client/messages/**` |
| 1 | W1-B | 2 | `server/src/db/schema/eval.ts`, the **new** `server/src/db/migrations/*.sql`, `server/src/modules/eval/types.ts` | every applied `migrations/*.sql`, `server/src/vendor/shared/**`, the rest of `server/src/modules/eval/**` |
| 1 | W1-C | 3 | `client/messages/en/eval.json` | `client/src/**`, `server/**` |
| 2 | W2-A | 4 | `server/src/modules/eval/service.ts`, `server/src/modules/eval/repository.ts`, `server/src/modules/skills/helpers.ts` | `server/src/modules/eval/{runner,routes,dashboard}.ts`, the rest of `server/src/modules/skills/**`, `client/**` |
| 2 | W2-B | 5 | `client/.../EvalsTab/helpers.ts` | `EvalsTab.tsx`, `EvalsTab.test.tsx`, `_components/EvalCaseModal/**`, `client/messages/**`, `client/src/lib/**` |
| 2 | W2-C | 7 | `client/src/lib/hooks/eval.ts`, `client/src/lib/hooks/eval.test.tsx`, and **only** the `vi.mock` factory blocks of `EvalsTab.test.tsx` and `EvalCaseModal.test.tsx` | everything else in those two test files, `client/.../EvalsTab/helpers.ts`, `client/messages/**`, `server/**` |
| 4 | W4-A | 8 | `server/src/modules/eval/{repository,dashboard}.ts`, the `recent_runs` comment block in both `contracts/eval-ci.ts` copies | `server/src/modules/eval/{service,runner,routes}.ts`, `contracts/knowledge.ts`, `client/src/app/**` |
| 4 | W4-B | 9 | `client/.../EvalsTab/_components/EvalCaseModal/**` | `EvalsTab.tsx`, `EvalsTab.test.tsx`, `../../helpers.ts` (consume it, do not edit it), `client/messages/**`, `client/src/lib/**`, `server/**` |
| 4 | W4-C | 10 | `client/.../EvalsTab/EvalsTab.tsx`, `.../styles.ts`, `.../EvalsTab.test.tsx` | `_components/EvalCaseModal/**` (import through its `index.ts`), `../helpers.ts`, `client/messages/**`, `server/**` |
| 5 | W5-A | 11 | `server/test/eval.it.test.ts` + point fixes wherever a seam mismatch is found (sole lane — no conflict) | `client/src/vendor/ui/**`, applied `server/src/db/migrations/*.sql` |
| 6 | W6-A | 12 | `server/README.md`, `client/README.md` | code, `AGENTS.md`, `specs/**` |

**Handoffs.** Every delegation names this plan by path
(`.claude/plans/l06-evals-expectation-kind.md`) plus the step numbers of the
lane — `implementer` and `plan-verifier` both refuse to guess. Each lane returns
an implementation report naming: steps done `N/N`, the files it actually touched,
the verification command it ran and its result, every deviation from its step,
and any insight candidate. The wave-4 lanes additionally report the exact prop
signature they shipped, so the wave-5 integration lane can check the seam rather
than assume it. Reviews (`architecture-reviewer` ∥ `/code-review` ∥
`/security-review`), the fix loop, `plan-verifier` and `/pr-self-review` are
`/implement`'s own stages and are not steps in this table.

## Contract & migration impact

**`expectation_kind` — what it means, per variant.** This is the field the whole
slice turns on, so its meaning is pinned per case rather than left to two lanes
to infer:

| Case | Value | Written by | Read by |
|---|---|---|---|
| Agent case minted from an **accepted** finding | `"must_find"` | `EvalService#createCaseFromFinding`, from `finding.acceptedAt != null` — **not** from the `expected_output` it builds | tab label (AC-7), banner (AC-60), subtitle `accepted` (AC-59), mismatch predicate (AC-58) |
| Agent case minted from a **dismissed** finding | `"must_not_flag"` | same branch, from `finding.dismissedAt != null` | same, subtitle `dismissed` |
| Agent case created **by hand** (`POST /eval-cases`) | derived once at creation by `expectedFindings()` — non-empty → `must_find`, else `must_not_flag` (AC-54) | `EvalService#create` | same, subtitle `manual` |
| Skill-owned case | `NULL` on the row, `null` on the wire | nobody — the skills module neither reads nor writes it | nobody |
| **Any** case, on update | unchanged, always (AC-55) | nobody: `UpdateEvalCase` has no such key, and the shared `PUT` body is `.strict()` | — |
| Scoring, any case | — | — | **nobody** (AC-57): no scorer function takes it as an argument, and none may gain one |

`caseOrigin()` derives the subtitle from two fields, and only these two:
`source_finding_id == null` → `manual`; otherwise `must_find` → `accepted`,
`must_not_flag` → `dismissed`. There is no third source of provenance, and the
client never asks the server for one.

**The per-case run response — `EvalRunRecord`, one shape, three readings.** No
new contract is invented; the meaning of the fields varies by outcome and both
sides must read it the same way:

| Outcome | HTTP | `pass` | `error` | `batch_id` | Row persisted |
|---|---|---|---|---|---|
| Case scored | 200 | `true`/`false` | `null` | **always `null`** | yes, `agent_version` stamped |
| Case failed (provider error, timeout, empty `input_diff`) | **200** | `null` | `{code, message}` — never diff text | `null` | yes (NFR Спостережуваність) |
| No provider key | 409 `no_provider_key` | — | — | — | **no** — raised before any model call or write |
| Case/agent not found, or case owned by another agent | 404 | — | — | — | no |

`duration_ms` is this single run's own duration; `cost_usd` is this run's cost or
`null`. `batch_id: null` is what keeps the run out of every aggregate (AC-71) —
it is not an omission, it is the mechanism.

**`EvalDashboard.recent_runs` — widened meaning, same shape.** It now carries the
run rows of the recent batches **plus** the newest batch-less run per case. Its
only consumer reduces it to "latest run per case" (`latestRunByCase`), so order
is irrelevant and duplicates across the two sources are impossible (a row is
either in a batch or not). `recent_batches`, `trend`, `delta`, `alert`, `current`
and every field of `GET /eval/overview` remain batch-only. The doc comment says
exactly this, in both copies.

**Lane-internal contract (wave 4, step 9 ∥ step 10).** `EvalCaseModal`'s props
become `{ agentId: string; evalCase: EvalCase | null; lastRun?: EvalRunRecord;
onClose: () => void }`. `lastRun` absent/`undefined` = this case has never run
(AC-66's `Never run yet` branch) — never a zero-filled object. The tab supplies
`latest.get(c.id)`; the modal replaces it with the mutation's own returned record
after a run and never merges the two.

**Migration.** One new additive migration: `ALTER TABLE "eval_cases" ADD COLUMN
"expectation_kind" text` + the AC-56 backfill `UPDATE … WHERE owner_kind =
'agent'` + the CHECK constraint, in that order, in a single generated-then-hand-
appended file. No applied migration is edited (`pr-gate-ci.mjs:119-132` allows an
**added** file and only an added one). `pnpm db:migrate` is required before the
integration lane and before clicking the app; nothing runs it on boot.

## Verification plan

- `node scripts/verify.mjs --slice backend` — steps 1, 2, 4, 6, 8.
- `node scripts/verify.mjs --slice frontend` — steps 1, 3, 5, 7, 8, 9, 10.
- `cd server && pnpm db:migrate` — mandatory after step 2 and before any
  integration run or manual click-through; migrations never run on boot.
- `node scripts/verify.mjs --slice integration` — step 11 (needs Docker).
- `pnpm verify:l06` (root) — the wave-5 boundary check; the same three lanes AC-35
  pins, one command.
- `node scripts/pr-gate-ci.mjs` — the mechanical half of the PR gate: it is what
  catches a `@devdigest/shared` change landed in one copy only (steps 1, 8), and
  it treats the **added** migration as fine while still failing an edit to an
  applied one.
- Mid-wave, prefer the scoped form (`--tests-only --only <scope>`) and save the
  full lane for the wave boundary — a whole-tree typecheck failure is only
  meaningful there (root `INSIGHTS.md` 2026-08-26).
- `.github/workflows/evals.yml` fires on this branch because it touches
  `.claude/**` (this plan file). A changed artifact with no evals is a printed
  SKIP, and the only required check there is the zero-token `gate` job — nothing
  to run locally, no tokens spent.
- **Not run by anything:** the i18n rule (AC-62, NFR i18n) and "no hardcoded
  copy" — `check-ui-conventions.mjs` checks only `export *` and stray `fetch(`.
  A hardcoded banner string ships green; it is a review-by-reading item.

## Out of scope / left to reviewers

- Architecture review, correctness review, security review, `plan-verifier` and
  `/pr-self-review` — `/implement`'s own stages, not steps here.
- Opening the PR (and its **Insights** section) — the main session, via
  `/pr-self-review`.
- No e2e flow is added or touched: a run costs money and `e2e/` is seeded,
  read-only and model-free (NFR Тестові лейни).
- From the spec's **Non-goals**, verbatim:
  - «Не чіпаємо eval для **скілів**: `POST /skills/:id/eval-run`, вкладка `Evals`
    у редакторі скіла і компаратор за мультимножиною severity
    (`server/src/modules/skills/helpers.ts:142-186`) лишаються як є. Агентський
    скоринг — інший (за `file:line`), і два скорери співіснують навмисно.»
  - «Не будуємо LLM-суддю: … тут очікування — це `file:line`.»
  - «Не автоматизуємо прогін: жодного прогону за розкладом, при відкритті
    сторінки чи після збереження агента — кожен прогін коштує N викликів моделі
    й запускається людиною.»
  - «Не робимо експорт evals у CI, secret/phantom-гейти й conformance — це решта
    L06 і окремі спеки.»
  - «Не переносимо метрики агента в `agent-performance` (L08).»
  - «**Не робимо вкладки входу в редакторі кейса** (`Diff` / `Files` / `PR meta`)
    і кнопку `+ Finding skeleton`, які видно на макеті редактора: обидві —
    human-answered 27/08/2026 «поза обсягом». Вхід лишається одним полем
    `input_diff` (AC-10). Ключі `caseEditor.tabs.diff` / `tabs.prMeta` /
    `titleLabel` / `bodyLabel` / `preview` вже лежать у
    `client/messages/en/eval.json` і свідомо лишаються невикористаними до
    окремого рішення.»
  - «Не даємо міняти `expectation_kind` руками після створення: тип іде за
    рішенням по знахідці (або за очікуваннями в момент ручного створення) і далі
    незмінний — контролу для його перемикання в цій ітерації немає (AC-55).»
  - «Не чіпаємо `expectation_kind` для кейсів скілів: у них поле лишається
    порожнім, Skills Lab його не читає й не пише (та сама межа, що вище).»

## Risks

- **The vendored `Toggle` (and `Checkbox`) have no `disabled` prop; `Button`
  does.** AC-68 says "disable the toggle", and `**/src/vendor/ui/**` is
  do-not-touch. Step 9 must guard the handler and mark the wrapper
  `aria-disabled` instead of passing a prop. Earliest signal: `tsc` rejects
  `<Toggle disabled>` in the frontend lane — cheap, but only if the implementer
  does not "solve" it by editing `vendor/ui`, which `pr-gate-ci.mjs` would then
  raise as CRITICAL.
- **The mocked hooks module.** Adding `useRunAgentEvalCase` without updating both
  `vi.mock` factories kills whole suites with a mock error that reads like a
  crash in the new code. Step 7 owns the stubs; signal: `No "useRunAgentEvalCase"
  export is defined on the mock` in the frontend lane.
- **`drizzle-kit generate` going interactive.** Only if the diff both adds and
  drops something. This change is purely additive, so it should not — signal:
  `pnpm db:generate` prints a question instead of writing a file; do not try to
  pipe an answer (root `INSIGHTS.md` 2026-08-05), split the change instead.
- **The CHECK constraint may not be emitted** by drizzle-kit 0.30 from the
  schema's `check()`. Signal: read the generated SQL **before** `db:migrate`; if
  the `ADD CONSTRAINT` is missing, hand-write it into that same new file (step 2
  already says so). Do not discover this after the migration is applied — then it
  needs a second migration.
- **AC-56 vs AC-54 on a malformed `findings` array.** The backfill counts array
  length in SQL; creation uses the scorer's `safeParse`. A legacy row whose
  `findings` array holds entries the scorer cannot read is typed `must_find` by
  the migration and would be typed `must_not_flag` by the creation path. This is
  AC-56's own wording, it is visible to the user (AC-58's warning fires, because
  the client counts the same way the SQL did only when the array is well-formed),
  and it is left as-is rather than silently "fixed". Signal: step 11's malformed-
  `expected_output` fixture.
- **A run costs money.** Any manual click-through that presses `Run case` or
  `Run on save` spends one model call per press. The integration lane substitutes
  the provider through the container slot and spends nothing; keep it that way.
- **Another session on this branch.** Signal: `git log` shows commits nobody in
  this run made, or `git status` shows staged changes nobody staged. The main
  session commits with an explicit pathspec (root `INSIGHTS.md` 2026-08-26).

## Open questions

- **A `PUT /eval-cases/:id` body carrying `expectation_kind` 422s rather than
  being silently ignored.** Default assumed: keep the existing `.strict()` body —
  AC-53's "надіслане — ігнорується" is read as the creation path (where the
  non-strict `EvalCaseInput` strips it), and a loud refusal on update is strictly
  safer than a silent one given the truncation bug that shaped this route
  (`server/INSIGHTS.md` 2026-08-26). Step 11 asserts whichever holds.
- **`Save` no longer always closes the modal**: with `Run on save` on, it stays
  open to show the run (AC-65 would otherwise be unobservable on that path).
  Default assumed as described; the alternative (close and read the status off
  the tab row) is one line in step 9 if the human prefers it.
- **`Run case` is disabled on an unsaved new case**, with the textual reason
  `caseEditor.runNeedsSave` — there is no `:caseId` to post to before the first
  save, and `Run on save` is the path for a brand-new case. Default assumed.
- **The `expectationType()` JSON fallback stays** for a row with no stored kind
  (only possible on an unmigrated database). Default assumed; see
  **Recommendations** for retiring it.
