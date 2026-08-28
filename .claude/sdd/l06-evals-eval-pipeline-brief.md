# Handoff brief — l06-evals-eval-pipeline
Spec: specs/SPEC-05-eval-pipeline-26-08-2026.md (draft) · Plan: .claude/plans/l06-evals-eval-pipeline.md · Branch: L06-Evals · Base: 4765abcc8fdd446942c6e0da17d984b9d0c30b6d

## Binding rules (locators, not prose)

- `AGENTS.md` (Conventions) — `@devdigest/shared` існує **двічі**: канонічна
  `server/src/vendor/shared`, урізана `client/src/vendor/shared`; зміну, що
  перетинає дріт, робимо в обох копіях одним кроком.
- `AGENTS.md` (Conventions) — контракти Zod-first: одна схема валідує запит і
  серіалізує відповідь; `Schema.parse(req.body)` у хендлері заборонено.
- `AGENTS.md` (Conventions) — DB-backed тест мусить закінчуватись `.it.test.ts`;
  на цьому globʼі розходяться unit- і integration-лейни.
- `AGENTS.md` (Conventions) — «This is NOT a monorepo workspace: six independent
  packages… **Installing at the repo root does nothing**». Крок 4 (кореневий
  `package.json`) робить це твердження частково неправдивим → крок 16 його
  виправляє.
- `AGENTS.md` (Conventions) — міграції не застосовуються на бутi: `cd server &&
  pnpm db:migrate`; `server/src/db/migrations/*.sql` не редагуються.
- `AGENTS.md` (Do not touch) + `.claude/settings.json:5-13` — `deny` на
  `Edit|Write(./**/src/vendor/ui/**)` і на `Write(./server/src/db/migrations/*.sql)`.
  (а) рядок `nav.ts` — крок **людини**, не агента; (б) міграція створюється
  **тільки** через `pnpm db:generate` (Bash), ніколи не пишеться руками.
- `server/AGENTS.md:12-17` — анатомія модуля `modules/<name>/{routes,service,
  repository}.ts`; додати модуль = плагін + один запис у `src/modules/index.ts`,
  реєстрація статична.
- `server/AGENTS.md:18-19` — zod `params`/`body` оголошуються **на роуті** (422
  до хендлера); статусні помилки — `AppError`.
- `server/AGENTS.md:20-22` — адаптери лише через DI-контейнер; саме це робить
  підміну `ContainerOverrides` у тестах робочою.
- `onion-architecture` (skill) — «Cross-module repositories live on the
  container… Reaching into another module's folder for its repository is a
  boundary violation». Уже вирішено: `container.agentsRepo`
  (`server/src/platform/container.ts:107-109`) і `container.reviewRepo` (`:111-113`)
  існують — **нового порту не потрібно**.
- `onion-architecture` (skill, Team decisions) — «New foreign keys are `ON DELETE
  RESTRICT`, and deletes go through the owning service» (03/05/2026). Тому
  `source_finding_id` — **колонка без FK** (провенанс, не звʼязок).
- `onion-architecture` (skill, Blind spots §4) — inline-запит по чужій таблиці
  через `container.db` компілюється й проходить depcruise, але звʼязує так само.
  Тому `pr_files.patch` і `findings` читаються через `container.reviewRepo`.
- `server/src/modules/reviews/repository.ts:40,111,116` — `getPrFiles(prId)`,
  `getFinding(id)`, `findingContext(id) → { finding, review, pull }`. Усе для
  «Turn into eval case» **уже є на контейнері** — модуль `reviews` не змінюється.
- `server/src/modules/agents/repository.ts:65,109-122,172,181,192` — `getById`
  (несе `.version`), `listVersions`, `getVersion`, `linkedSkills`. AC-22 і AC-34
  читаються звідси.
- `server/src/modules/skills/service.ts:295-301` — `unsupported_eval_owner`
  явно відмовляє агентським кейсам; **цей файл не чіпається** (Non-goals).
- `server/src/modules/skills/service.ts:311-313` — «Sequential on purpose: these
  are paid model calls» — прогін набору агента копіює цю послідовність.
- `server/src/modules/skills/service.ts:417-419` — відсутній ключ провайдера
  стає **409** (`server/src/platform/errors.ts:49-59`). AC-24 — той самий механізм.
- `server/src/modules/skills/helpers.ts:142-186` — скіловий компаратор за
  мультимножиною severity. Другий скорер, який **не чіпається**.
- `scripts/verify.mjs:52-70,140-165` — `--slice` повторюваний, невідомий слайс →
  exit 2, будь-який червоний гейт → exit 1. Це і є механіка AC-35.
- `.github/workflows/evals.yml:65-75` — `paths:` містить `.claude/**` і
  `AGENTS.md`; ця гілка чіпає обидва → платний workflow-тир стартує. Бюджетно
  очікувано.
- `.github/workflows/pr-gate.yml:62-72` — `node scripts/pr-gate-ci.mjs` (рядок
  `Vendor-update:`) і `node scripts/check-specs.mjs` (`:35` приймає `draft`).
- `.claude/skills/pr-self-review/routing.md:82-97` — declared vendor update:
  `Vendor-update: client/src/vendor/ui/nav.ts` у тілі PR, **пофайлово**.
- INSIGHTS root#2026-08-04 — розподіл між паралельними сабагентами — за
  **file ownership, не за концерном**; міжлейнові контракти ловить лише окремий
  інтеграційний прохід (крок 15).
- INSIGHTS root#2026-08-18 — рядок `nav.ts` для `implementer` **невиконуваний**:
  deny не оминається ні агентом, ні головною сесією.
- INSIGHTS root#2026-08-05 — `drizzle-kit generate` зупиняється на
  **інтерактивному** промпті, коли один дифф і додає, і дропає колонку. Наша
  міграція суто адитивна → промпту не буде.
- INSIGHTS root#2026-08-05 — CI пінить pnpm **10**; локально без піна corepack
  ставить 11. Тому кореневий `package.json` (крок 4) несе `packageManager`.
- INSIGHTS server#2026-08-05 — сідовий PR #482 має рядки `pr_files` **без**
  `patch`. Це рівно кейс AC-5 і готова фікстура для інтеграційного тесту.
- INSIGHTS server#2026-08-13 — `pr_files` наповнюється **побічним ефектом**
  `GET /pulls/:id`; PR, який ніхто не відкривав, має нуль рядків. Другий шлях у
  AC-5, який тест мусить розрізняти від «патч порожній».
- INSIGHTS server#2026-08-11 — інтеграційний тест дістає **реальний** провайдер,
  якщо не підмінити слот `overrides.llm` за ключем провайдера; мокати треба
  **кожен** провайдер, до якого може дотягнутись прогін (AC-21).
- INSIGHTS server#2026-08-20 (macOS) — червоний `--slice backend` на Mac у
  `context-walk`/`depgraph-adapter` — це фікстури на `tmpdir()`, не ця гілка.
- INSIGHTS client#2026-08-20 — логіка в `src/lib/hooks/*` випадає з усіх тестів,
  бо роутові сюїти мокають модуль хуків цілком; хуковий тест пишеться в тій
  самій зміні (`client/src/lib/hooks/<name>.test.tsx`).
- INSIGHTS client#2026-08-20 (другий) — новий експорт у модулі хуків треба
  додати у `vi.mock`-фабрику **тією ж зміною**, інакше сюїта падає жорстко.
- INSIGHTS client#2026-08-01 — zod-схему з `eval-ci.ts` імпортувати значенням у
  клієнті безпечно (`extensionAlias` у `next.config.mjs` уже полагоджено).
- `client/AGENTS.md:21,24,26-29` — фіча-логіка в колокованому
  `_components/<Name>/` (`Name.tsx`, `constants.ts`, `styles.ts`, `index.ts`,
  `Name.test.tsx`); рядки UI — у `messages/<locale>/*.json`; розкладка
  машинно-перевіряється `pnpm arch`.
- `client/src/components/app-shell/helpers.ts:41` — `activeKeyFor` **вже** мапить
  `/eval`; `client/messages/en/shell.json:24` **вже** має `nav.eval`. Бракує
  тільки рядка в `NAV` (крок 14, людина).
- `client/messages/en/eval.json` і `agents.json:50` — англійська копія екранів
  уже існує (`dashboard.*`, `caseEditor.*`, `evalsTab.*`, `page.*`,
  `editor.tabs.evals`); нові рядки додаються **до неї**, не хардкодяться.
- `client/src/app/skills/[id]/_components/SkillEditor/_components/EvalsTab/**` —
  готовий зразок вкладки Evals + `EvalCaseModal`, який агентська вкладка
  дзеркалить (не переписує і не узагальнює — Non-goals).
- Допродуктова історія: `git show 15fa391^:server/src/modules/eval/{scoring,
  service,routes,dashboard,repository,helpers,constants}.ts` — робочий референс.
  **Два місця, де його не можна копіювати:** його `routes.ts` робить
  `Schema.parse(req.query)` у хендлері (порушує `server/AGENTS.md:18`), а його
  `findingMatches` зараховує збіг ще й за підрядком заголовка та за
  severity/category — AC-15 дозволяє **лише** файл + перетин рядків.

## Contract shapes (крок 1 пише, всі читають — назви полів є контрактом між лейнами)

- `EvalCaseResult` — `{ case_id, case_name, run_id, pass: boolean|null, recall,
  precision, citation_accuracy: number|null, raw_count, grounded_count:
  number|null, error: { code, message } | null }`.
- `EvalBatchRecord` — `{ batch_id, agent_id, agent_name, agent_version, ran_at,
  recall, precision, citation_accuracy: number|null, traces_passed,
  traces_total, cases_errored, duration_ms, cost_usd: number|null }`.
- `AgentEvalBatch` — `EvalBatchRecord` + `cases: EvalCaseResult[]` — відповідь
  `POST /agents/:id/eval-runs`.
- `EvalAlert` — `{ metric: 'recall'|'precision', drop_pp: number, others:
  { recall, precision, citation_accuracy } }` — структура, не готовий рядок.
- `EvalAgentSummary` — `{ agent_id, name, model, cases_total, last_batch:
  EvalBatchRecord | null }`; `EvalDashboardOverview` — `{ agents:
  EvalAgentSummary[], recent_batches: EvalBatchRecord[] }` — відповідь
  `GET /eval/overview`.
- `EvalRunRecord` +`batch_id` +`agent_version` +`error` (усі nullable).
- `EvalDashboard` — `alert: EvalAlert | null`; +`recent_batches:
  EvalBatchRecord[]`; наявне `recent_runs` лишається покейсовим.
- `EvalCase` / `EvalCaseInput` +`source_finding_id: string | null`.
- `expected_output.findings`: непорожній = `must_find` (скорер читає лише `file`
  і пару рядків); `[]` = `must_not_flag` (recall = 1 завжди, precision 0 при
  будь-якій вцілілій знахідці); відсутнє/невалідне = `safeParse` → `[]`,
  непройдений із поясненням, без 500.
- `notes` — скорер не читає **ніколи**.
- `eval_runs.pass = null` = кейс упав: виключається з recall/precision/
  citation_accuracy, з `traces_passed` **і** з `traces_total`, рахується в
  `cases_errored`.
- `eval_runs.actual_output` — успіх: `{ findings, raw_count, grounded_count }`;
  збій: `{ error: { code, message } }`. Причина дублюється колонкою `error_reason`.
- `POST /findings/:id/eval-case` — **201** створено / **200** наявний; тіло
  однакове (`EvalCase`), клієнт відкриває кейс на обох.
- `owner_kind='agent'` фільтрується в **репозиторії** (крок 5), не в UI.
- Поріг регресії: `REGRESSION_THRESHOLD_PP = 2` у `modules/eval/constants.ts`.
- Ліміт таблиць пакетів: 20, константа там само.
- Порожній набір при прогоні перевіряється **до** резолву провайдера (без 409).

## Ownership

| Хвиля | Лейн | Кроки | Володіє | Не чіпає |
|---|---|---|---|---|
| 1 | W1-A | 1 | server+client `vendor/shared/contracts/{eval-ci,knowledge}.ts` | `server/src/db/**`, `server/src/modules/eval/**`, `package.json`, `client/messages/**` |
| 1 | W1-B | 2 | `server/src/db/schema/eval.ts`, `server/src/db/migrations/**` (лише вивід `pnpm db:generate`) | `server/src/vendor/shared/**`, `client/**`, `server/src/modules/eval/**`, `package.json` |
| 1 | W1-C | 3 | `server/src/modules/eval/{scoring,helpers,constants}.ts`, `server/test/eval-scoring.test.ts` | решта `server/src/modules/eval/**`, `server/src/db/**`, `server/src/vendor/shared/**`, `client/**` |
| 1 | W1-D | 4 | кореневий `package.json`, `client/messages/en/{eval,agents}.json` | `client/src/**`, `server/**` |
| 2 | W2-A | 5 | `server/src/modules/eval/{repository,types}.ts` | `client/**`, решта `server/src/modules/eval/**` |
| 2 | W2-B | 6 | `client/src/lib/hooks/{eval.ts,eval.test.tsx,index.ts}` | `server/**`, `client/src/app/**` |
| 3 | W3-A | 7 | `server/src/modules/eval/service.ts` | інші файли `modules/eval`, `client/**` |
| 3 | W3-B | 8 | `server/src/modules/eval/runner.ts` | інші файли `modules/eval`, `client/**` |
| 3 | W3-C | 9 | `server/src/modules/eval/dashboard.ts` | інші файли `modules/eval`, `client/**` |
| 4 | W4-A | 10 | `server/src/modules/eval/routes.ts`, `server/src/modules/index.ts` | `client/**`, решта `modules/eval` |
| 4 | W4-B | 11 | `client/src/app/agents/[id]/_components/AgentEditor/**` | `client/src/app/repos/**`, `client/src/app/eval/**`, `client/src/lib/**`, `client/messages/**`, `server/**` |
| 4 | W4-C | 12 | `client/src/app/repos/[repoId]/pulls/[number]/_components/{FindingCard/**,FindingsPanel/FindingsPanel.tsx}` | `client/src/app/agents/**`, `client/src/app/eval/**`, `client/src/lib/**`, `client/messages/**`, `server/**` |
| 5 | W5-A | 13 | `client/src/app/eval/**` | `client/src/app/agents/**`, `client/src/app/repos/**`, `client/src/lib/**`, `server/**` |
| — | людина | 14 | `client/src/vendor/ui/nav.ts` | усе інше |
| 6 | W6-A | 15 | `server/test/eval.it.test.ts` + точкові правки за розбіжностями | `client/src/vendor/ui/**`, `server/src/db/migrations/*.sql` |
| 7 | W7-A | 16 | `AGENTS.md`, `server/README.md`, `client/README.md` | код |

## Amendments in force

none

## Known pre-existing failures

- Working tree carries an untracked, unregistered `server/src/modules/checkout/`
  (leftover scratch, not this plan). Do not touch it, do not register it, do not
  commit it.
- `node scripts/verify.mjs --slice backend` is red on macOS **before this branch
  changes anything** (verified on 4765abc working tree, 2026-08-26): gate
  `server unit tests`, failing file `test/depgraph-adapter.test.ts`
  (tmpdir fixtures — INSIGHTS server#2026-08-20). Not this branch's fault; do
  not investigate, do not fix, report it as known pre-existing. Every other
  backend gate and the whole frontend slice are green (432/432 client tests).
