# Plan: Eval Dashboard `/eval` — design fidelity + `Run all agents` (SPEC-05 delta)

**Branch:** L06-Evals · **Slices:** frontend · backend · contracts · meta · **Spec:** specs/SPEC-05-eval-pipeline-26-08-2026.md (approved, revised 2026-08-26) · **Mode:** multi-agent · **Supersedes:** none

Scope is the **design-fidelity delta only**: AC-26, AC-27 (both reworked
2026-08-26) and the new AC-36…AC-52, including the wire addition AC-41. The rest
of SPEC-05 (AC-1…AC-25, AC-28…AC-35) already ships on this branch and is not
re-planned here; `.claude/plans/l06-evals-eval-pipeline.md` is that plan and this
one builds on its result rather than replacing it.

## Context read

- `AGENTS.md:42-45` — `@devdigest/shared` exists twice; the wire addition of
  AC-41 edits `server/src/vendor/shared/contracts/eval-ci.ts` **and**
  `client/src/vendor/shared/contracts/eval-ci.ts` in one step, never one alone.
- `AGENTS.md:46-47` — Zod-first contracts: `GET /eval/overview` already serves
  its response straight off `EvalDashboardOverview` (`server/src/modules/eval/routes.ts:132-139`),
  so adding `trend` to the schema is the whole of the wire change; no handler-side
  parsing is added.
- `AGENTS.md:48-49` — DB-backed tests end in `*.it.test.ts`; the new overview
  coverage goes into the existing `server/test/eval.it.test.ts`.
- `AGENTS.md:16-27` — `client/` and `server/` are pnpm; the root `package.json`
  is scripts-only and already carries `verify:l06` (verified in the file).
- `AGENTS.md:81-83` — do-not-touch: `**/src/vendor/ui/**`. Relevant and
  **already resolved**: the sidebar row AC-26 asks for is in
  `client/src/vendor/ui/nav.ts:65` (`{ key: "eval", label: "Eval Dashboard",
  icon: "Gauge", href: "/eval" }`). No step in this plan touches a vendored file,
  and no `Vendor-update:` line is needed in the PR body.
- `client/AGENTS.md:21` — pages are thin; feature logic lives in a colocated
  `_components/<Name>/` with `Name.tsx`, `constants.ts`, `styles.ts`, `index.ts`,
  `Name.test.tsx`. `client/src/app/eval/page.tsx` is already a 3-line shell.
- `client/AGENTS.md:24` — UI strings live in `messages/<locale>/*.json`; only
  `en` exists. Every new label in AC-36…AC-52 lands in
  `client/messages/en/eval.json`.
- `client/AGENTS.md:26-29` — placement is machine-enforced (`pnpm arch`, inside
  the `frontend` slice). A nested `_components/<X>/` importing `../../helpers` /
  `../../constants` is an established, legal pattern
  (`.dependency-cruiser.cjs` `no-cross-route-internals` only forbids reaching
  across *route trees*; precedent: `pulls/_components/PRRow/PRRow.tsx:11`).
- `server/AGENTS.md:20-22` — adapters only through the DI container; the
  dashboard read model already takes a `Container`, never a `FastifyRequest`
  (`server/src/modules/eval/dashboard.ts:17-33`).
- `client/INSIGHTS.md` **2026-08-20** — moving logic into a `lib/hooks/*` module
  drops it out of every route suite (they `vi.mock` the module wholesale); write
  the hook-level test in the same change. Applies directly to the `Run all
  agents` fan-out hook.
- `client/INSIGHTS.md` **2026-08-20** (Recurring errors) — a NEW export on a
  mocked hook module is a hard vitest mock error, not an assertion failure, for
  every suite whose factory omits it. `EvalOverview.test.tsx:17-25` mocks
  `@/lib/hooks/eval` with a plain factory and will need the new hook stubbed in
  the same step that consumes it.
- `client/INSIGHTS.md` **2026-08-26** — the app's `QueryClient` fires a global
  `mutationCache.onError` toast for every mutation; a component that renders its
  own failure copy must opt out with `meta: { ownErrorToast: true }` and then
  owns *every* error branch. The fan-out surfaces per-agent failures itself
  (AC-51), so this is its call to make.
- `INSIGHTS.md` **2026-08-04** — parallel subagents work when split by FILE
  OWNERSHIP, not by concern; what it does not catch is the seams between them.
  Hence the **Ownership** table and the dedicated integration step below.
- `INSIGHTS.md` **2026-08-26** — clicking the finished feature caught two
  defects a full review chain missed. A manual click-through stage is in
  **Execution**, after the reviews.
- `INSIGHTS.md` **2026-08-18** — `.claude/settings.json` denies `Edit` on
  `**/src/vendor/ui/**` to agents *and* the main session. Recorded here only to
  state that this plan needs no such edit (see the nav row above).
- `.claude/skills/pr-self-review/routing.md:65-75` — slice table:
  `client/**` → `frontend`, `client/src/vendor/shared/**` → `frontend` +
  `contracts`, `server/**` → `backend`, `server/src/vendor/shared/**` →
  `backend` + `contracts`, `*.md`/`docs/` → `meta`.
- `.claude/skills/pr-self-review/routing.md:101-107` — skill map, copied into
  the **Skills** column verbatim, not from memory.
- `scripts/verify.mjs:106-133` — lane contents. `frontend` = client typecheck +
  depcruise + `check-ui-conventions` + vitest; `backend` = server typecheck +
  depcruise + unit vitest; `integration` = `.it.test` vitest (Docker + a
  migrated DB).
- Current page: `client/src/app/eval/_components/EvalOverview/EvalOverview.tsx:71-115`
  (card grid), `:126-176` (table, column order agent → version → ran_at → …,
  agent name as the link), `helpers.ts:13` (`dateStyle: "medium"` →
  `May 29, 2026, 9:14 AM`). These are the three deviations AC-26/AC-27/AC-38/AC-43
  name.
- Read model: `server/src/modules/eval/dashboard.ts:221-256` (`getEvalOverview`),
  `:335-338` (the `traces_total > 0` trend filter AC-40 must reuse),
  `constants.ts:16` (`BATCH_TABLE_LIMIT = 20`).
- Repository: `server/src/modules/eval/repository.ts:279-321`
  (`latestBatchPerAgent`, two queries, no per-agent loop) and `:331-399`
  (`runRowsGroupedByBatch`, the shared second half) — the seam the per-agent
  trend read extends.
- Runner error codes the fan-out must branch on:
  `server/src/modules/eval/runner.ts:67-73` → `AppError('empty_eval_set', …, 422)`;
  `:249` → `NoProviderKeyError` → 409 `no_provider_key`
  (`server/src/platform/errors.ts:46`).
- Existing client seam: `client/src/lib/hooks/eval.ts:153-162`
  (`useRunAgentEvalBatch` → `POST /agents/:id/eval-runs`, invalidates
  `["agent-eval-dashboard", id]` and `["eval-overview"]`) and `:45-47`
  (`isNoProviderKeyError`) — both reused as-is.
- UI kit inventory (read, not guessed): `Sparkline` (`charts/Sparkline.tsx`),
  `ProgressBar`/`PercentProgress` (`primitives/ProgressBar.tsx`), `Modal`
  (`kit/Modal.tsx` — overlay click closes, **no Escape handler**), `Button`
  (`icon="Play"`, `loading`, `disabled`), `Icon.ChevronRight`, `Icon.Play`.

## Requirements review

Every requirement in scope, quoted verbatim from the spec. The trailing
provenance/`verify:` tail of each AC (`(← design: … · verify: …)`) is metadata
about the criterion, not the criterion, and is omitted from the quote — nothing
else is trimmed. `AC-1…AC-25`, `AC-28…AC-35` are out of scope for this plan
(already implemented on this branch) and are not graded here.

| # | Requirement (verbatim) | Verdict | How the plan handles it |
|---|------------------------|---------|-------------------------|
| AC-26 | Система повинна (shall) показувати в сайдбарі, у секції `SKILLS LAB`, пункт `Eval Dashboard`, що веде на `/eval`, а на самій сторінці — секцію `AGENTS`, у якій кожен агент із непорожнім набором займає **окремий рядок на всю ширину**, а не картку в сітці. | clear | Sidebar half is already shipped (`client/src/vendor/ui/nav.ts:65`) — no step. Page half: steps 6 + 8 replace the card grid with one full-width row per agent. |
| AC-27 | Система повинна (shall) показувати на `/eval` секцію `RECENT EVAL RUNS · ALL AGENTS` — таблицю останніх прогонів **усіх агентів**, найновіші згори, один рядок на батч, із колонками в порядку: агент, час у моно-форматі `YYYY-MM-DD HH:mm`, версія, recall, precision, citation, `X/Y pass` жирним, вартість. | clear | Step 3 changes the timestamp helper in place; step 8 reorders the columns and bolds the pass cell. Newest-first is already the server's order (`recent_batches`). |
| AC-36 | Система повинна (shall) показувати в шапці `/eval` заголовок `Eval Dashboard`, підзаголовок `Regression harness across all reviewer agents · pick an agent to see its runs` і праворуч у тому ж ряду акцентну кнопку `Run all agents` з іконкою play; уся копія береться з `client/messages/en/eval.json`, а не хардкодиться в компоненті. | clear | Step 2 rewrites `dashboard.overview.subtitle` to that exact string and adds the button label; step 8 renders the header row with `<Button kind="primary" icon="Play">`. |
| AC-37 | КОЛИ користувач активує рядок агента (клік по рядку або Enter на сфокусованому рядку), система повинна (shall) відкрити `/eval/:agentId`; шеврон `›` праворуч лишається декоративною афордансною позначкою і не є другою ціллю навігації. | clear | Step 6: the row is one `next/link` `<Link>` (focusable, Enter-activated natively); the chevron is `aria-hidden` and the row contains no second link/button. |
| AC-38 | Система повинна (shall) показувати в лівій частині рядка агента квадратну іконку-плитку, ім'я агента жирним, модель поруч моно-бейджем, а під ними — мета-рядок останнього батча у формі `Last run v<версія> · <YYYY-MM-DD HH:mm> · <X>/<Y> pass`. | clear | Step 6, reading `agent.last_batch`. Timezone is unstated by the spec; the plan keeps the current helper's **local** time (see **Decisions taken**) and the test asserts the shape, not a hardcoded literal. |
| AC-39 | Система повинна (shall) показувати праворуч у рядку агента три стат-блоки — `RECALL`, `PREC`, `CITE` — кожен як підпис великими літерами над великим значенням у відсотках з останнього батча, і завжди друкувати саме число: колір блоку ніколи не є єдиним носієм значення. | clear | Step 2 adds the three short labels (the existing `dashboard.metrics.*` are `RECALL`/`PRECISION`/`CITATION ACCURACY` — wrong words for this row); step 6 renders label + `pct(value)`, colour additive only. |
| AC-40 | Система повинна (shall) малювати в рядку агента sparkline — одну акцентну лінію тренду по точках останніх ≤ `BATCH_TABLE_LIMIT` батчів цього агента, хронологічно (найстаріший ліворуч), виключаючи батчі з `traces_total = 0` тим самим правилом, що й тренд на сторінці агента, і не малювати ні лінії, ні осі з нулем, коли точок менше двох. | clear | Server side (step 5) reuses `toTrendPoint` + the `traces_total > 0` filter, so the rule cannot drift from `getEvalDashboard`. Client side (step 6) renders `<Sparkline>` only at `trend.length >= 2` — which is also what keeps the vendored component from emitting a `NaN` path at one point (`Sparkline.tsx:19`, `i / (data.length - 1)`). |
| AC-41 | Система повинна (shall) віддавати на `GET /eval/overview` для кожного агента власну серію тренду (`EvalAgentSummary.trend` — точки щонайменше з `ran_at` і метрикою, яку малює AC-40), присутню в **обох** копіях `@devdigest/shared`. | clear | Step 1 (both copies, one step) + step 5 (fills it). Point shape deliberately left open by the spec — the plan reuses `EvalTrendPoint`; see **Decisions taken** and **Contract & migration impact**. |
| AC-42 | ПОКИ агент має кейси, але жодного завершеного батча, рядок повинен (shall) показувати позначку «never run» замість мета-рядка, `—` замість кожного з трьох значень і не малювати sparkline — жодного нуля, який читається як результат прогону. | clear | Step 6 branches on `last_batch === null` (never on a metrics object) — the same CRITICAL seam the current component documents at `EvalOverview.tsx:1-18`. |
| AC-43 | Система повинна (shall) рендерити в таблиці останніх прогонів версію батча як акцентне посилання `v<N>` на `/eval/:agentId`, а ім'я агента — звичайним текстом без посилання. | clear | Step 8 moves the `<Link>` from the name cell to the version cell. Note for the executor: the existing test asserts `getByRole("link", { name: "Security Reviewer" })` and must move with it. |
| AC-44 | Система повинна (shall) показувати recall, precision і citation у кожному рядку таблиці як горизонтальний прогрес-бар із числом у відсотках поруч (синій, зелений, оранжевий відповідно) і завжди друкувати число: довжина бару й колір ніколи не є єдиним носієм значення. | clear | Step 8 with the vendored `ProgressBar` + `pct()`; colours from step 3's constants (`--accent` / `--ok` / `--warn`, the same three the agent page's legend uses). A `null` metric renders `—` and no bar. |
| AC-45 | Система повинна (shall) показувати вартість батча (`cost_usd`) останньою колонкою таблиці — свідоме відхилення від макета, у якому колонки вартості немає. | clear | Already the last column; step 8 keeps it there while reordering the rest. |
| AC-46 | КОЛИ користувач натискає `Run all agents`, система повинна (shall) відкрити діалог підтвердження, що називає кількість агентів і сумарну кількість кейсів, які буде прогнано, і до підтвердження не зробити жодного виклику моделі. | clear | Step 7 (dialog) + step 8 (counts from `agents.length` and `Σ agents[].cases_total` — both already on the wire, no extra request). The button only opens the dialog; no mutation is created before confirm. |
| AC-47 | КОЛИ користувач підтверджує діалог, система повинна (shall) запустити прогін набору кожного агента з непорожнім набором — рівно один батч на агента — і після завершення показати нові батчі в рядках агентів і в таблиці без ручного перезавантаження сторінки. | clear | Step 4's fan-out calls the existing `POST /agents/:id/eval-runs` once per agent (one batch per agent by construction — `runner.ts` mints one `batch_id` per call) and invalidates `["eval-overview"]`. |
| AC-48 | ЯКЩО користувач закриває діалог без підтвердження (`Cancel`, Esc або клік поза ним), ТОДІ система не повинна (shall not) запускати жодного прогону і не робити жодного виклику провайдера. | clear | Step 7. `Modal` closes on overlay click and on the `X`; **Escape is not handled by the vendored `Modal`** — the dialog adds its own `keydown` listener (precedent: `AddRepoView.tsx:24`, `InlineComposer.tsx:48`). |
| AC-49 | ПОКИ триває прогін «усіх агентів», кнопка `Run all agents` повинна (shall) бути вимкненою у стані `running`, а повторне натискання — не стартувати другий прогін. | clear | Step 4 exposes `isRunning`; step 8 binds `disabled`/`loading`. The guard is in the hook, not only in the button, so a second call is refused even if a caller ignores `disabled`. |
| AC-50 | ЯКЩО жоден агент не має непорожнього набору кейсів, ТОДІ кнопка `Run all agents` повинна (shall) бути вимкненою з текстовою причиною, а діалог — не відкриватися. | clear | Step 8: `agents.length === 0` (the server already filters non-empty sets, `dashboard.ts:245-253`), reason from step 2's new key, rendered as text next to the button — not as a `title` attribute only (NFR Доступність). |
| AC-51 | ЯКЩО прогін одного агента впав (помилка провайдера, таймаут, 409 `no_provider_key`, порожній набір), ТОДІ система повинна (shall) прогнати решту агентів, показати збійного агента з причиною і не показувати для нього батча в таблиці. | clear | Step 4 never rejects the whole fan-out: each agent's outcome is captured (`status: "ok" | "error"`) and the loop continues. Step 8 renders the failed agents with their reason. *Where* that list renders is the executor's reversible call; the outcome shape is pinned in **Contract & migration impact**. |
| AC-52 | ЯКЩО кожен агент відмовив із 409 `no_provider_key`, ТОДІ система повинна (shall) вимкнути кнопку `Run all agents` і показати те саме пояснення, що AC-24 (`messages/en/eval.json` `dashboard.noProviderKey`), не повторюючи запитів, які не можуть удатися. | clear | Post-hoc under the chosen mechanism: step 4 exposes `allNoProviderKey` (every attempted agent failed 409 `no_provider_key`), step 8 makes it a sticky disable + `dashboard.noProviderKey`. Provider keys are per-agent-provider, so one 409 does not imply the rest — the fan-out still tries every agent, and those attempts cost no model tokens (the 409 is raised before the provider call, `runner.ts:249`). |
| Edge case | **Агент має кейси, але жодного прогону** → у рядку «never run», `—` замість трьох значень, sparkline не малюється. → AC-42 | clear | Rides on AC-42 (step 6). |
| Edge case | **У агента менше двох точок тренду** (один батч або всі батчі з `traces_total = 0`) → sparkline не малює ні лінії, ні осі з нулем. → AC-40 | clear | Rides on AC-40 (steps 5 + 6); asserted in step 6's test at 0 and 1 points. |
| Edge case | **Дуже довге ім'я агента або назва моделі в рядку на всю ширину** → обрізається візуально, рендериться екранованим текстом. → див. **Untrusted inputs** | clear | Step 6: text node only, `overflow: hidden` + ellipsis (the current card already does this, `styles.ts:24-30`). |
| Edge case | **Жоден агент не має кейсів** → кнопка `Run all agents` вимкнена з текстовою причиною, секція `AGENTS` лишається в порожньому стані. → AC-50, AC-26 | clear | Step 8; the existing `dashboard.overview.emptyAgents` empty state stays. |
| Edge case | **Повторний клік `Run all agents`, поки прогін триває** → ігнорується, другий прогін не стартує. → AC-49 | clear | Step 4's in-hook guard. |
| Edge case | **Частина агентів без ключа провайдера** → ті, що з ключем, проганяються, решта позначені причиною; коли жоден агент не має ключа — кнопка вимикається з поясненням. → AC-51, AC-52 | clear | Steps 4 + 8; asserted in step 4's hook test (mixed 200/409) and step 8's RTL test. |
| Edge case | **Батч із помилковими кейсами в таблиці дашборда** → поруч із `X/Y pass` лишається бейдж `{count} errored`, агрегати рахуються по решті. → AC-25, AC-27 | clear | Already implemented (`EvalOverview.tsx:163-167`); step 8 must carry it through the column reorder, not drop it. |
| Edge case | **Користувач іде зі сторінки посеред `Run all agents`** → батчі, які вже стартували, дораховуються на сервері й видно при поверненні; чи стартують агенти, до яких черга не дійшла, залежить від механізму. → no AC — див. **Open questions** | clear (default taken) | Client fan-out: an in-flight batch finishes server-side; agents not yet started do not run. This is exactly the spec's own default, accepted by the human. |
| NFR | **Вартість і побічні ефекти** — … `Run all agents` — єдина дія, що одним жестом коштує N агентів × M кейсів, тому вона стартує лише після діалогу підтвердження, який називає обидва числа **до** першого виклику (AC-46), а скасування діалогу не коштує нічого (AC-48). | clear | Steps 7 + 8; step 9 asserts the server side (no run row written when nothing is confirmed is a client property, so it is asserted in RTL, not in the `.it.test.ts` — see **Verification plan**). |
| NFR | **Контракти** — … серія тренду в `EvalAgentSummary` для sparkline (AC-41) додаються в **обидві** копії (AGENTS.md → Conventions). Якщо план обере окремий серверний роут для `Run all agents`, він теж є новою зовнішньою поверхнею… | clear | Step 1 moves both copies in one step. No new route is chosen — see **Decisions taken**, so the second sentence does not bind. |
| NFR | **Продуктивність** — … додана серія тренду в `GET /eval/overview` (AC-41) лишається в тій самій межі й тим самим читанням локальної БД. | clear | Step 5 keeps the read at two queries (the existing `latestBatchPerAgent` shape generalised), not one per agent; bounded by batches, never by cases. |
| NFR | **Доступність** — … рядок агента — рівно одна фокусована ціль із клавіатури, а шеврон декоративний (AC-37); у стат-блоках рядка і в барах таблиці поруч завжди стоїть число … вимкнена кнопка `Run all agents` несе текстову причину (AC-50, AC-52). | clear | Steps 6 + 8; the "exactly one focusable target per row" assertion is an explicit test in step 6, not an inspection. |
| NFR | **i18n** — у репозиторії є лише локаль `en`; нові рядки (підзаголовок шапки, заголовки секцій `AGENTS` і `RECENT EVAL RUNS · ALL AGENTS`, підпис кнопки `Run all agents`, текст діалогу підтвердження, підписи `RECALL`/`PREC`/`CITE`) живуть у `client/messages/en/eval.json` поруч із наявними ключами і не хардкодяться в компонентах. | clear | Step 2 owns the file; steps 6–8 read keys only. |
| Untrusted inputs | **Ім'я агента й назва моделі** — введення користувача; у рядку агента на всю ширину, у колонці «агент» таблиці і в тексті діалогу підтвердження `Run all agents` вони рендеряться лише як екранований текстовий вузол, ніколи як розмітка … і візуально обрізаються, а не ламають розкладку рядка. | clear | Steps 6, 7, 8 — text nodes only, no `dangerouslySetInnerHTML`, no `title`-as-markup. The confirm dialog names **counts**, so it need not interpolate an agent name at all; if the failure list does, it is a text node. |

## Decisions taken

- **Execution mode: multi-agent.** *human-answered* — stated in the delegation
  ("the plan will be executed by the `/implement` chain"), so the mode question
  was not re-asked.
- **«Run all agents»: «Так, з підтвердженням»** — *human-answered* (interview
  2026-08-26, quoted verbatim in the delegation). In scope, functional,
  confirmation dialog naming agents × cases before any model call.
- **Cost column: «Залишити»** — *human-answered*. Kept as the last table column,
  a deliberate deviation from the mock (AC-45).
- **Sparkline on agent rows: adopted** — *human-answered* (AC-40, AC-41).
- **Sparkline metric = `recall`** — *human-answered* (the spec's default under
  Open questions, explicitly accepted in the delegation).
- **`Run all agents` is not guaranteed to survive navigating away mid-run; only
  already-started batches persist** — *human-answered* (spec default, explicitly
  accepted in the delegation).
- **Mechanism for `Run all agents`: client-side fan-out over the existing
  `POST /agents/:id/eval-runs`, sequentially, one request per agent with a
  non-empty set. No new server route.** *planner-decided* — the spec's design
  review delegates the mechanism to the plan ("вибір механізму — рішення
  плану") and the delegation repeats it. **Trade-off, both sides:**
  - *For the fan-out:* no new external surface (the spec's NFR Контракти warns
    that a new route is one); "exactly one batch per agent" (AC-47) is true by
    construction rather than by a new server loop; per-agent partial failure
    (AC-51) is one HTTP status per agent instead of a new aggregate error shape;
    the counts AC-46 needs are already on the page (`agents.length`,
    `Σ cases_total`); and the accepted durability default is *literally* the
    fan-out's property — the spec's own default text says "клієнтський фан-аут
    по наявному роуту цього не тримає".
  - *Against it (accepted):* a run does not survive navigation for agents not
    yet started; the orchestration (sequencing, the running guard, the
    all-409 rule) lives in the client and is only covered by client tests, so
    the integration step covers the server half separately; and N sequential
    HTTP requests each hold a long-running connection.
  - *Rejected alternative:* `POST /eval/run-all` in the eval module. It would
    survive navigation and put the loop next to the runner, but it adds an
    external surface the spec flags, needs a new aggregate response contract in
    both `@devdigest/shared` copies, and turns N×M model calls into **one**
    HTTP request whose failure mode is all-or-nothing at the transport level —
    the opposite of AC-51's partial degradation.
- **`EvalAgentSummary.trend` reuses `EvalTrendPoint`** rather than a new,
  narrower `{ ran_at, recall }` point. *planner-decided.* AC-41 says "щонайменше
  з `ran_at` і метрикою", so both satisfy it. Reuse means the overview and the
  agent page share `toTrendPoint` and the `traces_total > 0` exclusion, which is
  exactly what AC-40 demands ("тим самим правилом"); a second shape would be a
  second place for that rule to drift. Cost: a slightly larger payload
  (≤ 20 points × 5 numbers per agent) — inside the NFR's ≤ 300 ms local read.
- **Timestamp timezone: local, as today.** *planner-decided* (the spec's
  `YYYY-MM-DD HH:mm` does not name a zone). The current helper already formats
  in local time, this is a local-first studio, and CI runs UTC while a developer
  does not — so tests assert the **shape** (`/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/`)
  plus a value derived through the same helper, never a hardcoded literal. A
  hardcoded literal is green in CI and red on a developer's machine, which is
  the worst of the three options.

## Recommendations

- **Mirror the mono `YYYY-MM-DD HH:mm` format onto the agent page's runs table**
  (`client/src/app/eval/_components/AgentDashboard/helpers.ts` has its own
  `formatBatchDate` with `dateStyle: "medium"`). Why: after this plan the two
  eval screens print the same field in two different formats, one row apart in
  the user's journey. AC-27/AC-38 only bind `/eval`, so the plan does not do it.
  If accepted: one extra line in step 3's sibling file and a one-line test
  update in `AgentDashboard.test.tsx`. Default: as requested.
- **Give `EvalRepository` a grouped `countCasesPerAgent` read.**
  `getEvalOverview` still calls `listAgentCases` once per agent
  (`dashboard.ts:241-243`) purely to learn whether the set is non-empty and how
  big it is — and AC-46's dialog now depends on that count being right. It is
  bounded by agent count, so it is not a defect; it is the one N+1 left in this
  read. If accepted: one method in step 5's file and one loop deleted. Default:
  as requested.
- **Add a `data-testid` (or role) anchor to the agent row.** The row's assertions
  (one focus target, three stat blocks, no sparkline at <2 points) are all
  structural, and `client/INSIGHTS.md` 2026-08-20 records what text-matching
  costs when markup moves. If accepted: one attribute in step 6. Default: as
  requested — the executor may choose accessible-role queries instead.
- **Do not extract a shared `MetricBar`/`StatBlock` into `src/components/`.**
  Two call sites in one route tree is the AHA threshold the
  `frontend-ui-architecture` skill sets; promoting now would create a shared
  component with one consumer. Stated so a reviewer does not read the local
  helper as an oversight. Default: as requested.

## Constraints that bind this change

- **Does anything cross the wire?** Yes — one field: `EvalAgentSummary.trend`
  on `GET /eval/overview` (AC-41). It moves in **both** `@devdigest/shared`
  copies in step 1, never one alone. Nothing else in this plan is a wire change:
  `Run all agents` reuses `POST /agents/:id/eval-runs` unchanged.
- **Contracts are Zod-first.** The route already serves the response off
  `EvalDashboardOverview` (`routes.ts:132-139`); adding the field to the schema
  *is* the change, and a handler that drifts from it fails loudly. No
  `Schema.parse(...)` is added anywhere.
- **Migrations.** **Not affected.** No new column, no new table — `trend` is
  derived at read time from rows `eval_runs` already holds. No file under
  `server/src/db/migrations/` is created or edited. `cd server && pnpm db:migrate`
  is still required before the integration slice only if the local DB is behind
  the branch's existing migrations.
- **Test lane.** The new server coverage is DB-backed and goes into the existing
  `server/test/eval.it.test.ts` (`*.it.test.ts`, integration lane). Client tests
  are `*.test.tsx` in the frontend lane. No new file lands in the wrong lane.
- **Package manager per step.** `client/` and `server/` → **pnpm**. No step
  touches `reviewer-core/`, `e2e/`, `mcp/` or `evals/`, so no npm step exists
  and nothing installs at the repo root.
- **`reviewer-core` never emits JS.** **Not affected** — untouched.
- **Do-not-touch paths.** `server/clones/**` — not touched. Applied
  `server/src/db/migrations/*.sql` — not touched (no migration).
  `**/src/vendor/ui/**` — **not touched**: the sidebar row AC-26 needs already
  exists at `client/src/vendor/ui/nav.ts:65`, and the vendored `Sparkline`,
  `ProgressBar`, `Modal`, `Button` are consumed as-is. The one temptation is
  `Modal`'s missing Escape handler (AC-48): the answer is a listener in the
  **new** dialog component, not an edit to the vendored file.
- **Layering.** Backend work stays inside `server/src/modules/eval/`:
  `repository.ts` owns the SQL, `dashboard.ts` owns the aggregation, and agent
  identity keeps coming through `container.agentsRepo` — no new inline join, no
  new port, no DI change (`onion-architecture` Blind spots §4, already honoured
  at `dashboard.ts:30-33`). `depcruise` sees no new edge.

## Steps

| # | Change | Files / seams | Slice | Satisfies | Depends on | Executor | Skills the executor applies | Verification |
|---|--------|---------------|-------|-----------|------------|----------|-----------------------------|--------------|
| 1 | Wire: add `trend: z.array(EvalTrendPoint)` to `EvalAgentSummary` in **both** `@devdigest/shared` copies, with the doc comment pinning "chronological, oldest first, `traces_total = 0` batches excluded, ≤ `BATCH_TABLE_LIMIT` points". Plus the two **mechanical** call-site touch-ups that keep both lanes green while later steps land: `trend: []` in `dashboard.ts#getEvalOverview`'s summary literal (marked as the placeholder step 5 replaces) and `trend: []` in `EvalOverview.test.tsx`'s `makeAgent` factory | `server/src/vendor/shared/contracts/eval-ci.ts:193-201`, `client/src/vendor/shared/contracts/eval-ci.ts` (same block), `server/src/modules/eval/dashboard.ts` (one literal), `client/src/app/eval/_components/EvalOverview/EvalOverview.test.tsx` (one literal) | contracts (backend + frontend) | AC-41 | — | `implementer` | `zod` | `node scripts/verify.mjs --slice backend --slice frontend` |
| 2 | i18n: rewrite `dashboard.overview.subtitle` to the exact AC-36 string; retitle `agentsHeading` → `AGENTS` and `recentBatchesHeading` → `RECENT EVAL RUNS · ALL AGENTS`; add the short stat labels (`RECALL`/`PREC`/`CITE`), the `Run all agents` button label, the confirm-dialog title/body/confirm/cancel copy naming both counts, the AC-50 disabled reason, the AC-38 `Last run …` meta pattern and the AC-51 per-agent failure line. No component keeps a literal | `client/messages/en/eval.json` | frontend | AC-36, AC-38, AC-39, AC-42, AC-46, AC-50, AC-51, AC-52, NFR i18n | — | `implementer` | `frontend-ui-architecture` | `node scripts/verify.mjs --slice frontend` |
| 3 | Overview helpers/constants: change `formatBatchDate` **in place** (same export name, so the current page keeps compiling) to `YYYY-MM-DD HH:mm`; add the metric colour map (`recall → --accent`, `precision → --ok`, `citation → --warn`), `SPARKLINE_MIN_POINTS = 2` and the `recall` sparkline-metric constant. `pct`/`formatCost`/`NO_VALUE` unchanged | `client/src/app/eval/_components/EvalOverview/helpers.ts`, `client/src/app/eval/_components/EvalOverview/constants.ts` | frontend | AC-27, AC-38, AC-40, AC-44 | — | `implementer` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` | `node scripts/verify.mjs --slice frontend` |
| 4 | `Run all agents` fan-out hook + its own hook test: sequential over the agents it is handed, one `POST /agents/:id/eval-runs` each (reusing the existing mutation path), never rejecting the whole run on one failure, an in-hook re-entry guard, and the `allNoProviderKey` predicate built on the existing `isNoProviderKeyError`. Opts out of the global mutation toast (`meta: { ownErrorToast: true }`) because the page renders per-agent reasons itself. Exported shape is pinned in **Contract & migration impact** | `client/src/lib/hooks/eval.ts`, `client/src/lib/hooks/eval.test.tsx` (new — `client/INSIGHTS.md` 2026-08-20) | frontend | AC-47, AC-49, AC-51, AC-52 | — | `implementer` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library` | `node scripts/verify.mjs --slice frontend` |
| 5 | Server read model: generalise `EvalRepository#latestBatchPerAgent` into a per-agent recent-batches read (last ≤ `BATCH_TABLE_LIMIT` batches **per agent**, still two queries — the same group-by + `runRowsGroupedByBatch` shape, top-N-per-agent chosen in JS), and fill `EvalAgentSummary.trend` in `getEvalOverview` with the **existing** `toTrendPoint` + `traces_total > 0` filter, reversed to chronological. `last_batch` becomes the newest element of that same read, so the two can no longer disagree. Replaces step 1's `trend: []` placeholder | `server/src/modules/eval/repository.ts:279-321`, `server/src/modules/eval/dashboard.ts:221-256` | backend | AC-40, AC-41, NFR Продуктивність | 1 | `implementer` | `onion-architecture`, `drizzle-orm-patterns` | `node scripts/verify.mjs --slice backend` |
| 6 | `AgentRow` component (new folder, own `styles.ts`/`index.ts`/`AgentRow.test.tsx`): one full-width row per agent — square icon tile, bold name, mono model badge, `Last run v<N> · <ts> · X/Y pass` meta line, three `RECALL`/`PREC`/`CITE` stat blocks printing the number, the `recall` sparkline at ≥ 2 points only, decorative `aria-hidden` chevron; the whole row is exactly **one** focusable link to `/eval/:agentId`. `last_batch === null` → "never run" + `—`, no sparkline, no zeros | `client/src/app/eval/_components/EvalOverview/_components/AgentRow/**` (new); reads `../../helpers`, `../../constants` | frontend | AC-26, AC-37, AC-38, AC-39, AC-40, AC-42, NFR Доступність, Untrusted inputs | 1, 2, 3 | `implementer` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library` | `node scripts/verify.mjs --slice frontend` |
| 7 | `RunAllDialog` component (new folder, own `styles.ts`/`index.ts`/`RunAllDialog.test.tsx`): confirmation modal over the vendored `Modal`, naming agents count and total cases from props, `Confirm`/`Cancel`, closing on Cancel, overlay click **and Escape** (its own `keydown` listener — the vendored `Modal` has none), calling nothing on dismissal | `client/src/app/eval/_components/EvalOverview/_components/RunAllDialog/**` (new) | frontend | AC-46, AC-48 | 2 | `implementer` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library` | `node scripts/verify.mjs --slice frontend` |
| 8 | `EvalOverview` page rewrite + test rewrite: header row (title, AC-36 subtitle, right-aligned accent `Run all agents` with play icon) wired to the dialog and the fan-out hook (disabled while running, disabled with a textual reason when no agent has cases, sticky-disabled with `dashboard.noProviderKey` when every agent 409'd, per-agent failure reasons rendered); `AGENTS` section rendering `AgentRow` per agent instead of the card grid; `RECENT EVAL RUNS · ALL AGENTS` table reordered to agent → time → version → recall → precision → citation → pass → cost, with the version cell as the only link, the agent name as plain text, the three metrics as bar + number, the pass cell bold, the `errored` badge preserved. Both empty states unchanged in behaviour. **Add the new hook to the suite's `vi.mock` factory** | `client/src/app/eval/_components/EvalOverview/EvalOverview.tsx`, `.../styles.ts`, `.../EvalOverview.test.tsx` | frontend | AC-26, AC-27, AC-36, AC-43, AC-44, AC-45, AC-46, AC-47, AC-49, AC-50, AC-51, AC-52 | 4, 6, 7 | `implementer` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library` | `node scripts/verify.mjs --slice frontend` |
| 9 | **Integration pass** — its own step because unit tests on either side of a seam agree with themselves by construction (`INSIGHTS.md` 2026-08-04). In `server/test/eval.it.test.ts`: `GET /eval/overview` returns a real `trend` per agent (never step 1's `[]` placeholder), chronological oldest-first, capped at `BATCH_TABLE_LIMIT`, with `traces_total = 0` batches excluded and `last_batch` equal to the newest trend batch; an agent with one batch yields exactly one point; a skill-owned case still never appears (AC-28 regression guard). Plus the cross-lane seam checks: the client copy of `EvalAgentSummary` matches the server copy field-for-field, and the route+method the step-4 hook posts to is the one `routes.ts:121-128` registers | `server/test/eval.it.test.ts`; point fixes anywhere the seam check finds a mismatch | backend + integration | AC-40, AC-41, AC-47 (server half) | 5, 8 | `implementer` | `onion-architecture` | `cd server && pnpm db:migrate` (only if the DB is behind) → `node scripts/verify.mjs --slice integration` → `node scripts/verify.mjs --slice backend --slice frontend` |
| 10 | Docs: `client/README.md:137-149` still describes `/eval` as a **card** per agent and says a batch run "happens from the agent editor's own Evals tab" — both are false after this plan; update to the row layout (tile, stats, sparkline, chevron), the new table column order and the `Run all agents` flow with its confirmation. `server/README.md:217-218` gains one sentence: `GET /eval/overview` now carries a per-agent trend series | `client/README.md`, `server/README.md` | meta | AC-26, AC-27, AC-36…AC-52 (scaffolding — documents the shipped surface) | 9 | `doc-writer` | — (`meta`) | `node scripts/check-specs.mjs`; re-reading. No `AGENTS.md` edit — see **Risks** |

## Execution

Mode is **multi-agent**, orchestrated by the main session through
`/implement .claude/plans/l06-evals-eval-dashboard-design-fidelity.md`; the
commit between stages is the main session's, never an agent's. The waves below
are what `/implement` builds from **Depends on** plus the **Ownership** table —
written out so the "Run with this split?" gate has something to check against.

| Wave | Lanes | Steps | Why this shape |
|---|---|---|---|
| 1 | 4 | 1 · 2 · 3 · 4 | Four independent roots: the wire, the copy, the local formatters, the fan-out hook. No shared path. Step 1 carries two one-line placeholder touch-ups precisely so waves 2–3 never start from a red lane. |
| 2 | 3 | 5 · 6 · 7 | The server read model needs the contract; the two new client components need the contract, the copy and the formatters — and they are separate new folders, so they are separate lanes. |
| 3 | 1 | 8 | The page consumes all three of wave 2's outputs plus the hook. One lane, because everything it touches is one component's own files. |
| 4 | 1 | 9 | Integration pass. Starts only when every wave-2/3 lane has reported `Steps: N/N`. |
| 5 | 1 | 10 | `/implement`'s docs stage. |

### Ownership

Every path belongs to exactly one lane of its wave. "Must not touch" lists the
paths of the **other lanes in the same wave**; a later wave building on an
earlier wave's file is expected, not a collision.

| Wave | Lane | Steps | Owns | Must not touch |
|---|---|---|---|---|
| 1 | W1-A | 1 | `server/src/vendor/shared/contracts/eval-ci.ts`, `client/src/vendor/shared/contracts/eval-ci.ts`, and **only** the `trend: []` placeholder lines in `server/src/modules/eval/dashboard.ts` and `client/src/app/eval/_components/EvalOverview/EvalOverview.test.tsx` | `client/messages/**`, `client/src/lib/hooks/**`, `EvalOverview/helpers.ts`, `EvalOverview/constants.ts`, `server/src/modules/eval/repository.ts` |
| 1 | W1-B | 2 | `client/messages/en/eval.json` | `client/src/**`, `server/**` |
| 1 | W1-C | 3 | `client/src/app/eval/_components/EvalOverview/helpers.ts`, `.../constants.ts` | `.../EvalOverview.tsx`, `.../styles.ts`, `.../EvalOverview.test.tsx`, `client/messages/**`, `client/src/lib/**`, `server/**` |
| 1 | W1-D | 4 | `client/src/lib/hooks/eval.ts`, `client/src/lib/hooks/eval.test.tsx` | `client/src/app/**`, `client/messages/**`, `client/src/vendor/**`, `server/**` |
| 2 | W2-A | 5 | `server/src/modules/eval/repository.ts`, `server/src/modules/eval/dashboard.ts` | `client/**`, the rest of `server/src/modules/eval/**` |
| 2 | W2-B | 6 | `client/src/app/eval/_components/EvalOverview/_components/AgentRow/**` | `.../_components/RunAllDialog/**`, `.../EvalOverview.tsx`, `.../styles.ts`, `.../helpers.ts`, `.../constants.ts`, `server/**` |
| 2 | W2-C | 7 | `client/src/app/eval/_components/EvalOverview/_components/RunAllDialog/**` | `.../_components/AgentRow/**`, `.../EvalOverview.tsx`, `.../styles.ts`, `server/**` |
| 3 | W3-A | 8 | `client/src/app/eval/_components/EvalOverview/EvalOverview.tsx`, `.../styles.ts`, `.../EvalOverview.test.tsx` | `client/src/vendor/**`, `client/messages/**`, `server/**`, and the two sub-component folders (consume their barrels, do not edit them) |
| 4 | W4-A | 9 | `server/test/eval.it.test.ts` + point fixes anywhere a seam mismatch is found (sole lane in the wave — no conflict) | `client/src/vendor/ui/**`, `server/src/db/migrations/*.sql` |
| 5 | W5-A | 10 | `client/README.md`, `server/README.md` | code, `AGENTS.md` |

**What each handoff carries:** the plan path
(`.claude/plans/l06-evals-eval-dashboard-design-fidelity.md`), the lane's own
step numbers, its owned paths and its siblings' paths as "must not touch", and —
from wave 2 on — the line "steps *n…* of earlier waves are done; build on them,
do not redo them". Back comes the implementation report with `Steps: N/N`.
Steps 6, 7 and 8 must each state in their report **which props/hook shape they
consumed or published**; that is the input step 9 builds its seam checks from.

**Human stages, outside the agent chain:**

1. Between wave 3 and wave 4, or immediately after wave 4, a **manual
   click-through of `/eval`** — the row layout, the keyboard path (Tab to a row,
   Enter), the confirm dialog's counts, Escape, and one real `Run all agents` on
   a workspace with a provider key. `INSIGHTS.md` 2026-08-26: eight
   `/code-review` angles, a security pass, an architecture review and
   `plan-verifier` all missed two user-visible defects on this exact feature
   because reviews read code and only running it reads the screen. The run costs
   real model budget — it is a human decision, never an agent's.
2. The PR itself (`/pr-self-review`), including the **Insights** section
   (`AGENTS.md:73-76`). No `Vendor-update:` line is needed on this branch.

## Contract & migration impact

**What crosses the wire, and which copies move together.** Exactly one field:

```
EvalAgentSummary.trend: EvalTrendPoint[]
```

added in step 1 to `server/src/vendor/shared/contracts/eval-ci.ts` (canonical)
**and** `client/src/vendor/shared/contracts/eval-ci.ts` (trimmed copy) in the
same step. The two copies are already identical across lines 148–208 (verified
by diffing them), so this is an append to the same block on both sides.

**Field meanings pinned per variant** — `trend` and `last_batch` look like they
answer the same question and do not, which is precisely the kind of field two
lanes implement differently:

- `last_batch === null` → **"never run"**. This, and only this, is the AC-42
  discriminant for the row's meta line, the three stat values and the badge.
  A renderer must never infer "never run" from `trend.length === 0`.
- `trend: []` → **"nothing measurable to plot"**, which is *two* different
  situations at once: no batch has ever run, **or** every batch this agent ran
  had `traces_total = 0` (every case errored) and was excluded. An agent can
  therefore legitimately have a non-null `last_batch` and an empty `trend`.
- `trend.length === 1` → a real measurement, but **no line**: AC-40 forbids
  drawing at fewer than two points, and the vendored `Sparkline` would emit a
  `NaN` path anyway (`i / (data.length - 1)` at length 1).
- Point order → **chronological, oldest first** (the opposite of every table in
  this feature, which is newest-first). Same convention as
  `EvalDashboard.trend`.
- Point cap → ≤ `BATCH_TABLE_LIMIT` (20) per agent, the same constant the agent
  page's table uses.
- Which number the sparkline draws → **`recall`** only. The other fields of
  `EvalTrendPoint` are carried so the overview and the agent page share one
  shape and one exclusion rule, not because the row renders them.
- `EvalTrendPoint.citation_accuracy` stays nullable and is **never** coerced to
  `0` (the existing rule at `dashboard.ts:182-197`); the sparkline does not read
  it, so no null reaches the chart.

**Lane-internal contract (not on the wire, but the seam between steps 4 and 8)**
— the fan-out hook's exported shape, pinned here so the two lanes cannot
implement two different things:

```
useRunAllAgentEvalBatches() → {
  run(agents: ReadonlyArray<{ agent_id: string; name: string }>): Promise<RunAllOutcome[]>
  isRunning: boolean
  outcomes: RunAllOutcome[]      // last run's per-agent results; [] before the first run
  allNoProviderKey: boolean      // AC-52: every attempted agent failed 409 no_provider_key
}

type RunAllOutcome =
  | { agent_id: string; name: string; status: "ok";    batch: AgentEvalBatch }
  | { agent_id: string; name: string; status: "error"; code: string; message: string }
```

Per-variant meaning: `status: "ok"` always carries a `batch` and never a
`code`/`message`; `status: "error"` never carries a `batch`. `code` is the
server's own error code — `no_provider_key` (409, the AC-52 variant),
`empty_eval_set` (422, not expected because the server pre-filters non-empty
sets, but handled like any other), or anything else the API returns. `run()`
resolves — it does **not** reject — even when every agent failed; rejecting
would take AC-51's surviving agents down with the first failure.

**Migration.** **None.** `trend` is derived at read time from `eval_runs` rows
that already exist. No schema file changes, no `drizzle-kit generate`, no new
`.sql`. `cd server && pnpm db:migrate` still precedes the integration slice
whenever the local database is behind the branch's existing migrations —
migrations do not run on boot (`AGENTS.md:41`).

## Verification plan

- `node scripts/verify.mjs --slice frontend` — steps 1, 2, 3, 4, 6, 7, 8.
- `node scripts/verify.mjs --slice backend` — steps 1, 5, 9.
- `node scripts/verify.mjs --slice integration` — step 9. Needs Docker and a
  migrated database; `cd server && pnpm db:migrate` first if the local DB is
  behind (this plan adds no migration of its own).
- `pnpm verify:l06` — the whole-plan gate before the PR (it is
  `node scripts/verify.mjs --slice frontend --slice backend --slice integration`,
  root `package.json`), and the command AC-35 of the shipped half already binds.
- `node scripts/pr-gate-ci.mjs --base <base sha> --body-file <PR body>` — the
  PR-body gate (`.github/workflows/pr-gate.yml`): the **Insights** section is
  required, a `Vendor-update:` line is not (no vendored file is edited).
- `node scripts/check-specs.mjs` — step 10 and the spec generally
  (`.github/workflows/pr-gate.yml`). The spec is input here and is not edited.
- **Not covered by `verify.mjs`, and deliberately so:** the manual click-through
  in **Execution** (it spends model budget), and `.github/workflows/evals.yml`,
  which starts on this branch because committing this plan touches `.claude/**`.
  A plan file is neither a skill nor an agent nor `AGENTS.md`, so
  `evals/scripts/ci-detect.mjs` should route it to a printed SKIP at zero token
  cost — confirm that in the `detect` job summary rather than assuming it.

## Out of scope / left to reviewers

- Architecture review, `/code-review`, `/security-review`, `plan-verifier`,
  `/pr-self-review` and opening the PR — `/implement` stages, not plan rows.
- Every criterion of SPEC-05 outside this delta: AC-1…AC-25 and AC-28…AC-35.
  They are implemented on this branch and are not re-graded by this plan.
- The spec's **Non-goals**, verbatim:
  - «Не чіпаємо eval для **скілів**: `POST /skills/:id/eval-run`, вкладка
    `Evals` у редакторі скіла і компаратор за мультимножиною severity
    (`server/src/modules/skills/helpers.ts:142-186`) лишаються як є. Агентський
    скоринг — інший (за `file:line`), і два скорери співіснують навмисно.»
  - «Не будуємо LLM-суддю: на лабораторній він був потрібен, бо "пояснив
    причину" підрядком не рахується; тут очікування — це `file:line`.»
  - «Не автоматизуємо прогін: жодного прогону за розкладом, при відкритті
    сторінки чи після збереження агента — кожен прогін коштує N викликів моделі
    й запускається людиною. `Run all agents` цього не порушує: це людський
    жест, додатково підтверджений діалогом (AC-46).»
  - «Не робимо експорт evals у CI, secret/phantom-гейти й conformance — це
    решта L06 і окремі спеки.»
  - «Не переносимо метрики агента в `agent-performance` (L08).»
- Spec open questions the spec itself defaults out of scope and this plan does
  not touch: `Promote v7` in the compare modal, the `30 days` period filter, and
  a `g`-chord for the sidebar item.
- The agent page (`/eval/:agentId`) is unchanged except where step 5's shared
  read model touches its data path — its layout is AC-30…AC-34, already shipped.
- An `e2e` flow for `/eval`: NFR Тестові лейни keeps paid model paths out of e2e,
  and the `Run all agents` flow is the paid path.

## Risks

- **The `trend: []` placeholder from step 1 ships.** If step 5 slips or is
  partially done, the wire is schema-valid and the sparkline silently never
  draws. Cheapest early signal: step 9's integration assertion that a
  two-batch agent returns exactly two points from the live route — it fails
  loudly on a surviving placeholder. Second signal: step 6's test renders a row
  with two points, so a client-side regression is caught separately.
- **A hardcoded timestamp literal in a test.** `YYYY-MM-DD HH:mm` in local time
  is green in CI (UTC) and red on a developer's machine, or the reverse — a
  failure that reads like a bug in the formatter. Signal: any test asserting a
  date literal instead of the shape regex; catch it in review of steps 3/6/8,
  before it is a flake someone re-runs.
- **The new hook export breaks unrelated suites.** `client/INSIGHTS.md`
  2026-08-20: a plain `vi.mock` factory missing a new export dies as a hard mock
  error mid-render, not an assertion failure. Signal:
  `node scripts/verify.mjs --slice frontend` at the end of step 4 — if suites
  that never mention `Run all agents` go red, this is why.
- **`Run all agents` spends real money on the first live click.** N agents × M
  cases model calls. Signal, before any of it: the dialog must print both counts
  and the RTL test must assert that dismissing it fires no mutation (AC-48).
  Never exercise this path from an agent lane — it belongs to the human stage.
- **Column reorder drops the `errored` badge.** It currently lives inside the
  pass cell (`EvalOverview.tsx:163-167`) and is easy to lose while rewriting the
  row. Signal: the existing "marks a batch with errored cases" test must survive
  the rewrite of step 8 — it is a kept test, not a new one.
- **The row becomes two focus targets.** Wrapping the row in a link and then
  putting a link/button in the version or stat area silently breaks AC-37 and
  produces nested-interactive markup. Signal: step 6's explicit "exactly one
  focusable element in the row" assertion.
- **Per-agent trend widens the overview read.** Step 5 fetches every recent
  batch of every agent instead of one batch each. Bounded by batch count, not
  case count, but it is the read AC's NFR pins at ≤ 300 ms. Signal: if
  `server/test/eval.it.test.ts` slows noticeably in step 9, the top-N-per-agent
  reduction went into SQL rows instead of JS.

## Open questions

- **Where the AC-51 per-agent failure list renders** (under the header, on the
  failing agent's row, or a toast). Default the executor assumes: a compact list
  under the header row, each line "agent name — reason", cleared when the next
  run starts. The spec fixes the content, not the placement, and the placement
  is reversible at the keyboard.
- **Whether the section headings are uppercased in the copy or in CSS.**
  Default: the copy carries the exact words AC-26/AC-27 quote (`AGENTS`,
  `RECENT EVAL RUNS · ALL AGENTS`); any additional `text-transform` is styling.
- **Whether the fan-out should stop early once every attempted agent has failed
  with 409.** Default: no — it attempts every agent, then applies AC-52. Provider
  keys are per-agent-provider, and a 409 is raised before any provider call, so
  the extra attempts cost no tokens.
