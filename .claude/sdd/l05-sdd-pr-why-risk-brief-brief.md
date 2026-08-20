# Handoff brief — l05-sdd-pr-why-risk-brief

Spec: `specs/SPEC-04-pr-why-risk-brief-20-08-2026.md` (approved) · Plan:
`.claude/plans/l05-sdd-pr-why-risk-brief.md` · Branch: `L05-SDD` · Base:
`5d82522d6bd6ad2139fa11b067aa4a7fc2ddffe9`

Це твій Крок 1. Читай його замість того, щоб перевиводити контекст із
`AGENTS.md` / `INSIGHTS.md` / спеки / плану. Поза ним читай **лише** файли, які
будеш редагувати (і їхні тести). Якщо цей brief розходиться з репозиторієм —
скажи це у звіті, не перевиводь мовчки.

## Binding rules (locators, not prose)

- `AGENTS.md:31-35` — `@devdigest/shared` існує двічі: `server/src/vendor/shared`
  (канонічна) і `client/src/vendor/shared` (обрізана копія). Редагуємо серверну,
  потім дзеркалимо — **ніколи лише одну**. Сьогодні `contracts/brief.ts` в обох
  копіях байт-у-байт однаковий і має таким лишитись.
- `AGENTS.md:36-38` — контракти Zod-first: одна схема валідує запит **і**
  серіалізує відповідь; `Schema.parse(req.body)` у хендлері заборонено.
- `AGENTS.md:39-40` — DB-тест закінчується на `.it.test.ts`; юніт- і
  інтеграційна смуги розділені саме цим глобом.
- `AGENTS.md:24-30` — п'ять незалежних пакетів; `server/`, `client/` → **pnpm**;
  `e2e/`, `mcp/`, `reviewer-core/` → **npm**. Міграції не застосовуються на
  буті: `cd server && pnpm db:migrate`.
- `AGENTS.md:60-63` — не чіпати: `server/clones/**`, застосовані
  `server/src/db/migrations/*.sql`, `**/src/vendor/ui/**`.
- `AGENTS.md:59` — коли проза і CI розходяться, істина в `.github/workflows/**`.
- `server/AGENTS.md:13-17` — анатомія модуля
  `modules/<name>/{routes,service,repository}.ts` + один рядок у
  `src/modules/index.ts`; реєстрація статична.
- `server/AGENTS.md:18-19` — zod `params`/`body` оголошуються на маршруті (422 до
  хендлера); `AppError` для всього зі статусом.
- `server/AGENTS.md:20-22` — адаптери лише через DI-контейнер, інакше підміна
  `src/adapters/mocks.ts` у тестах не працює.
- `server/AGENTS.md:35` — глобальний rate limit вимкнено під `NODE_ENV=test`
  (пер-маршрутний ліміт AC-5 треба перевіряти саме як пер-маршрутний).
- `server/.dependency-cruiser.cjs:83-97` (`no-cross-module-internals`) — чужі
  `service/repository/helpers` приватні; імпортувати можна лише
  `modules/<other>/(constants|types|index).ts` і `modules/_shared/**`. **Це
  причина кроків 3 і 4.**
- `.claude/skills/onion-architecture/SKILL.md` — «Cross-module repositories live
  on the container»; порт-інтерфейс у `modules/<name>/types.ts`, конструювання —
  у композиційному корені. Прецедент: `container.projectContext = new
  ContextService(this)` (`server/src/platform/container.ts:143-147`), інтерфейс у
  `server/src/modules/context/types.ts:61-105`.
- `server/src/platform/container.ts:102-110` — `container.reviewRepo`
  (санкціонований крос-модульний шов: `getPull`, `getRepo`, `getPrFiles`,
  `getIntent`); `server/src/modules/reviews/repository.ts:32-40,136-141`.
- `server/src/modules/blast/routes.ts:11-16,26-38` — прецедент пари GET (без
  LLM/GitHub, без ліміту) + POST (ліміт 10/хв);
  `server/src/modules/reviews/routes.ts:135-156` — прецедент `null`-замість-404
  для intent і того самого ліміту.
- `server/src/modules/onboarding/service.ts:136-198` — прецедент рівно одного
  `completeStructured` з `maxRetries`, «попередній збережений результат не
  чіпаємо при помилці», телеметрія одним рядком логу (`routes.ts:59`).
- `server/src/modules/onboarding/helpers.ts:82-89` — `OnboardingDraft`:
  strict-сумісна чернетка (без `z.record`, без `.optional()`), окрема від
  wire-контракту.
- root `INSIGHTS.md:31-41` — `z.record`/`.optional()` відхиляються `strict: true`
  у structured output.
- root `INSIGHTS.md:80-90` — будь-який `file:line` з repo-intel резолвиться проти
  `last_indexed_sha`, ніколи проти `head_sha` PR. Пряма причина AC-20 і того, що
  `review_focus[].line` — лише текст.
- root `INSIGHTS.md:44-52` — паралельні агенти діляться **за власністю файлів**;
  шви МІЖ агентами не ловляться юніт-тестами — звідси інтеграційний крок 14.
- `server/INSIGHTS.md:106-114` — `pr_files` наповнюється побічним ефектом
  `GET /pulls/:id`, а не імпортом: у PR, який ніхто не відкривав, нуль рядків
  `pr_files`. `blast/service.ts` віддає `no_changed_files` замість звинувачення
  індексу.
- `server/INSIGHTS.md:266-286` — інтеграційний тест, чия фіча резолвить провайдера
  через `resolveFeatureModel`, дістає **реальний** провайдер, якщо не замокати
  саме той слот `overrides.llm`. `risk_brief` за замовчуванням `openai`
  (`server/src/vendor/shared/contracts/platform.ts:67-72`).
- `server/INSIGHTS.md:199-207` — body-less POST приходить у валідатор як `null`;
  тіла немає — `body` на маршруті не оголошуємо.
- root `INSIGHTS.md:137-141` — `drizzle-kit generate` зупиняється на
  інтерактивному промті, коли дифф і додає, і прибирає колонку. Наша міграція
  **тільки додає** — промта бути не має; якщо з'явився, у дифі є щось зайве.
- root `INSIGHTS.md:128-135`, `server/INSIGHTS.md:215-224` — `depcruise` падає під
  Node 18 (`styleText`): `source ~/.nvm/nvm.sh && nvm use 22` перед кожним
  server/client прогоном.
- `client/AGENTS.md:13-19` — типи лише з `@devdigest/shared`; увесь доступ до API
  через `src/lib/api.ts`, хуки в `src/lib/hooks/*`; компонент, що кличе `fetch`
  напряму, мовчки обходить мок тестів.
- `client/AGENTS.md:20-24` — сторінки тонкі, логіка в колокованому
  `_components/<Name>/` (`Name.tsx`, `constants.ts`, `styles.ts`, `index.ts`,
  `Name.test.tsx`); рядки UI — у `messages/<locale>/*.json`.
- `client/AGENTS.md:26-29` — правила розміщення машинні: `pnpm arch`.
- `client/INSIGHTS.md:42-55` — два послідовні `setParam` у одному хендлері
  губляться; багатоключове оновлення query — один `setParams` (`page.tsx:69-88`).
- `client/INSIGHTS.md:56-69` — розширюючи props спільного компонента, експортуй
  тип із його барелю (`diff-viewer/index.ts` уже експортує `DiffFileMeta`).
- `client/INSIGHTS.md:73-83` — `scrollIntoView` у ціль, яку ефект сусіда зараз
  посуне, недоліт; патерн — ре-скрол щокадру до стабілізації `offsetTop` з
  лімітом кадрів (`FindingsPanel.tsx`, `SCROLL_SETTLE_MAX_FRAMES`).
- `client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx:26-45` —
  `DiffFileMeta { defaultOpen?, annotations? }` — єдиний наявний важіль
  «розгорнути файл»; якоря/скролу компонент не має.
- `e2e/AGENTS.md:16-24` — флоу — JSON-команди agent-browser, детерміновані
  локатори, **read-only seeded дані, жодного модельного виклику**; запускати
  `./scripts/e2e.sh`. Прецедент «перевіряємо стан без генерації» —
  `e2e/specs/11-onboarding-tour.flow.json`.
- `scripts/verify.mjs:27-31,109-131` — що саме запускає кожен зріз.
- `server/src/db/seed.ts:306-317,347-359` — сіяний PR #482 має `pr_files` і ревʼю
  `kind='review'` зі `score: 61`; PR #483 — єдиний із реальним текстом `patch`.

## Ownership

Поділ **за власністю файлів**, не за концернами. Жоден шлях не належить двом
смугам. Смуга пише **лише** свої шляхи; усе інше — чуже, навіть якщо «там одна
дрібниця».

| Смуга | Кроки | Володіє (пише) | Не чіпає |
|---|---|---|---|
| K | 1 | `server/src/vendor/shared/contracts/brief.ts`, `client/src/vendor/shared/contracts/brief.ts`, обидва `vendor/shared/index.ts` | усе інше |
| A1 | 2, 3, 4 | `server/src/db/schema/reviews.ts`, нова `server/src/db/migrations/0017_*.sql` (+ `meta/`), `server/src/modules/blast/{types.ts,service.ts}`, `server/src/platform/container.ts`, `server/src/adapters/mocks.ts`, `server/src/modules/_shared/linked-issue.ts`, `server/src/modules/reviews/intent-inputs.ts` | `server/src/modules/brief/**`, `server/src/db/seed.ts`, `server/test/**`, `client/**`, `e2e/**`, `vendor/shared/**` |
| A2 | 5, 6, 7 | `server/src/modules/brief/**`, `server/src/modules/index.ts`, `server/src/prompts/brief.system.md` | усе, чим володіють A1/A3/A4, `client/**`, `e2e/**`, `vendor/shared/**` |
| A3 | 12 | `server/src/db/seed.ts` | усе інше |
| A4 | 8 | `server/test/**` | `server/src/**` (продакшн-код уже написаний A1/A2), `client/**`, `e2e/**` |
| B1 | 9, 10 | `client/src/lib/hooks/{brief.ts,index.ts}`, `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/**`, `.../_components/OverviewTab/**`, `client/messages/en/brief.json` | `server/**`, `e2e/**`, `vendor/shared/**`, `client/src/vendor/ui/**`, `page.tsx`, `DiffTab/**` |
| B2 | 11 | `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`, `.../_components/DiffTab/**`, `.../_components/SmartDiffViewer/helpers.ts`, `client/src/components/diff-viewer/index.ts` | усе, чим володіє B1, `server/**`, `e2e/**` |
| E | 13 | `e2e/specs/12-pr-why-risk-brief.flow.json`, `e2e/README.md` | `server/**`, `client/**` |
| INT | 14 | — (перевіряє, не переписує; правки за знахідками — у смузі-власнику шляху) | — |

## Amendments in force

Прийнято людиною після написання плану (2026-08-20). **Перекривають рядки кроків
там, де розходяться.**

| # | Поправка | Кроки |
|---|---|---|
| A1 | Сіяний рядок `pr_brief` для PR #482 як опора e2e — лишається в плані | 12, 13 |
| A2 | `linkedIssueNumber` промотується в `modules/_shared/linked-issue.ts`, `modules/reviews/intent-inputs.ts` реекспортує | 4 |
| A3 | `fileMeta` цільового файла має **рівно одного власника** — там, де він уже збирається (`SmartDiffViewer/helpers.ts`); другого власника `defaultOpen` не з'являється | 11 |
| A4 | **Нове.** Єдиний рядок логу генерації несе `inputs[]` **повністю** — статус по кожному джерелу, не лише підсумок; тест на лог у `brief.it.test.ts` перевіряє наявність статусу кожного джерела. Наслідок: додатковий підрахунок у `briefLogFields` | 6, 7, 8 |

## Open questions — дефолти, які виконавець приймає без перепитування

1. Не більше **5** пунктів Review Focus і **5** ризиків; решта відкидається на
   боці сервера **до збереження**.
2. `review_focus[].line` — необов'язкове, **лише для тексту** пункту; перехід —
   по файлу.
3. Маршрути: **обидва** — `GET` і `POST`.
4. Оцінка — з `GET /pulls/:id/reviews`, перший рядок із `kind = 'review'`, **без
   нового поля на дроті**.
5. Оцінку зі старішого `head_sha` **не** позначаємо застарілою.
6. Зміна ключа моделі в Settings збережений brief **не** інвалідовує —
   застарілість визначає лише `head_sha`.
7. «Спільний каталог-префікс» (AC-11): документ релевантний, якщо його шлях і
   шлях якогось зміненого файла мають **щонайменше один спільний ведучий сегмент
   каталогу**; корінь репозиторію спільним префіксом не вважається.
8. Параметр адресації файла: `?file=<repo-relative POSIX path, URL-encoded>`,
   поруч із наявними `?tab=`/`?finding=`/`?severity=`, пишеться тим самим
   `setParams` **одним** оновленням.

## Contract — значення полів, закріплені для обох смуг

Повний текст — секція **Contract & migration impact** плану. Найкоротше, що
мусять однаково розуміти backend і frontend:

- `review_focus[].path` — **тільки** шлях зі змінених файлів цього PR; він же
  ціль переходу (`?file=`). `line` — **ніколи** не ціль і не якір; `null` = «модель
  не назвала рядок», не «рядок 0».
- `inputs[].status`: `partial`/`degraded` легальні **лише** для `type: 'blast'`.
  `context_doc` — **по одному запису на документ**, `ref` = repo-relative POSIX
  шлях. `diff` → `unavailable`, коли `pr_files` порожні.
- `stale` **обчислює сервер** при кожному читанні (`pr_brief.head_sha` проти
  `pull_requests.head_sha`). Клієнт лише показує.
- Порожній `review_focus[]` — валідний стан, не помилка.
- `score` у контракті **немає** і не буде: єдине джерело — `reviews.score`.

## Known pre-existing failures

**Встановлено один раз на весь ран (2026-08-20, смуга K + перевірка історії
гілки). Не розслідуй їх повторно — назви у звіті й рухайся далі.**

`node scripts/verify.mjs --slice backend` віддає **exit 1** з 5 червоними
тестами, і жоден із них не спричинений роботою над SPEC-04:

| Тест | Тестів | Походження |
|---|---|---|
| `server/test/depgraph-adapter.test.ts` — POSIX-резолюція ребер, корінь поза cwd | 2 | Червоний **до цієї гілки**: файл існує на базі `5d82522`, гілка його не чіпала |
| `server/test/context-walk.test.ts` — класифікація «виходить за корінь клону (symlink)» | 3 | Доданий **раніше на цій же гілці** (SPEC-01 Project Context, коміти `8c8393c`/`a210398`/`2677dcd`), не цим раном |

Наслідок для смуг: **backend-смуга не може очікувати exit 0** від
`--slice backend`, поки ці 5 стоять. Твій критерій — typecheck PASS, depcruise
PASS, і **жодного нового** червоного тесту понад ці п'ять. Frontend-смуга
очікує чистий exit 0 (`--slice frontend` зелений: 402 тести).
