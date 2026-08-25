# Plan: Eval Pipeline — регресійний захист рев'ю-агентів (SPEC-05)

**Branch:** L06-Evals · **Slices:** frontend · backend · contracts · meta · **Spec:** specs/SPEC-05-eval-pipeline-26-08-2026.md (draft) · **Mode:** multi-agent · **Supersedes:** none

## Context read

Кожен рядок нижче — правило, що зв'язує саме цю зміну, з локатором. Не «прочитав
AGENTS.md», а те, що з нього застосовується.

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
  виправляє. Див. **Risks**.
- `AGENTS.md` (Conventions) — міграції не застосовуються на бутi: `cd server &&
  pnpm db:migrate`; `server/src/db/migrations/*.sql` не редагуються.
- `AGENTS.md` (Do not touch) + `.claude/settings.json:5-13` — `deny` на
  `Edit|Write(./**/src/vendor/ui/**)` і на `Write(./server/src/db/migrations/*.sql)`.
  Два наслідки, обидва планотвірні: (а) рядок `nav.ts` — крок **людини**, не
  агента; (б) міграція створюється **тільки** через `pnpm db:generate` (Bash),
  ніколи не пишеться руками.
- `server/AGENTS.md:12-17` — анатомія модуля `modules/<name>/{routes,service,
  repository}.ts`; додати модуль = плагін + один запис у `src/modules/index.ts`,
  реєстрація статична.
- `server/AGENTS.md:18-19` — zod `params`/`body` оголошуються **на роуті** (422
  до хендлера); статусні помилки — `AppError`.
- `server/AGENTS.md:20-22` — адаптери лише через DI-контейнер; саме це робить
  підміну `ContainerOverrides` у тестах робочою.
- `onion-architecture` (skill) — «Cross-module repositories live on the
  container… Reaching into another module's folder for its repository is a
  boundary violation». Тут це вже вирішено: `container.agentsRepo`
  (`server/src/platform/container.ts:107-109`) і `container.reviewRepo` (`:111-113`)
  існують — **нового порту не потрібно**.
- `onion-architecture` (skill, Team decisions) — «New foreign keys are `ON DELETE
  RESTRICT`, and deletes go through the owning service» (рішення 03/05/2026).
  Прямо суперечить edge case «знахідку видалено — кейс лишається валідним», тому
  `source_finding_id` планується як **колонка без FK** (провенанс, не звʼязок).
  Див. **Constraints that bind this change**.
- `onion-architecture` (skill, Blind spots §4) — inline-запит по чужій таблиці
  через `container.db` компілюється й проходить depcruise, але звʼязує так само.
  Тому `pr_files.patch` і `findings` читаються через `container.reviewRepo`.
- `server/src/modules/reviews/repository.ts:40,111,116` — `getPrFiles(prId)`,
  `getFinding(id)`, `findingContext(id) → { finding, review, pull }`. Усе, що
  потрібно для «Turn into eval case», **уже є на контейнері** — модуль `reviews`
  не змінюється, тому лейни не перетинаються.
- `server/src/modules/agents/repository.ts:65,109-122,172,181,192` — `getById`
  (несе `.version`), коментар «reproducibility for eval», `listVersions`,
  `getVersion`, `linkedSkills`. AC-22 і AC-34 читаються звідси.
- `server/src/modules/skills/service.ts:295-301` — `unsupported_eval_owner`
  явно відмовляє агентським кейсам; **цей файл не чіпається** (Non-goals).
- `server/src/modules/skills/service.ts:311-313` — «Sequential on purpose: these
  are paid model calls» — прогін набору агента копіює цю послідовність.
- `server/src/modules/skills/service.ts:417-419` — відсутній ключ провайдера
  стає **409**, «that becomes the 409 the UI keys its disabled Run buttons off»
  (`server/src/platform/errors.ts:49-59`). AC-24 — той самий механізм.
- `server/src/modules/skills/helpers.ts:142-186` — скіловий компаратор за
  мультимножиною severity. Другий скорер, який **не чіпається**.
- `scripts/verify.mjs:52-70,140-165` — `--slice` повторюваний, невідомий слайс →
  exit 2, будь-який червоний гейт → exit 1. Це і є механіка AC-35.
- `.github/workflows/evals.yml:65-75` — `paths:` містить `.claude/**` і
  `AGENTS.md`. Ця гілка чіпає обидва → воркфлоу стартує; тир вибирає
  `evals/scripts/ci-detect.mjs`. Зміна кореневого `AGENTS.md` = **платний**
  workflow-тир. Див. **Risks**.
- `.github/workflows/pr-gate.yml:62-72` — `node scripts/pr-gate-ci.mjs` (у т.ч.
  рядок `Vendor-update:`) і `node scripts/check-specs.mjs`. `check-specs.mjs:35`
  приймає `draft`, тож статус спеки CI не завалить.
- `.claude/skills/pr-self-review/routing.md:82-97` — declared vendor update:
  `Vendor-update: client/src/vendor/ui/nav.ts` у тілі PR, **пофайлово**;
  декларація каталогом лишається CRITICAL.
- INSIGHTS root#2026-08-04 — розподіл між паралельними сабагентами працює за
  **file ownership, не за концерном**; ловить його лише окремий інтеграційний
  прохід по міжлейнових контрактах. Це причина існування кроку 15.
- INSIGHTS root#2026-08-18 — рядок `nav.ts` у плані для `implementer`
  **невиконуваний**: deny не оминається ні агентом, ні головною сесією; на L05
  це коштувало стадії, файл заносила людина руками.
- INSIGHTS root#2026-08-05 — `drizzle-kit generate` зупиняється на
  **інтерактивному** промпті, коли один дифф і додає, і дропає колонку. Наша
  міграція суто адитивна → промпту не буде; це причина «лише додавання».
- INSIGHTS root#2026-08-05 — CI пінить pnpm **10**; локально без піна corepack
  ставить 11. Тому кореневий `package.json` (крок 4) несе `packageManager`.
- INSIGHTS server#2026-08-05 — сідовий PR #482 має рядки `pr_files` **без**
  `patch`. Це рівно кейс AC-5 і готова фікстура для інтеграційного тесту.
- INSIGHTS server#2026-08-13 — `pr_files` наповнюється **побічним ефектом**
  `GET /pulls/:id`; PR, який ніхто не відкривав, має нуль рядків. Ще один шлях у
  AC-5, який тест мусить розрізняти від «патч порожній».
- INSIGHTS server#2026-08-11 — інтеграційний тест дістає **реальний** провайдер,
  якщо не підмінити слот `overrides.llm` за ключем провайдера; мокати треба
  кожен провайдер, до якого може дотягнутись прогін. Прямо стосується AC-21.
- INSIGHTS server#2026-08-20 (macOS) — червоний `--slice backend` на Mac у
  `context-walk`/`depgraph-adapter` — це фікстури на `tmpdir()`, не ця гілка.
- INSIGHTS client#2026-08-20 — логіка, винесена в `src/lib/hooks/*`, випадає з
  усіх тестів, бо роутові сюїти мокають модуль хуків цілком; хуковий тест
  пишеться в тій самій зміні (`client/src/lib/hooks/<name>.test.tsx`).
- INSIGHTS client#2026-08-20 (другий) — новий експорт у модулі хуків треба
  додати у `vi.mock`-фабрику **тією ж зміною**, інакше сюїта падає жорстко.
- INSIGHTS client#2026-08-01 — перший **runtime**-імпорт з `@devdigest/shared`
  у клієнті ламав webpack; полагоджено `extensionAlias` у `next.config.mjs` —
  тобто zod-схему з `eval-ci.ts` тепер імпортувати значенням безпечно.
- `client/AGENTS.md:21,24,26-29` — фіча-логіка в колокованому
  `_components/<Name>/` (`Name.tsx`, `constants.ts`, `styles.ts`, `index.ts`,
  `Name.test.tsx`); рядки UI — у `messages/<locale>/*.json`; розкладка
  машинно-перевіряється `pnpm arch`.
- `client/src/components/app-shell/helpers.ts:41` — `activeKeyFor` **вже** мапить
  `/eval`; `client/messages/en/shell.json:24` **вже** має `nav.eval`. Бракує
  тільки рядка в `NAV` (крок 14).
- `client/messages/en/eval.json` і `agents.json:50` — англійська копія екранів
  уже існує (`dashboard.*`, `caseEditor.*`, `evalsTab.*`, `page.*`,
  `editor.tabs.evals`); нові рядки додаються **до неї**, не хардкодяться.
- `client/src/app/skills/[id]/_components/SkillEditor/_components/EvalsTab/**` —
  готовий зразок вкладки Evals + `EvalCaseModal`, який агентська вкладка
  дзеркалить (не переписує і не узагальнює — Non-goals).
- Допродуктова історія: `git show 15fa391^:server/src/modules/eval/{scoring,
  service,routes,dashboard,repository,helpers,constants}.ts` — робочий референс
  логіки. **Два місця, де його не можна копіювати:** його `routes.ts` робить
  `Schema.parse(req.query)` у хендлері (порушує `server/AGENTS.md:18`), а його
  `findingMatches` зараховує збіг ще й за підрядком заголовка та за
  severity/category — AC-15 дозволяє **лише** файл + перетин рядків.

## Requirements review

Джерело вимог — SPEC-05 (draft). У колонці «Requirement» — нормативне речення
критерію дослівно; хвіст провенансу спеки (`(← …) · verify: … · лейн`) не
цитується, бо він не є вимогою. Edge cases і NFR — окремими рядками з локатором
секції.

| # | Requirement (verbatim) | Verdict | How the plan handles it |
|---|------------------------|---------|-------------------------|
| AC-1 | ПОКИ знахідка має рішення (`accepted_at` або `dismissed_at` не порожній), система повинна (shall) показувати на її картці активну дію `Turn into eval case` в одному ряду з `Accept` / `Dismiss` / `Learn` / `Reply to author`. | clear (з поправкою) | Крок 12. У `FindingCard.tsx:91-112` ряд дій містить **лише** `Accept` і `Dismiss` — `Learn` / `Reply to author` у репозиторії не існують. Дія стає третьою кнопкою в наявному ряду. Розбіжність винесена в **Recommendations** (R3), не «домальована» в план. |
| AC-2 | ЯКЩО знахідка не має жодного рішення, ТОДІ система повинна (shall) показувати дію `Turn into eval case` вимкненою з підказкою «спершу Accept або Dismiss» і не створювати кейс. | clear | Крок 12: `disabled` + текстова причина (`title`/`aria-describedby`, не лише колір — NFR Доступність), запит не відправляється. |
| AC-3 | КОЛИ користувач натискає `Turn into eval case` на **прийнятій** знахідці, система повинна (shall) створити eval-кейс із `owner_kind: "agent"`, власником — агентом рев'ю цієї знахідки, `input_diff` — патчем файлу знахідки з цього PR і `expected_output.findings` — одним записом із `file`, `start_line`, `end_line`, `severity`, `category`, `title` знахідки, без проміжної форми. | clear | Кроки 7 (сервіс), 10 (роут), 12 (кнопка). Власник — `review.agentId` з `container.reviewRepo.findingContext(id)`; патч — рядок `pr_files` з `path === finding.file`. |
| AC-4 | КОЛИ користувач натискає `Turn into eval case` на **відхиленій** знахідці, система повинна (shall) створити кейс із тим самим `input_diff` і `expected_output.findings: []`, а посилання на відхилену знахідку (`file`, рядки, заголовок) зберегти в `notes` як довідку для людини, не як предмет скорингу. | clear | Крок 7. `notes` ніколи не читається скорером (крок 3) — це закріплено в **Contract & migration impact**. |
| AC-5 | ЯКЩО для файлу знахідки немає тексту патча (`pr_files.patch` порожній), ТОДІ система повинна (shall) відмовити зі зрозумілим повідомленням «немає тексту діффа для цього файлу» і не створювати кейс із порожнім входом. | clear | Крок 7 (`AppError`, 422) + крок 12 (тост). Тест покриває **обидва** шляхи з INSIGHTS server#2026-08-05 і #2026-08-13: рядок є, `patch` порожній — і рядка немає взагалі. |
| AC-6 | ЯКЩО кейс для цієї знахідки вже створений, ТОДІ повторне натискання не повинно (shall not) створювати другий кейс, а має відкрити наявний. | clear | Крок 2 (`source_finding_id` + частковий унікальний індекс), крок 7 (lookup), крок 10 (**201** на створення / **200** на наявний — код статусу є дискримінантом, тіло однакове), крок 12 (обидва коди відкривають кейс). |
| AC-7 | Система повинна (shall) показувати в редакторі агента вкладку `Evals` (`?tab=evals`) поряд із `Config` · `Skills` · `Context`, а в ній — усі кейси набору агента з ім'ям, типом очікування, статусом останнього прогону (`passed` / `failed` / `never run`) і кількістю «пройдено з усіх». | clear | Крок 11 (+ `AgentEditor/constants.ts` TABS). Ключі вже є: `agents.json:50`, `eval.json` `evalsTab.*`. |
| AC-8 | ПОКИ набір агента порожній, система повинна (shall) показувати порожній стан із поясненням і CTA створення кейса, без нулів у метриках, які читаються як результат прогону. | clear | Крок 11, ключ `evalsTab.emptyCases`. |
| AC-9 | ПОКИ агент має хоча б один завершений прогін, вкладка `Evals` повинна (shall) показувати recall, precision, citation_accuracy і `traces_passed / traces_total` останнього прогону та посилання на сторінку цього агента в Eval Dashboard. | clear | Кроки 9 (`GET /eval/dashboard?owner_id=…`), 6 (хук), 11 (рендер + лінк на `/eval/<agentId>`). |
| AC-10 | КОЛИ користувач відкриває кейс, система повинна (shall) дати редагувати його ім'я, `input_diff` і `expected_output`, показувати валідність JSON очікування і зберігати зміни; невалідний JSON блокує збереження з поясненням. | clear | Крок 11 (модалка за зразком `EvalCaseModal` скілів) + крок 10 (`PUT /eval-cases/:id`). |
| AC-11 | КОЛИ користувач видаляє кейс, система повинна (shall) спитати підтвердження, після видалення прибрати кейс із набору разом з його історією прогонів і перерахувати «пройдено з усіх». | clear | Каскад `eval_runs.case_id` уже існує (`schema/eval.ts:24-26`) — нового FK не додаємо. Кроки 5, 10, 11. |
| AC-12 | КОЛИ користувач запускає прогін набору (`POST /agents/:id/eval-runs`), система повинна (shall) прогнати агента на кожному кейсі набору й повернути агреговані `recall`, `precision`, `citation_accuracy`, `traces_passed`, `traces_total`, `duration_ms`, `cost_usd` і результат кожного кейса. | clear | Кроки 1 (контракт `AgentEvalBatch`), 8 (раннер), 10 (роут). Ім'я роуту — з завдання, як зафіксовано в Design review спеки. |
| AC-13 | ПОКИ триває прогін, система повинна (shall) використовувати як вхід агента лише збережені поля кейса (`input_diff`, `input_files`, `input_meta`) і не звертатися ні до GitHub, ні до клону на диску. | clear | Крок 8: раннер бачить `container.agentsRepo`, `container.llm()` і рядок кейса — і нічого більше. Крок 15 доводить це нульовими викликами `github`/`git`-моків. |
| AC-14 | Система повинна (shall) пропускати знахідки кожного прогону через той самий citation-grounding gate, що й звичайне рев'ю (знахідка, чиї рядки не перетинають реальний hunk, відкидається), і зберігати кількість знахідок **до** й **після** гейта. | clear | Крок 8: `parseUnifiedDiff` + `groundFindings` з `server/src/platform/grounding.ts` (той самий модуль, що й у рев'ю). `raw_count` / `grounded_count` лягають в `actual_output`. |
| AC-15 | Система повинна (shall) зараховувати очікувану знахідку як знайдену тоді й лише тоді, коли якась фактична знахідка має той самий нормалізований шлях файлу **і** її діапазон рядків перетинається з очікуваним; кожна фактична знахідка може бути зарахована не більше одного разу. | clear | Крок 3, чиста функція. **Явно вужче**, ніж допродуктовий `findingMatches` — збіг за заголовком і за severity/category видаляється; це записано в кроці 3 як вимога, бо копіювання референсу порушило б AC-15. |
| AC-16 | Система повинна (shall) обчислювати `recall` кейса як частку зарахованих очікувань від усіх очікувань кейса, і рахувати його рівним 1, коли очікувань нема. | clear | Крок 3 + unit. |
| AC-17 | Система повинна (shall) обчислювати `precision` кейса як частку фактичних знахідок, що були зараховані, від усіх знахідок, які пережили grounding gate, і рахувати його рівним 1, коли знахідок нема. | clear | Крок 3 + unit. |
| AC-18 | Система повинна (shall) обчислювати `citation_accuracy` кейса як частку знахідок, що пережили grounding gate, від усіх знахідок, які видала модель, і рахувати його рівним 1, коли модель не видала жодної. | clear | Крок 3 + unit. Знаменник дає крок 8 (`raw_count`). |
| AC-19 | Система повинна (shall) вважати кейс пройденим (`pass`) тоді й лише тоді, коли `recall` і `precision` цього кейса дорівнюють 1. | clear | Крок 3 (правило) + крок 8 (персист у `eval_runs.pass`). |
| AC-20 | ЯКЩО кейс має `expected_output.findings: []` і агент видав хоч одну знахідку, ТОДІ `precision` цього кейса повинен (shall) дорівнювати 0, а кейс — бути непройденим. | clear | Крок 3: випливає з AC-17 (0 зарахованих / N вцілілих). Окремий unit-кейс, бо це та комбінація, яку «повертати 1 при нульовому знаменнику» легко зламає. |
| AC-21 | Система повинна (shall) обчислювати всі три метрики і `pass` виключно кодом: у скорингу немає жодного виклику LLM. | clear | Крок 3 (`scoring.ts` не імпортує ні контейнер, ні провайдера) + крок 15 (лічильник викликів мока = кількість кейсів; мокаються **всі** провайдери — INSIGHTS server#2026-08-11). |
| AC-22 | КОЛИ прогін набору стартує, система повинна (shall) зберегти для кожного рядка `eval_runs` спільний ідентифікатор пакета прогону і версію агента (`agents.version`) на момент старту, і віддавати обидва поля на дроті. | clear | Кроки 2 (`batch_id`, `agent_version`), 1 (обидві копії `EvalRunRecord`), 8 (запис), 9 (віддача). Це і є контрактний gap зі спеки. |
| AC-23 | ЯКЩО набір агента порожній, ТОДІ прогін повинен (shall) відмовити з поясненням і не зробити жодного виклику моделі. | clear | Крок 8: перевірка **до** резолву провайдера; крок 15 — нуль викликів мока. |
| AC-24 | ЯКЩО ключ LLM-провайдера агента не налаштований (роут відповідає 409), ТОДІ система повинна (shall) вимкнути кнопки прогону й показати те саме пояснення, що вкладка `Evals` скіла, не повторюючи запитів, які не можуть удатися. | clear | Той самий `ConfigError` → 409 (`platform/errors.ts:49-59`); кроки 6 (хук піднімає код), 11 і 13 (стан кнопок за зразком `EvalsTab.tsx:40-42,107-111`). |
| AC-25 | ЯКЩО прогін одного кейса впав (помилка провайдера, таймаут, порожній `input_diff`), ТОДІ система повинна (shall) прогнати решту кейсів, позначити цей кейс як помилковий із причиною і виключити його з агрегатів, а не завалити весь прогін. | clear | Крок 8. Форма помилкового рядка (`pass = null`, метрики `null`, `actual_output.error`) зафіксована в **Contract & migration impact** — саме той різновидний випадок, який два лейни інакше реалізують по-різному. |
| AC-26 | Система повинна (shall) показувати в сайдбарі, у секції `SKILLS LAB`, пункт `Eval Dashboard`, що веде на `/eval`, де перелічені всі агенти з непорожнім набором: назва, модель, дата й версія останнього прогону, `X/Y pass` і три метрики. | out of reach (частково) → розвʼязано | Пункт сайдбара живе у `client/src/vendor/ui/nav.ts`, який `.claude/settings.json:9-12` забороняє і агентові, і головній сесії (INSIGHTS root#2026-08-18). Крок 14 — **людина**, з `Vendor-update:` у тілі PR. Решта AC (сторінка `/eval`) — кроки 9 і 13. План не оминає заборону. |
| AC-27 | Система повинна (shall) показувати на `/eval` таблицю останніх прогонів **усіх агентів**, найновіші згори, з агентом, часом, версією, трьома метриками і `X/Y pass`. | clear | Кроки 9 (`GET /eval/overview`), 13. Рядок таблиці — **пакет** прогону, не кейс (див. **Contract & migration impact**). |
| AC-28 | Система повинна (shall) обмежувати Eval Dashboard кейсами й прогонами з `owner_kind = "agent"`; кейси, що належать скілам, на цих екранах не показуються. | clear | Фільтр у репозиторії (крок 5), не в UI. Крок 15 доводить це на сідовому skill-кейсі `stripe-key-leak` (`db/seed.ts:790-815`). |
| AC-29 | ПОКИ жоден прогін ще не зроблено, система повинна (shall) показувати на `/eval` і на сторінці агента порожній стан із поясненням, а не нулі метрик. | clear | Кроки 9 (агрегати → `null`, не 0) і 13 (ключ `dashboard.noRuns`). |
| AC-30 | Система повинна (shall) показувати на сторінці агента в Eval Dashboard: три картки метрик із дельтою до попереднього прогону, графік тренду по прогонах і таблицю прогонів (час, версія, три метрики, `X/Y pass`, вартість). | clear | Кроки 9 (`current`/`delta`/`trend`/`recent_batches`), 13. |
| AC-31 | ЯКЩО precision або recall останнього прогону впав відносно попереднього більше ніж на поріг регресії, ТОДІ система повинна (shall) показати над метриками банер із назвою метрики, величиною падіння в процентних пунктах і напрямом решти метрик. | clear (поріг — default-assumed) | Поріг **2 п.п.** — дефолт відкритого питання спеки. Живе константою в `modules/eval/constants.ts` (крок 3), обчислюється сервером у структурний `alert` (крок 9), рендериться з `messages/en/eval.json` (кроки 4, 13). |
| AC-32 | ПОКИ в таблиці прогонів обрано рівно два рядки, кнопка `Compare` повинна (shall) бути активною; за будь-якої іншої кількості — вимкненою. | clear | Крок 13, чистий стан таблиці; RTL на 0/1/2/3. |
| AC-33 | КОЛИ користувач натискає `Compare` на двох обраних прогонах, система повинна (shall) показати модалку з дельтою кожної з трьох метрик і вартості у процентних пунктах зі знаком (включно з нульовою дельтою) і diff системного промпта між версіями агента цих прогонів. | clear | Крок 13. **Нового роуту не треба**: метрики вже в рядках таблиці, промпти — наявним `GET /agents/:id/versions/:version` (`agents/routes.ts:134-143`). Нульова дельта рендериться як `0.0 pt`. |
| AC-34 | ЯКЩО знімок конфігу для версії агента одного з обраних прогонів відсутній у `agent_versions`, ТОДІ модалка повинна (shall) показати дельти метрик і явне пояснення, що diff промпта недоступний, замість порожнього блоку. | clear | 404 з того ж роуту → деградований блок (крок 13); крок 15 перевіряє 404 на видаленому знімку. |
| AC-35 | Система повинна (shall) надавати команду `pnpm verify:l06`, яка проганяє лейни `frontend`, `backend` і `integration` через `node scripts/verify.mjs` і завершується ненульовим кодом, якщо хоч один гейт червоний. | conflicts (human-answered) | Суперечить `AGENTS.md` → Conventions «Installing at the repo root does nothing». Людина обрала кореневий `package.json` (Q2). Крок 4 його додає (`private`, без `dependencies`, з `packageManager`), крок 16 виправляє рядок у `AGENTS.md`. Механіка exit-коду вже є: `scripts/verify.mjs:163-165`. |
| Edge · § Edge cases | **Знахідка без рішення** → дія вимкнена з підказкою, запиту немає. | clear | AC-2, крок 12. |
| Edge · § Edge cases | **Знахідка з рішенням, але без патча файлу** → відмова з поясненням, кейс не створюється. | clear | AC-5, кроки 7, 15. |
| Edge · § Edge cases | **Той самий `Turn into eval case` двічі поспіль** → другий клік відкриває наявний кейс, дубля немає. | clear | AC-6, кроки 2, 7, 10. |
| Edge · § Edge cases | **Знахідку видалено разом із рев'ю після створення кейса** → кейс лишається валідним. | conflicts → розвʼязано | Суперечить командному рішенню `onion-architecture` «нові FK — `ON DELETE RESTRICT`». Розвʼязано усуненням причини: `source_finding_id` — колонка **без** FK (крок 2). |
| Edge · § Edge cases | **Порожній набір кейсів** → прогін відмовляє без виклику моделі; вкладка показує порожній стан. | clear | AC-8, AC-23; кроки 8, 11. |
| Edge · § Edge cases | **Немає ключа провайдера** → кнопки прогону вимкнені, пояснення показане один раз. | clear | AC-24; кроки 6, 11, 13. |
| Edge · § Edge cases | **Один кейс упав, решта пройшли** → часткова деградація з причиною, агрегати рахуються по решті. | clear | AC-25, крок 8. |
| Edge · § Edge cases | **Прогін триває, користувач тисне «Run» вдруге** → друге натискання ігнорується, поки прогін не завершився. | clear | Кроки 11, 13 — той самий предикат, що `EvalsTab.tsx:96`. |
| Edge · § Edge cases | **Користувач іде зі сторінки під час прогону** → прогін завершується на сервері й з'являється в історії при поверненні. | clear | Прогін синхронний у хендлері й персистить рядки до відповіді (крок 8); історія читається з БД (крок 9). Клієнт нічого не тримає в памʼяті. |
| Edge · § Edge cases | **Модель не видала жодної знахідки на `must_find`-кейсі** → recall 0, precision 1, кейс непройдений. | clear | Крок 3, unit. |
| Edge · § Edge cases | **Модель видала знахідки, з яких grounding gate не пропустив жодної** → citation_accuracy 0, precision рахується по нулю вцілілих (= 1), кейс непройдений через recall. | clear | Крок 3, unit — і саме цей кейс фіксує, що знаменник precision — **вцілілі**, а не сирі. |
| Edge · § Edge cases | **`expected_output` збережено в формі, якої скорер не розуміє** → кейс скорується як «очікувань немає» і показується як непройдений із поясненням, роут не 500-ить. | clear | Крок 3: `safeParse` → `[]`, як `expectedFindings` у скілах (`skills/helpers.ts:137-140`). |
| Edge · § Edge cases | **Порожня БД, жодного прогону** → порожній стан замість нулів. | clear | AC-29; кроки 9, 13. |
| Edge · § Edge cases | **У воркспейсі є skill-кейси (сід)** → вони не потрапляють у Eval Dashboard. | clear | AC-28; кроки 5, 15. |
| Edge · § Edge cases | **Дельта нульова (метрики не зрушили)** → модалка показує `0.0 pt`, а не порожнє місце. | clear | AC-33; крок 13. |
| Edge · § Edge cases | **Ім'я кейса з розміткою або дуже довге** → рендериться екранованим і обрізається візуально. | clear | Кроки 11, 13 — текстові вузли React, без `dangerouslySetInnerHTML` і без `Markdown` на іменах/заголовках. |
| Edge · § Edge cases | **Кейс `must_find` зі знахідки про витік секрету** → діфф-фрагмент із літералом секрету копіюється в `eval_cases.input_diff`; він не логується й не виходить за межі локальної БД. | clear | Кроки 7, 8: `input_diff` не потрапляє в жоден `log`/`errSummary` і не додається в текст помилки AC-5. |
| NFR · § Non-functional requirements | **Вартість і побічні ефекти** — один прогін набору = рівно один виклик агента на кейс і жодного виклику в скорингу; прогін ніколи не стартує сам. | clear | Кроки 3, 8; кроки 11 і 13 не мають `useEffect`, що запускає прогін. Крок 15 рахує виклики. |
| NFR · § Non-functional requirements | **Тестові лейни** — прогін витрачає гроші, тому e2e-флоу його не торкається; усе, що вимагає моделі, перевіряється в `*.it.test.ts` з провайдером, підміненим через слот контейнера. | clear | Крок 15 — `server/test/eval.it.test.ts` з `ContainerOverrides.llm`. e2e не додається — див. **Out of scope**. |
| NFR · § Non-functional requirements | **Local-first** — прогін і скоринг читають лише локальну Postgres; жодного звернення до GitHub чи клону в момент прогону. | clear | AC-13; кроки 8, 15. |
| NFR · § Non-functional requirements | **Контракти** — усе, що перетинає дріт, лишається Zod-контрактом у `server/src/vendor/shared` і дзеркалиться в `client/src/vendor/shared`; нові поля прогону додаються в **обидві** копії. | clear | Крок 1 — один крок, обидва файли; ніколи не два кроки. |
| NFR · § Non-functional requirements | **Міграції** — нові колонки `eval_runs` додаються окремою міграцією, лише адитивно; наявні `src/db/migrations/**` не редагуються. | clear | Крок 2, через `pnpm db:generate` (хендрайт заборонений `settings.json:8`). |
| NFR · § Non-functional requirements | **Секрети** — ключі провайдерів лишаються в `~/.devdigest/secrets.json` / `process.env` і не потрапляють ні в `eval_cases`, ні в `eval_runs`, ні на дріт. | clear | Ключі й далі резолвляться через `container.llm()`; жоден новий контракт (крок 1) не має поля ключа. |
| NFR · § Non-functional requirements | **Продуктивність** — читання ≤ 300 мс на воркспейс із ≤ 50 прогонів; прогін довгий, тому UI показує `running` і не блокує сторінку. | untestable як написано | Дефолт (найвужче перевірне прочитання, заявлене): читання — чисті запити до локальної Postgres з індексом по `(batch_id)` і `(case_id, ran_at)` (крок 2), **без N+1** — це те, що перевіряє рев'ю й integration-тест; числа 300 мс план не вимірює. Порогового тесту немає — див. **Open questions**. |
| NFR · § Non-functional requirements | **Спостережуваність** — кожен прогін лишає рядок `eval_runs` з тривалістю, вартістю й версією агента; нових логів недовіреного тексту не додається. | clear | Кроки 2, 8. |
| NFR · § Non-functional requirements | **Доступність** — вимкнена кнопка несе текстову причину (не лише візуальний стан), а напрям дельти передається знаком і стрілкою, не самим кольором. | clear | Кроки 12 (кнопка), 13 (дельти) + RTL-перевірка на доступне імʼя/опис. |
| NFR · § Non-functional requirements | **i18n** — у репозиторії є лише локаль `en`; нові рядки беруться з наявних ключів `client/messages/en/eval.json` і не хардкодяться в компонентах. | clear | Крок 4 додає бракуючі ключі **до** наявних файлів; кроки 11–13 читають лише через `useTranslations`. Саме тому `EvalDashboard.alert` перестає бути готовим англійським рядком (крок 1). |
| Untrusted · § Untrusted inputs | Діфф-фрагмент кейса, знахідки прогону, імʼя/нотатки кейса, system prompt у модалці порівняння — екранований текст, ніколи не розмітка й ніколи не інструкція; у промпт агента діфф іде лише обгорнутим спільним `INJECTION_GUARD`/`wrapUntrusted`. | clear | Кроки 8 (обгортка — та сама, що в рев'ю), 11, 13. Окремого сканування ключових слів не додається (спека це прямо виключає). |

## Decisions taken

Інтерв'ю в цьому прогоні **не проводилось**: режим виконання названо в делегації,
а всі відкриті питання спеки мають дефолти, які я беру як свої.

- **Режим виконання: multi-agent** (ланцюг `/implement`, оркеструє головна
  сесія) — *human-answered*, дослівно з делегації: «використай всі можливості
  харнесу які ми маємо, розпаралель роботу по сабагентах де це можливо».
- **Паралелізм за file ownership, з Ownership-таблицею та обовʼязковим
  інтеграційним кроком** — *human-answered* (та сама фраза + пряме посилання на
  INSIGHTS 2026-08-04).
- **`must_not_flag` = строго порожнє очікування `[]`** — *human-answered*
  (інтерв'ю spec-creator, Q1; закріплено в AC-4 і AC-20).
- **`pnpm verify:l06` = новий кореневий `package.json` лише зі скриптами, що
  делегує в `node scripts/verify.mjs` зі слайсами `frontend`+`backend`+
  `integration`** — *human-answered* (Q2; AC-35).
- **Eval Dashboard — лише агенти (`owner_kind='agent'`)** — *human-answered*
  (Q3; AC-28).
- **Кнопка «Turn into eval case» без рішення — вимкнена з підказкою** —
  *human-answered* (Q4; AC-2).
- **Поріг регресії для банера — падіння `precision` або `recall` на ≥ 2 п.п.** —
  *default-assumed* (дефолт відкритого питання спеки).
- **«Видимий рух» метрик для здачі L06 — ≥ 5 п.п. за `recall` або `precision`;
  модалка показує будь-яку дельту, включно з нульовою** — *default-assumed*
  (дефолт спеки).
- **≥ 8 кейсів набору робляться вручну одним кліком; сідер не змінюється** —
  *default-assumed* (дефолт спеки). Наслідок: наповнення набору й два прогони —
  крок людини, не крок плану (**Out of scope**).
- **`Run all agents`, `Promote v7`, фільтр `30 days`, g-чорд для `Eval
  Dashboard` — поза обсягом** — *default-assumed* (дефолти спеки).
- **Ім'я роуту прогону — `POST /agents/:id/eval-runs`, не допродуктовий
  `POST /agents/:id/eval/run-all`** — *human-answered* (зафіксовано в Design
  review спеки).
- **`test-writer` рядків не отримує** — *default-assumed*. `/implement` жене
  фіксований ланцюг і `test-writer` у ньому немає (`AGENTS.md` → Use when), тож
  рядок для нього був би мертвим. Тести живуть у клітинці **Verification**
  свого implementer-рядка. Див. **Recommendations** R2.

## Recommendations

Порада, не рішення. `plan-verifier` цих рядків не оцінює.

- **R1 — кореневий `package.json` пінить pnpm і закривається від інсталяції.**
  Чому: `AGENTS.md` обіцяє, що корінь нічого не встановлює, а INSIGHTS
  root#2026-08-05 показує, що без піна corepack ставить pnpm 11, який фатально
  падає на нетриажених build-скриптах. Якщо прийнято: крок 4 додає
  `"private": true`, `"packageManager": "pnpm@10.34.5"` і **жодних**
  `dependencies`/`devDependencies`, а `pnpm-workspace.yaml` у корені не
  зʼявляється. Default: as requested. *(Рекомендація дешева і безризикова —
  крок 4 написаний уже з нею; якщо людина проти, з нього прибираються два
  поля.)*
- **R2 — після зеленого ланцюга прогнати `test-writer` вручну по кроках 11–13.**
  Чому: три клієнтські лейни несуть 14 RTL-критеріїв, і `test-writer` знятий з
  дефолтного ланцюга через токен-бюджет (`AGENTS.md` → Use when). Якщо
  прийнято: додається один ручний прохід після стадії 4 `/implement`, план не
  змінюється. Default: as requested — тести пише кожен implementer у своєму
  рядку.
- **R3 — повернути AC-1 у `spec-creator` на правку.** Чому: критерій називає дії
  `Learn` і `Reply to author`, яких у `FindingCard.tsx:91-112` (локатор із самого
  критерію) не існує. Якщо прийнято: AC-1 переписується під наявний ряд
  `Accept`/`Dismiss`, план не змінюється — крок 12 уже планується під репозиторій.
  Default: as requested.
- **R4 — не узагальнювати скіловий `EvalsTab`/`EvalCaseModal` під два власники.**
  Чому: спека прямо тримає два скорери окремо (Non-goals), а спільний компонент
  зробив би скіловий шлях залежним від агентського контракту. Якщо прийнято:
  кроки 11 і 13 **копіюють** структуру, а не витягують спільного предка; це вже
  так заплановано. Default: as requested.
- **R5 — model-free e2e-флоу на порожній стан `/eval`.** Чому: `/eval` без
  прогонів не викликає модель, а `e2e/specs/11-onboarding-tour.flow.json` —
  готовий прецедент такого «стану, досяжного без генерації» (INSIGHTS
  root#2026-08-20). Якщо прийнято: додається один `e2e/specs/13-eval-dashboard.
  flow.json` і рядок у **Steps**. Default: as requested — спека e2e не просить.

## Constraints that bind this change

Чек-лист DevDigest, відповіді явні. «Не зачіпає» — теж відповідь.

- **Чи щось перетинає дріт?** Так. `@devdigest/shared` рухається в **обох**
  копіях одним кроком 1: `server/src/vendor/shared/contracts/{eval-ci,knowledge}.ts`
  і `client/src/vendor/shared/contracts/{eval-ci,knowledge}.ts`. Ніколи не двома
  кроками, які можуть роз'їхатись між лейнами.
- **Контракти Zod-first.** Так. Одна схема валідує запит і серіалізує відповідь;
  `params`/`body`/`querystring` оголошуються **на роуті** (крок 10,
  `withTypeProvider<ZodTypeProvider>` як у `agents/routes.ts:70-71`). Допродуктовий
  `eval/routes.ts` робив `ListQuery.parse(req.query)` у хендлері — його **не**
  копіювати.
- **Міграції.** Потрібна одна нова, суто адитивна: `eval_runs` +`batch_id`,
  +`agent_version`, +`error_reason`; `eval_cases` +`source_finding_id`; два
  індекси. Створюється **лише** `cd server && pnpm db:generate`
  (`Write(./server/src/db/migrations/*.sql)` заборонений — `settings.json:8`),
  застосовується `cd server && pnpm db:migrate` (не на бутi). Наявні `.sql` не
  редагуються. Оскільки дифф лише додає, інтерактивного промпта drizzle-kit не
  буде (INSIGHTS root#2026-08-05).
  **Нових foreign key не додається.** `source_finding_id` — `uuid` без
  `references()`: командне рішення `onion-architecture` вимагає для нових FK
  `ON DELETE RESTRICT`, а це заблокувало б видалення знахідки/рев'ю, чого
  edge case спеки прямо не хоче. Колонка — провенанс, а не звʼязок; кейс тримає
  **копію** діффа й очікування. Каскад `eval_runs.case_id → eval_cases` уже
  існує і не переписується.
- **Тестовий лейн.** DB-backed тести — `server/test/eval.it.test.ts` (крок 15).
  Чистий скорер — `server/test/eval-scoring.test.ts` (unit, крок 3). Клієнт —
  `*.test.tsx` поруч із компонентом і `client/src/lib/hooks/eval.test.tsx`
  (INSIGHTS client#2026-08-20: хук, витягнутий у `lib/hooks/*`, випадає з
  роутових сюїт).
- **Пакетний менеджер по кроках.** `server/`, `client/` → **pnpm**. `reviewer-core/`,
  `e2e/`, `mcp/` цією зміною не зачіпаються. Кореневий `package.json` (крок 4)
  не має залежностей і нічого не встановлює — `pnpm verify:l06` лише запускає
  `node`.
- **`reviewer-core` не емітить JS.** Не зачіпає: пакет не змінюється. Grounding
  береться через `server/src/platform/grounding.ts` — той самий шлях, яким іде
  звичайне рев'ю.
- **Do-not-touch шляхи.** Зачіпається один: `client/src/vendor/ui/nav.ts`
  (AC-26). План каже **не** робити це агентом і не оминати deny — крок 14
  віддається людині, з `Vendor-update: client/src/vendor/ui/nav.ts` у тілі PR
  (`routing.md:82-97`). `server/clones/**` і застосовані `.sql` не чіпаються.
- **Шарування.** Зачіпається: додається модуль `server/src/modules/eval/`.
  Межі — `server/.dependency-cruiser.cjs`, лейн `typecheck` у
  `server-unit.yml`. Шар за шаром: `routes.ts` (Fastify+Zod) → `service.ts` /
  `runner.ts` / `dashboard.ts` (беруть `Container`, **не** `FastifyRequest`,
  навіть як тип) → `repository.ts` (єдине місце SQL цього модуля, кожен запит
  скоупиться `workspaceId`) → `scoring.ts`/`helpers.ts` (чисті, без контейнера).
  **Нового порту й нового геттера контейнера не треба**: `container.agentsRepo`
  і `container.reviewRepo` вже існують саме для цього. Тестова стійка — той
  самий контейнер: `new Container(config, db, { llm: { … } })`, а не `vi.mock`.
  Чужі таблиці (`findings`, `pr_files`, `agents`, `agent_versions`) читаються
  **лише** через ці два репозиторії — inline-запит по них через `container.db`
  проходить depcruise і все одно є порушенням (`onion-architecture`, Blind
  spots §4).

## Steps

| # | Change | Files / seams | Slice | Satisfies | Depends on | Executor | Skills the executor applies | Verification |
|---|--------|---------------|-------|-----------|------------|----------|-----------------------------|--------------|
| 1 | Контракти прогону й дашборда — в **обох** копіях `@devdigest/shared` одним кроком: нові `EvalCaseResult`, `EvalBatchRecord`, `AgentEvalBatch`, `EvalAlert`, `EvalAgentSummary`, `EvalDashboardOverview`; `EvalRunRecord` +`batch_id` +`agent_version` +`error`; `EvalCase`/`EvalCaseInput` +`source_finding_id`; `EvalDashboard.alert` зі стрічки на структуру + `recent_batches`. Форми — у **Contract & migration impact** | `server/src/vendor/shared/contracts/eval-ci.ts`, `server/src/vendor/shared/contracts/knowledge.ts`, `client/src/vendor/shared/contracts/eval-ci.ts`, `client/src/vendor/shared/contracts/knowledge.ts` | contracts (backend + frontend) | AC-12, AC-22, AC-25, AC-27, AC-30, AC-31 | — | `implementer` | `zod` | `node scripts/verify.mjs --slice backend --slice frontend` |
| 2 | Адитивна міграція: `eval_runs` +`batch_id uuid` +`agent_version integer` +`error_reason text`; `eval_cases` +`source_finding_id uuid` (**без** FK); індекс по `eval_runs(batch_id)` і частковий унікальний по `eval_cases(owner_id, source_finding_id) WHERE source_finding_id IS NOT NULL` | `server/src/db/schema/eval.ts`; згенерований `server/src/db/migrations/00NN_*.sql` + `meta/` — **тільки** через `cd server && pnpm db:generate` | backend | AC-6, AC-11, AC-22, NFR Міграції, NFR Продуктивність | — | `implementer` | `drizzle-orm-patterns`, `postgresql-table-design` | `cd server && pnpm db:generate` (без інтерактивного промпта) → `cd server && pnpm db:migrate` → `node scripts/verify.mjs --slice backend` |
| 3 | Чистий скорер і константи модуля: збіг **лише** за нормалізованим шляхом + перетином рядків, кожна фактична знахідка зараховується не більше разу; `recall`/`precision`/`citation_accuracy` з правилами нульового знаменника; `pass ⟺ recall = 1 ∧ precision = 1`; `expectedFindings` через `safeParse` → `[]`; `REGRESSION_THRESHOLD_PP = 2`. **Не** копіювати `findingMatches` із `15fa391^` — там збіг ще й за заголовком і severity/category, що порушує AC-15 | `server/src/modules/eval/scoring.ts`, `server/src/modules/eval/helpers.ts`, `server/src/modules/eval/constants.ts`, `server/test/eval-scoring.test.ts` | backend | AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-31 | — | `implementer` | — (чисті функції; за `onion-architecture` їм не потрібен контейнер) | `node scripts/verify.mjs --slice backend --only eval-scoring` |
| 4 | Кореневий `package.json` **лише зі скриптами** (`private`, `packageManager: pnpm@10.34.5`, без залежностей): `verify:l06` → `node scripts/verify.mjs --slice frontend --slice backend --slice integration`. Плюс бракуючі ключі i18n у наявні файли (порожні стани, банер регресії, `Turn into eval case` + причина, дельти, compare-модалка, помилковий кейс) | `package.json` (новий), `client/messages/en/eval.json`, `client/messages/en/agents.json` | meta + frontend | AC-35, AC-2, AC-8, AC-24, AC-25, AC-29, AC-31, AC-33, NFR i18n | — | `implementer` | — (`meta`); `frontend-ui-architecture` для файлів `messages/**` | `pnpm verify:l06 --help`-еквівалент не існує → перевірка: `node scripts/verify.mjs --slice frontend`, і що `pnpm verify:l06` стартує й повертає код `scripts/verify.mjs` |
| 5 | `repository.ts` модуля `eval`: CRUD `eval_cases` зі скоупом `workspaceId`; вибірка кейсів за `(owner_kind='agent', owner_id)`; lookup за `source_finding_id`; вставка рядків `eval_runs` пакетом; читання пакетів (найновіші згори) для одного агента й для всіх; **фільтр `owner_kind='agent'` живе тут**, не в UI | `server/src/modules/eval/repository.ts`, `server/src/modules/eval/types.ts` | backend | AC-6, AC-11, AC-22, AC-27, AC-28 | 1, 2 | `implementer` | `onion-architecture`, `drizzle-orm-patterns` | `node scripts/verify.mjs --slice backend` |
| 6 | Клієнтські хуки eval: список/CRUD кейсів, створення кейса зі знахідки (обробка **201 vs 200** — AC-6), запуск пакета, overview і dashboard, підняття коду **409** до компонента. Плюс хуковий тест — інакше логіка випаде з усіх сюїт (INSIGHTS client#2026-08-20) | `client/src/lib/hooks/eval.ts`, `client/src/lib/hooks/eval.test.tsx`, `client/src/lib/hooks/index.ts` | frontend | AC-6, AC-9, AC-12, AC-24, AC-26, AC-27, AC-30 | 1, 4 | `implementer` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library` | `node scripts/verify.mjs --slice frontend` |
| 7 | `service.ts` модуля `eval`: CRUD кейсів + **створення кейса зі знахідки**. `container.reviewRepo.findingContext(id)` → `{finding, review, pull}`; власник — `review.agentId`; `input_diff` — `pr_files.patch` для `finding.file` (порожній / відсутній рядок → `AppError` 422 з текстом без діффа); `accepted` → одне очікування, `dismissed` → `[]` + довідка в `notes`; повторний виклик повертає наявний кейс | `server/src/modules/eval/service.ts` | backend | AC-3, AC-4, AC-5, AC-6, AC-10, AC-11, AC-28 | 5 | `implementer` | `onion-architecture`, `zod` | `node scripts/verify.mjs --slice backend` |
| 8 | `runner.ts` модуля `eval`: прогін пакета. Один `batch_id` і `agents.version` на старті; послідовно по кейсах (як `skills/service.ts:311-313`); вхід — **тільки** збережені поля кейса; промпт — system prompt агента + тіла звʼязаних скілів через `container.agentsRepo.linkedSkills`, недовірений діфф в обгортці `INJECTION_GUARD`/`wrapUntrusted`; `parseUnifiedDiff` + `groundFindings` з `platform/grounding.ts`, `raw_count`/`grounded_count` в `actual_output`; порожній набір → відмова **до** резолву провайдера; збій одного кейса → `error_reason`, `pass = null`, метрики `null`, решта біжить | `server/src/modules/eval/runner.ts` | backend | AC-12, AC-13, AC-14, AC-19, AC-20, AC-21, AC-22, AC-23, AC-25, NFR Вартість, NFR Local-first, NFR Секрети | 3, 5 | `implementer` | `onion-architecture` | `node scripts/verify.mjs --slice backend` |
| 9 | `dashboard.ts` модуля `eval`: overview (агенти з непорожнім набором + останні пакети всіх агентів) і dashboard одного агента (`current`, `delta`, `trend`, `recent_batches`, `recent_runs`, структурний `alert` за порогом 2 п.п.). Без прогонів — `null`-агрегати, не нулі. Помилкові кейси не входять в агрегати | `server/src/modules/eval/dashboard.ts` | backend | AC-9, AC-25, AC-26, AC-27, AC-28, AC-29, AC-30, AC-31 | 5 | `implementer` | `onion-architecture`, `drizzle-orm-patterns` | `node scripts/verify.mjs --slice backend` |
| 10 | `routes.ts` модуля `eval` + реєстрація: `GET/POST /eval-cases`, `GET/PUT/DELETE /eval-cases/:id`, `POST /findings/:id/eval-case` (**201** створено / **200** наявний), `POST /agents/:id/eval-runs`, `GET /eval/overview`, `GET /eval/dashboard`. Zod `params`/`body`/`querystring` **на роуті**, статуси через `AppError` — допродуктовий `parse(req.query)` у хендлері не копіювати. Один запис у реєстрі модулів | `server/src/modules/eval/routes.ts`, `server/src/modules/index.ts` | backend | AC-3, AC-5, AC-6, AC-10, AC-11, AC-12, AC-23, AC-24, AC-28, AC-34 | 7, 8, 9 | `implementer` | `onion-architecture`, `fastify-best-practices`, `zod` | `node scripts/verify.mjs --slice backend` |
| 11 | Вкладка `Evals` редактора агента: рядок у `TABS`, список кейсів (імʼя, тип очікування, статус останнього прогону, «пройдено з усіх»), порожній стан із CTA, секція метрик останнього прогону + лінк на `/eval/<agentId>`, модалка редактора кейса з валідністю JSON, підтвердження видалення, кнопки прогону вимкнені на 409 і на `running`. Структуру копіюємо зі скілового `EvalsTab`, спільного предка **не** витягуємо | `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`, `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/**` (+ `EvalCaseModal/**`), `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx` | frontend | AC-7, AC-8, AC-9, AC-10, AC-11, AC-24 | 6 | `implementer` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library` | `node scripts/verify.mjs --slice frontend` |
| 12 | Дія `Turn into eval case` на картці знахідки: третя кнопка в наявному ряду дій; активна лише за наявності рішення, інакше `disabled` з **текстовою** причиною; успіх → відкриття кейса (і на 201, і на 200); відмова через відсутній патч → тост із поясненням | `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/**`, `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx` | frontend | AC-1, AC-2, AC-5, AC-6, NFR Доступність | 6 | `implementer` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library` | `node scripts/verify.mjs --slice frontend` |
| 13 | Сторінки Eval Dashboard: `/eval` (картки агентів + таблиця останніх пакетів усіх агентів, порожній стан) і `/eval/[agentId]` (три картки з дельтою, банер регресії, графік тренду, таблиця пакетів із мультивибором, `Compare` активний **рівно** на двох, модалка порівняння з дельтами `±X.X pt` включно з `0.0 pt` і diff системного промпта через наявний `GET /agents/:id/versions/:version`, 404 → пояснення замість порожнього блоку) | `client/src/app/eval/page.tsx`, `client/src/app/eval/[agentId]/page.tsx`, `client/src/app/eval/_components/**` | frontend | AC-26, AC-27, AC-29, AC-30, AC-31, AC-32, AC-33, AC-34, NFR Доступність | 6 | `implementer` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library` | `node scripts/verify.mjs --slice frontend` |
| 14 | Рядок `Eval Dashboard` у `NAV`, секція `SKILLS LAB`, останнім (після `Agents`), `href: "/eval"`, **без** g-чорда — `SHORTCUTS` не змінюється. `activeKeyFor` і `shell.json` `nav.eval` уже готові, бракує лише рядка | `client/src/vendor/ui/nav.ts` | frontend (vendored — виключений з рев'ю, крім декларації) | AC-26 | — | **людина** (не `implementer` і не `main session`: `.claude/settings.json:9-12` denyʼїть `Edit`/`Write` обом — INSIGHTS root#2026-08-18) | — | пункт зʼявився в сайдбарі; `Vendor-update: client/src/vendor/ui/nav.ts` у тілі PR приймається `node scripts/pr-gate-ci.mjs` |
| 15 | **Інтеграційний прохід** — окремий крок після паралельних хвиль, бо unit-тести по обидва боки шва завжди згодні самі з собою (INSIGHTS root#2026-08-04). `server/test/eval.it.test.ts` з провайдером через `ContainerOverrides.llm` (мокати **всі** провайдери — INSIGHTS server#2026-08-11): кейс із прийнятої/відхиленої знахідки, відмова без патча (обидва шляхи), подвійний клік → 200 і один рядок, видалення кейса забирає прогони, пакет пише `batch_id`+`agent_version`, нуль викликів моделі на порожньому наборі, лічильник викликів = кількість кейсів, один збійний кейс не валить пакет, skill-кейс сіда не потрапляє в overview, 404 знімка версії. **Плюс кожен міжлейновий шов:** роут, який кличе хук кроку 6, існує з тим самим методом і шляхом; форма, яку читає крок 13, — це те, що емітить крок 9; форма `expected_output`, яку пише крок 7, — це те, що читає крок 3 | `server/test/eval.it.test.ts`, точкові правки в кроках 6–13 за знайденими розбіжностями | backend + integration | AC-3, AC-4, AC-5, AC-6, AC-11, AC-12, AC-13, AC-14, AC-19, AC-21, AC-22, AC-23, AC-25, AC-28, AC-34 | 10, 11, 12, 13 | `implementer` | `onion-architecture` | `cd server && pnpm db:migrate` → `node scripts/verify.mjs --slice integration` → `node scripts/verify.mjs --slice backend --slice frontend` |
| 16 | Документація: рядок у кореневому `AGENTS.md` про те, що корінь тепер має `package.json` **лише зі скриптами** і що `pnpm verify:l06` — точка входу L06 (без цього конвенція «Installing at the repo root does nothing» суперечить репозиторію); карта роутів у `server/README.md`; маршрути `/eval` у `client/README.md` | `AGENTS.md`, `server/README.md`, `client/README.md` | meta | AC-35 (риштування) | 15 | `doc-writer` | — (`meta`) | `node scripts/check-specs.mjs`; перечитуванням. **Увага:** правка кореневого `AGENTS.md` вмикає платний workflow-тир `.github/workflows/evals.yml` — див. **Risks** |

## Execution

Режим — **multi-agent**. Оркеструє головна сесія через `/implement
.claude/plans/l06-evals-eval-pipeline.md`; коміт між стадіями — її, не агента.
Хвилі й лейни нижче — те, що `/implement` побудує з колонки **Depends on** і
таблиці **Ownership**; вони наведені явно, щоб гейт «Run with this split?» було
з чим звірити.

| Хвиля | Лейни | Кроки | Чому саме так |
|---|---|---|---|
| 1 | 4 | 1 · 2 · 3 · 4 | Чотири незалежні корені: дріт, схема, чиста математика, meta+i18n. Жодних спільних шляхів. |
| 2 | 2 | 5 · 6 | Репозиторій чекає на схему й контракти; клієнтські хуки — лише на контракти й ключі i18n. |
| 3 | 3 | 7 · 8 · 9 | Три **окремі файли** одного модуля — тому три лейни, а не один. Ділимо за файлом, не за концерном. |
| 4 | 3 | 10 · 11 · 12 | `routes.ts` збирає сервісний бік; дві клієнтські поверхні незалежні одна від одної й від роутів (говорять через хуки кроку 6). |
| 5 | 1 | 13 | Найбільша клієнтська поверхня — своя хвиля, щоб лейн лишався коротким. |
| — | поза чергою | 14 | Крок людини. Може бути зроблений будь-коли до стадії 6 `/implement`; **у лейн агента не ставиться** — deny не оминається. Головна сесія має зупинитись і попросити, а не спробувати. |
| 6 | 1 | 15 | Інтеграційний прохід. Стартує лише коли кожен лейн хвиль 4–5 відзвітував `Steps: N/N`. |
| 7 | 1 | 16 | Стадія docs `/implement`. |

### Ownership

Кожен шлях належить рівно одному лейну своєї хвилі. «Не чіпати» — це шляхи
інших лейнів **тієї самої** хвилі.

| Хвиля | Лейн | Кроки | Володіє | Не чіпає |
|---|---|---|---|---|
| 1 | W1-A | 1 | `server/src/vendor/shared/contracts/eval-ci.ts`, `server/src/vendor/shared/contracts/knowledge.ts`, `client/src/vendor/shared/contracts/eval-ci.ts`, `client/src/vendor/shared/contracts/knowledge.ts` | `server/src/db/**`, `server/src/modules/eval/**`, `package.json`, `client/messages/**` |
| 1 | W1-B | 2 | `server/src/db/schema/eval.ts`, `server/src/db/migrations/**` (лише як вивід `pnpm db:generate`) | `server/src/vendor/shared/**`, `client/**`, `server/src/modules/eval/**`, `package.json` |
| 1 | W1-C | 3 | `server/src/modules/eval/scoring.ts`, `server/src/modules/eval/helpers.ts`, `server/src/modules/eval/constants.ts`, `server/test/eval-scoring.test.ts` | решта `server/src/modules/eval/**`, `server/src/db/**`, `server/src/vendor/shared/**`, `client/**` |
| 1 | W1-D | 4 | `package.json` (кореневий), `client/messages/en/eval.json`, `client/messages/en/agents.json` | `client/src/**`, `server/**` |
| 2 | W2-A | 5 | `server/src/modules/eval/repository.ts`, `server/src/modules/eval/types.ts` | `client/**`, решта `server/src/modules/eval/**` |
| 2 | W2-B | 6 | `client/src/lib/hooks/eval.ts`, `client/src/lib/hooks/eval.test.tsx`, `client/src/lib/hooks/index.ts` | `server/**`, `client/src/app/**` |
| 3 | W3-A | 7 | `server/src/modules/eval/service.ts` | `server/src/modules/eval/{runner,dashboard,routes,repository,scoring,helpers,constants}.ts`, `client/**` |
| 3 | W3-B | 8 | `server/src/modules/eval/runner.ts` | `server/src/modules/eval/{service,dashboard,routes,repository,scoring,helpers,constants}.ts`, `client/**` |
| 3 | W3-C | 9 | `server/src/modules/eval/dashboard.ts` | `server/src/modules/eval/{service,runner,routes,repository,scoring,helpers,constants}.ts`, `client/**` |
| 4 | W4-A | 10 | `server/src/modules/eval/routes.ts`, `server/src/modules/index.ts` | `client/**`, решта `server/src/modules/eval/**` |
| 4 | W4-B | 11 | `client/src/app/agents/[id]/_components/AgentEditor/**` | `client/src/app/repos/**`, `client/src/app/eval/**`, `client/src/lib/**`, `client/messages/**`, `server/**` |
| 4 | W4-C | 12 | `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/**`, `.../FindingsPanel/FindingsPanel.tsx` | `client/src/app/agents/**`, `client/src/app/eval/**`, `client/src/lib/**`, `client/messages/**`, `server/**` |
| 5 | W5-A | 13 | `client/src/app/eval/**` | `client/src/app/agents/**`, `client/src/app/repos/**`, `client/src/lib/**`, `server/**` |
| — | людина | 14 | `client/src/vendor/ui/nav.ts` | усе інше |
| 6 | W6-A | 15 | `server/test/eval.it.test.ts` + точкові правки будь-де за знайденими розбіжностями (єдиний лейн у хвилі — конфлікту немає) | `client/src/vendor/ui/**`, `server/src/db/migrations/*.sql` |
| 7 | W7-A | 16 | `AGENTS.md`, `server/README.md`, `client/README.md` | код |

Що несе кожен хендофф: назву плану (`.claude/plans/l06-evals-eval-pipeline.md`),
номери **своїх** рядків, свої шляхи й шляхи сусідніх лейнів як «не чіпати», а на
хвилях 2+ — рядок «кроки *n…* попередніх хвиль зроблено, будуй на них, не
переробляй». Назад — implementation report із `Steps: N/N`. Кроки 11–13 у своїх
звітах **окремо** називають, який роут і яку форму контракту вони спожили: це
той вхід, за яким крок 15 будує перевірки швів.

## Contract & migration impact

**Що перетинає дріт і які копії рухаються разом.** Крок 1 змінює
`contracts/eval-ci.ts` і `contracts/knowledge.ts` **одночасно** в
`server/src/vendor/shared` (канонічна) і `client/src/vendor/shared` (урізана).
Сьогодні `EvalDashboard`, `EvalRunRecord`, `EvalRunResult`, `EvalTrendPoint`
**не мають жодного споживача** поза цими двома копіями (перевірено по
`server/src`, `client/src`, `mcp/src`, `reviewer-core/src`) — тому переформувати
`alert` можна без сумісності. Це вікно закривається кроком 6.

Нове й змінене (форми — обовʼязкові, назви полів — контракт між лейнами):

- `EvalCaseResult` — `{ case_id, case_name, run_id, pass: boolean|null, recall,
  precision, citation_accuracy: number|null, raw_count, grounded_count:
  number|null, error: { code, message } | null }`.
- `EvalBatchRecord` — `{ batch_id, agent_id, agent_name, agent_version, ran_at,
  recall, precision, citation_accuracy: number|null, traces_passed,
  traces_total, cases_errored, duration_ms, cost_usd: number|null }`.
- `AgentEvalBatch` — `EvalBatchRecord` + `cases: EvalCaseResult[]`. Відповідь
  `POST /agents/:id/eval-runs`.
- `EvalAlert` — `{ metric: 'recall'|'precision', drop_pp: number, others:
  { recall: number, precision: number, citation_accuracy: number } }`.
  **Структура, не готовий рядок** — інакше англійський текст банера жив би на
  сервері, чого NFR i18n не дозволяє.
- `EvalAgentSummary` — `{ agent_id, name, model, cases_total, last_batch:
  EvalBatchRecord | null }`; `EvalDashboardOverview` — `{ agents:
  EvalAgentSummary[], recent_batches: EvalBatchRecord[] }`. Відповідь
  `GET /eval/overview` (AC-26, AC-27).
- `EvalRunRecord` **+** `batch_id`, `agent_version`, `error` (усі nullable —
  старі рядки їх не мають).
- `EvalDashboard` — `alert` стає `EvalAlert | null`; додається
  `recent_batches: EvalBatchRecord[]`; наявне `recent_runs` лишається
  **покейсовим**.
- `EvalCase` / `EvalCaseInput` **+** `source_finding_id: string | null`.

**Поля, зміст яких залежить від різновиду — по одному рядку на різновид, бо
саме такі поля два лейни реалізують по-різному:**

- `expected_output.findings` — **непорожній масив** = `must_find`: кожен запис
  несе `file`, `start_line`, `end_line`, `severity`, `category`, `title`; скорер
  читає **лише** `file` і пару рядків, решта — довідка для людини.
  **Порожній `[]`** = `must_not_flag`: очікувань нема, тож `recall = 1` завжди,
  а `precision` дорівнює 0 при будь-якій вцілілій знахідці й 1 при жодній
  (AC-20). **Відсутнє / невалідне за контрактом** = трактується як `[]`
  (`safeParse`), кейс показується непройденим із поясненням, роут не 500-ить.
  Ці три різновиди — не три схеми, а три прочитання одного поля; крок 7 пише їх,
  крок 3 читає, крок 11 рендерить.
- `notes` — для `must_not_flag`-кейса несе **довідку про відхилену знахідку**
  (`file`, рядки, заголовок), для решти — вільний текст користувача. Скорер не
  читає його **ніколи**, у жодному різновиді.
- `eval_runs.pass` — `true`/`false` = кейс відскоровано; **`null` = кейс упав**
  (AC-25). Рядок із `null` виключається з `recall`/`precision`/
  `citation_accuracy`, з `traces_passed` **і** з `traces_total`, а рахується в
  `cases_errored`. Інакше `X/Y pass` читався б як «агент погіршився», хоча впав
  провайдер.
- `eval_runs.actual_output` — для успішного кейса `{ findings: [...],
  raw_count, grounded_count }`; для впалого — `{ error: { code, message } }` і
  нічого більше. Причина дублюється в `error_reason` як колонка, щоб її можна
  було читати без розбору jsonb.
- `eval_cases.source_finding_id` — `uuid` **без** foreign key. `null` означає
  «кейс створено вручну», непорожнє — «зроблено зі знахідки з цим id, яка може
  вже не існувати». Не звʼязок і не гарантія існування; це те, чим ловиться
  дубль (AC-6) і що дозволяє видалити знахідку, не зачепивши кейс.
- Код відповіді `POST /findings/:id/eval-case` — **201** = кейс щойно створено,
  **200** = такий уже був і повертається наявний. Тіло в обох випадках однакове
  (`EvalCase`); дискримінант — саме статус, і клієнт (крок 12) мусить відкривати
  кейс на обох.
- `owner_kind` — `'agent'` і `'skill'` живуть в одній таблиці, але Eval Dashboard
  і агентський прогін бачать **тільки** `'agent'` (AC-28), а Skills Lab — тільки
  `'skill'` (не змінюється). Фільтр — у репозиторії кроку 5.

**Міграція.** Одна нова, суто адитивна (перелік — у **Steps** крок 2), створена
`cd server && pnpm db:generate`, застосована `cd server && pnpm db:migrate`.
Нових foreign key нема (обґрунтування — у **Constraints that bind this
change**). Наявні `.sql` не редагуються й не можуть бути відредаговані —
`.claude/settings.json:7-8`.

## Verification plan

- `node scripts/verify.mjs --slice backend` — кроки 1, 2, 3, 5, 7, 8, 9, 10, 15.
- `node scripts/verify.mjs --slice frontend` — кроки 1, 4, 6, 11, 12, 13.
- `cd server && pnpm db:generate` — крок 2. Скрипт `verify.mjs` цього не робить;
  міграцію не можна написати руками (`settings.json:8`). Успіх = файл згенеровано
  **без** інтерактивного промпта.
- `cd server && pnpm db:migrate` — перед слайсом `integration`. `verify.mjs` не
  мігрує, а міграції не застосовуються на бутi (`AGENTS.md`).
- `node scripts/verify.mjs --slice integration` — крок 15 (потрібен Docker).
- `pnpm verify:l06` — крок 4, і це **сам** критерій AC-35: перевіряється код
  виходу (0 на зеленому, ненульовий, коли хоч один гейт червоний).
- `node scripts/pr-gate-ci.mjs --base <base sha> --body-file <тіло PR>` — крок 14
  (`Vendor-update: client/src/vendor/ui/nav.ts` пофайлово) і секція **Insights**
  у тілі PR. `verify.mjs` цього не покриває; у CI це
  `.github/workflows/pr-gate.yml:62-66`.
- `node scripts/check-specs.mjs` — крок 16 і спека загалом
  (`.github/workflows/pr-gate.yml:72`). Статус `draft` проходить
  (`check-specs.mjs:35`).
- `cd client && pnpm arch` — розкладка клієнта. Уже входить у слайс `frontend`
  як `client depcruise` + `check-ui-conventions` (`scripts/verify.mjs:107-112`),
  окремим рядком не запускається.
- **Поза `verify.mjs` і поза цим планом:** `.github/workflows/evals.yml`
  стартує на цій гілці (`paths:` містить `.claude/**` і `AGENTS.md`) і на кроці
  16 вмикає платний workflow-тир. Це не гейт цього плану — це бюджет; див.
  **Risks**.

## Out of scope / left to reviewers

- Архітектурне рев'ю (`architecture-reviewer`), `/code-review`,
  `/security-review`, `plan-verifier`, `/pr-self-review` і відкриття PR — стадії
  `/implement`, не рядки плану.
- **Non-goals спеки, дослівно:**
  - «Не чіпаємо eval для **скілів**: `POST /skills/:id/eval-run`, вкладка `Evals`
    у редакторі скіла і компаратор за мультимножиною severity
    (`server/src/modules/skills/helpers.ts:142-186`) лишаються як є. Агентський
    скоринг — інший (за `file:line`), і два скорери співіснують навмисно.»
  - «Не будуємо LLM-суддю: на лабораторній він був потрібен, бо «пояснив
    причину» підрядком не рахується; тут очікування — це `file:line`.»
  - «Не автоматизуємо прогін: жодного прогону за розкладом, при відкритті
    сторінки чи після збереження агента — кожен прогін коштує N викликів моделі
    й запускається людиною.»
  - «Не робимо експорт evals у CI, secret/phantom-гейти й conformance — це решта
    L06 і окремі спеки.»
  - «Не переносимо метрики агента в `agent-performance` (L08).»
- Наповнення набору (≥ 8 кейсів із реальних рішень L01–L05) і два прогони з
  різними промптами — **робота людини за живою моделлю**, після зеленого
  ланцюга. Сідер не змінюється (дефолт відкритого питання спеки).
- `Run all agents`, `Promote v7`, фільтр періоду `30 days`, g-чорд для
  `Eval Dashboard` — дефолти відкритих питань спеки: поза обсягом.
- e2e-флоу: не додається (NFR Тестові лейни). Пропозиція про model-free флоу на
  порожній стан — **Recommendations** R5.
- Кросагентне порівняння прогонів: спека лишає його поза обсягом (edge case «два
  прогони різних агентів»).

## Risks

- **Кореневий `package.json` перетворює «install at root does nothing» на
  неправду.** Найдешевший ранній сигнал: після кроку 4 у корені зʼявився
  `node_modules/` або `pnpm-lock.yaml` — значить, файл не `private` або має
  залежності. Мітигація в кроці 4 (`private`, нуль залежностей,
  `packageManager: pnpm@10.34.5`), виправлення документа — крок 16.
- **Крок 14 зупиняє ланцюг, бо його не може виконати жоден агент.** На L05 це
  вже коштувало стадії (INSIGHTS root#2026-08-18). Сигнал: перша ж спроба
  `Edit` по `nav.ts` повертає відмову дозволу. Мітигація: рядок явно
  позначений як людський і винесений з хвиль — попросити людину **до** хвилі 5,
  а не після.
- **Скорер копіюють із допродуктової версії й тихо порушують AC-15.**
  `findingMatches` у `15fa391^` зараховує збіг ще й за підрядком заголовка та за
  severity/category. Сигнал: unit-кейс «інша знахідка з тим самим заголовком у
  ІНШОМУ файлі» зараховується як знайдена. Мітигація: цей кейс — обовʼязковий
  негативний тест кроку 3.
- **Інтеграційний тест дістає реальний провайдер і починає флейкати або
  витрачати гроші.** Сигнал: у stderr зʼявляється попередження справжнього
  `openai` SDK про `.optional()` без `.nullable()` (INSIGHTS server#2026-08-11),
  або тест іде ~10 с замість миттєвого. Мітигація: мокати **кожен** слот
  `overrides.llm`, а не лише провайдера агента.
- **`pnpm db:generate` зупиняється на інтерактивному промпті** й лейн висить.
  Сигнал: команда не завершується. Мітигація: дифф суто адитивний; якщо промпт
  усе-таки зʼявився — значить, у крок 2 просочилось перейменування чи дроп, і
  його треба розбити на два генерати (INSIGHTS root#2026-08-05).
- **Червоний `--slice backend` на macOS не має стосунку до цієї гілки.** Сигнал:
  падають рівно `test/context-walk.test.ts` і `test/depgraph-adapter.test.ts`.
  Мітигація: перевірити фікстури на `tmpdir()` перш ніж звинувачувати гілку
  (INSIGHTS server#2026-08-20) — на L05 це коштувало цілого прогону агентів.
- **Крок 16 (правка кореневого `AGENTS.md`) вмикає платний workflow-тир
  `evals.yml`.** Сигнал: у PR зʼявився джоб `workflow` замість самого лише
  `gate`. Це очікувано й бюджетно (`AGENTS.md` → Use when), але про це має знати
  той, хто дивиться на рахунок; несподіванкою це бути не повинно.
- **Дві клієнтські поверхні (кроки 11 і 13) незалежно вирішують, як показати
  метрику `null`.** Сигнал: на одній сторінці «—», на іншій «0%». Мітигація:
  правило «немає прогону → порожній стан, ніколи не нуль» задано контрактом
  (`null`-агрегати кроку 9) і ключами i18n кроку 4, а не домовленістю між
  лейнами; крок 15 звіряє обидві.

## Open questions

- **Чи потрібен перевірний поріг для NFR «≤ 300 мс на воркспейс із ≤ 50
  прогонів»?** Дефолт, який виконавець приймає: ні — план не додає тесту на
  час. Перевіряється лише структурно (індекси кроку 2, відсутність N+1 у кроці
  9); числа лишаються орієнтиром для людини, а не гейтом.
- **Скільки останніх пакетів показує таблиця `/eval` і `/eval/[agentId]`?**
  Дефолт: 20, константою в `modules/eval/constants.ts`, серверний ліміт (спека
  каже «останні N прогонів», числа не називає).
- **Чи має `POST /agents/:id/eval-runs` повертати 409 і тоді, коли ключ
  провайдера відсутній, але набір **порожній**?** Дефолт: ні — порожній набір
  перевіряється **першим** і дає власну відмову без резолву провайдера, бо AC-23
  вимагає нуль викликів моделі; 409 лишається для непорожнього набору.
