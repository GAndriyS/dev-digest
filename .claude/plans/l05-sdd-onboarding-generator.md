# Plan: Onboarding Generator — тур незнайомим репозиторієм із п'яти секцій

**Branch:** L05-SDD · **Slices:** contracts, backend, frontend, e2e, meta · **Spec:** specs/SPEC-03-onboarding-generator-19-08-2026.md (approved) · **Mode:** multi-agent · **Supersedes:** none

## Context read

Правила й факти, що зв'язують саме цю зміну — з локаторами. Кілька з них
суперечать тому, що стверджує специфікація; вони позначені **⚠**.

**Кореневі правила**

- **Дві копії `@devdigest/shared`** — `server/src/vendor/shared` канонічна, `client/src/vendor/shared` урізана; правити обидві однією зміною (root `AGENTS.md` → Conventions).
- ⚠ **Копії `knowledge.ts` НЕ ідентичні сьогодні**, попри твердження спеки (NFR Contracts: «сьогодні обидві копії цього файла ідентичні»). `diff server/src/vendor/shared/contracts/knowledge.ts client/src/vendor/shared/contracts/knowledge.ts` дає 9 гунків: клієнтська копія не має `AgentVersionConfig`/`AgentVersion` (сервер, рядки 379-403) і несе скорочені коментарі. Блок `// ---- Onboarding ----` (рядки 28-47) **справді ідентичний** в обох. Наслідок для плану: дзеркалиться саме блок `Onboarding*`, а не файл; «зробити файли ідентичними» затягнуло б у клієнтську копію чужі контракти.
- **Контракти Zod-first**: одна схема живить валідацію запиту і серіалізацію відповіді; `Schema.parse(req.body)` у хендлері заборонено (root `AGENTS.md`; `server/AGENTS.md`).
- **Міграції не на буті**; застосовані `server/src/db/migrations/*.sql` не редагуються (root `AGENTS.md`). Тут вони не потрібні — див. **Contract & migration impact**.
- **DB-тести — суфікс `*.it.test.ts`**; лінії розходяться рівно на цьому globі (`server/AGENTS.md`; `scripts/verify.mjs:117,131`).
- **Пакетні менеджери**: `server/`, `client/` → pnpm; `e2e/` → npm (`AGENTS.md`, `e2e/AGENTS.md`).
- **Коли проза й CI розходяться — правий CI** (root `AGENTS.md`).
- ⚠ **`.claude/settings.json:9-12` жорстко забороняє `Edit`/`Write` по `**/src/vendor/ui/**`** — і субагентам, і головній сесії. root `INSIGHTS.md` (2026-08-18) фіксує, що це вже коштувало стадії в попередньому прогоні L05: рядок `nav.ts`, відданий `implementer`, не виконуваний у принципі, і людина копіювала файл руками. Тому крок 13 нижче — **не** агентський.
- **Declared vendor update**: `**/src/vendor/ui/**` можна правити на місці, якщо тіло PR несе рядок `Vendor-update: client/src/vendor/ui/nav.ts`; це перевіряє `scripts/pr-gate-ci.mjs` (`.claude/skills/pr-self-review/routing.md` § Slices). Прецедент і форма коментаря — `client/src/vendor/ui/nav.ts:21-38` (три попередні declared updates).
- **Паралельні лейни — ділити за ВЛАСНІСТЮ ФАЙЛІВ, не за концернами**, і закладати окремий інтеграційний прохід по швах між лейнами: обидва крос-агентні баги минулого разу типізувалися чисто з обох боків (root `INSIGHTS.md`, 2026-08-04).

**Сервер**

- **Анатомія модуля**: `modules/<name>/{routes,service,repository}.ts` + один рядок у `src/modules/index.ts`; `constants.ts`/`types.ts` — публічна поверхня модуля (`server/AGENTS.md`; `.claude/skills/onion-architecture/SKILL.md` § New module checklist). Реєстрація статична навмисно (`src/modules/index.ts:20-23`).
- **`no-cross-module-internals`** (`server/.dependency-cruiser.cjs:81-97`): чужі `service/repository/helpers` приватні; дозволені `_shared/`, `constants.ts`, `types.ts`, `index.ts`.
- **`routes-through-service`** (`:50-58`): роут не торкається `db/schema` і репозиторію. **`service-stays-http-agnostic`** (`:61-69`): сервіс/репозиторій/хелпери не імпортують `fastify` — отже логер у сервіс передається як звичайний інтерфейс або лінія логу пишеться на роуті.
- **Шаблон роутів** — `server/src/modules/conventions/routes.ts:23-48`: `app.withTypeProvider<ZodTypeProvider>()`, `getContext(app.container, req)` для `workspaceId`, `schema: { params: IdParams }`. `IdParams = z.object({ id: z.string().uuid() })` (`src/modules/_shared/schemas.ts:11`) — це і є 422 на невалідному `:id` (AC-32). Префікс `/repos/:id/...` належить модулю фічі (там же, коментар :15-17).
- **409 «немає ключа»** — `NoProviderKeyError extends AppError` з кодом `no_provider_key` (`src/modules/conventions/service.ts:41-52`, код у `constants.ts:86`); транслюється з `ConfigError` при `container.llm(provider)` (`service.ts:124-128`). `AppError(code, message, statusCode, details)` — `src/platform/errors.ts:9-19`.
- **`resolveFeatureModel(container, workspaceId, 'onboarding')`** — `src/modules/settings/feature-models.ts:51-57`, імпортується через публічний `../settings/index.js` (так робить conventions). Дефолт фічі — `openrouter` / `deepseek/deepseek-v4-flash` (`src/vendor/shared/contracts/platform.ts:44-51`).
- **`completeStructured`** повертає `{ data, model, tokensIn, tokensOut, costUsd, raw, attempts }` (`src/vendor/shared/adapters.ts:72-80`). Реалізація `src/adapters/llm/openai.ts:88-133`: цикл `maxRetries+1`, токени **сумуються** по спробах (`:112-113`), `attempts` — номер успішної спроби (`:124`), після вичерпання спроб кидає `ExternalServiceError` (`:133`). Це рівно те, що потрібно AC-34 (`calls=1`, `attempts≥1`) і AC-26.
- **`readInsideClone(root, relPath, maxBytes)`** — `src/modules/_shared/clone-fs.ts:43-56`: `realpath` + `isInsideRoot` з роздільником у префіксі; повертає `null` замість кидати. Мотивація — `server/INSIGHTS.md` (2026-08-06): вміст `server/clones/**` контрольований атакуючим, вектор — symlink, а не `..`; на Windows-клоні без Developer Mode діра невидима локально.
- **Прецедент збору фактів із клону** — `ConventionsService.sample` (`src/modules/conventions/service.ts:180-204`): фіксований список `CONFIG_FILES` (`constants.ts:15-25`) + `getConventionSamples`, один `realpath` кореня, `Promise.all` читань через `readInsideClone`, `MAX_FILE_BYTES = 2_000_000` (`constants.ts:51`).
- **Прецедент пост-валідації** — `verifyCandidates` (`src/modules/conventions/helpers.ts:180-210`): чиста функція, `byPath`-мапа дозволеного, лічильники відкинутого окремо. Викликається після зрізання відповіді моделі до межі константою (`service.ts:141-142`), бо «промт — це прохання».
- **Шаблони промтів** — `renderPrompt(name, vars)` / `renderTemplate` (`src/platform/prompts.ts:24-41`), `{{var}}`, кеш. Наявний файл `src/prompts/onboarding.system.md` параметризований `{{sections}}` і `{{language}}` і **називає інші секції** (`architecture`, `routes_and_apis` — рядки 7-8, 23-27).
- **Логер**: контейнер логера НЕ має (`src/platform/container.ts` — жодного `log`); модулі пишуть через `app.log.*` на роуті (`src/modules/pulls/routes.ts:130`). Формат «рядок з токенами й вартістю» вже є в `src/modules/reviews/intent.ts:139-142`.
- **Контейнер**: лінивий геттер + `overrides.<x>` першим — `container.repoIntel` (`src/platform/container.ts:126-130`), `container.projectContext` (`:137-145`). Тести підмінюють через `ContainerOverrides`, не `vi.mock` (`onion-architecture` § Testing seams). `MockLLMProvider` рахує виклики в `calls[]` (`src/adapters/mocks.ts:57-59`) — це і є «кількість викликів провайдера» в AC-3/4/5/25.
- **`RepoIntel` — фасад**: `getTopFilesByRank(repoId, n, {exclude})` фільтрує junk (`isJunkPath`, `service.ts:713-731`, патерни `:788+`: `.test.`, `.spec.`, `/test/`, `/migrations/`, `.d.ts` …) і повертає `[]` при `repoIntelEnabled === false`; `getCriticalPaths` повертає **ланцюги** `string[][]` від 5 топ-рангових коренів на глибину `BFS_DEPTH` і `[]` при порожньому `file_edges` (`service.ts:738-781`). `getIndexState` ніколи не кидає: за відсутності рядка синтезує `status:'degraded', degradedReason:'no_data'` (`service.ts:189-205`).
- ⚠ **`IndexState` НЕ несе `stats`** (`src/modules/repo-intel/types.ts:42-50`), а `tryGetIndexState` мапить із `stats` лише `durationMs`, `reason`, `degradedReason` (`repository.ts:205-233`). Тобто чисел AC-6/AC-28 («N файлів коду з M кандидатів») через фасад сьогодні **не дістати**, хоча вони persist-яться: `walk.stats = {totalCandidates, skippedTooLarge, bounded}` (`pipeline/walk.ts:36-43,57-70`) лягає в `repo_index_state.stats` і на повному (`pipeline/full.ts:259-283`), і на деградованому шляху (`:102-110`).
- ⚠ **Обрізання за `MAX_INDEXED_FILES` НЕ робить індекс `partial`** — всупереч тому, що припускає AC-28. `status = clean ? 'full' : 'partial'`, де `clean` залежить лише від soft-budget, збою/порожнечі графа і помилок парсингу (`pipeline/full.ts:253-259`); `stats.bounded` у це не входить. Великий репозиторій із чистим проходом стається `status:'full'` при `bounded > 0`.
- **`repoIntelEnabled`** — `src/platform/config.ts:161` (`REPO_INTEL_ENABLED !== 'false'`); доступний сервісу як `container.config.repoIntelEnabled` (так робить сам `repo-intel/service.ts:707`).
- **Таблиця `onboarding`** існує з `0000_init.sql:205`: `repo_id` uuid PK → `repos.id` ON DELETE CASCADE, `json` jsonb NOT NULL, `generated_at` timestamptz NOT NULL DEFAULT now() (`src/db/schema/context.ts:120-126`). `repos.fullName`, `repos.defaultBranch`, `repos.clonePath` — `src/db/schema/repos.ts:13-16`.
- **Сід**: репозиторій демо тепер має `clonePath`, що вказує на фікстуру Project Context (`src/db/seed.ts:295-299`), і **не має** індексу. Отже на засіяному стенді сторінка тура детерміновано покаже skeleton — саме те, що потрібно e2e без ключа й без виклику моделі.

**Клієнт**

- ⚠ **`activeKeyFor` (`client/src/components/app-shell/helpers.ts:29`)**: `pathname.includes("/onboarding") → "onboarding-tour"` — і це спрацьовує на екрані додавання репозиторію `/onboarding` (`client/src/app/onboarding/page.tsx`). Порядок перевірок має значення: рядок 29 стоїть ПЕРЕД `/context` і `/pulls`, тож `/repos/x/onboarding` теж піде туди.
- **`messages/en/onboarding.json` уже містить рядки ТУРА** (`title`, `sections`, `sectionCount`, `regenerate`, `generate.*`, `loadError.*`) і **не використовується жодним компонентом** (`rg 'useTranslations("onboarding'` — нуль збігів). Це готовий неймспейс, який фіча підхоплює й доповнює. Локаль у репо одна — `en` (`client/messages/` містить лише `en`).
- **`shell.json:20`** уже має `nav.onboarding-tour: "Onboarding Tour"`; **рядка в `NAV` немає** (`client/src/vendor/ui/nav.ts:39-55` — у `WORKSPACE` тільки `pulls` і `context`).
- **Розміщення**: сторінка тонка, логіка в колокованому `_components/<Name>/` з `Name.tsx`, `constants.ts`, `styles.ts`, `index.ts`, `Name.test.tsx`; усі рядки в `messages/<locale>/*.json`; `fetch` тільки в `src/lib/api.ts`; хуки в `src/lib/hooks/*` (`client/AGENTS.md`). Зразок один-в-один — `src/app/repos/[repoId]/context/`.
- **`check-ui-conventions.mjs` перевіряє рівно дві речі** — `export *` у barrel і `fetch(` поза `lib/api.ts` (`client/scripts/check-ui-conventions.mjs:10-19`). Захардкоджених рядків він **не** ловить, тож AC-37 потребує власного тесту (див. **Decisions taken** D9).
- **`MermaidDiagram`** валідує через `mermaid.parse({suppressErrors})` і при невалідному вводі рендерить `null`, а не «Syntax error»-графіку (`client/src/components/mermaid-diagram/MermaidDiagram.tsx:22-59`) — AC-12 задовольняється перевикористанням примітиву, без нового коду.
- **`Markdown`** — `react-markdown` + `remark-gfm` без `rehype-raw`, тобто сирий HTML не виконується (`client/src/vendor/ui/primitives/Markdown.tsx:6-41`). `client/INSIGHTS.md` (2026-08-05): примітив мапить лише `p/strong/code/a`, решта падає в Preflight — заголовки в `body` виглядатимуть як звичайний текст, і це не баг парсера; стилізується через `.dd-md` з `app/globals.css`.
- **`githubBlobUrl(fullName, sha, file)`** уже будує `https://github.com/<full_name>/blob/<sha>/<enc path>` з URL-екрануванням сегментів (`client/src/lib/github-urls.ts:24-37`) — AC-14 підставляє `default_branch` замість `sha`.
- **`api.ts` вже знає про body-less POST** — заголовок `content-type` ставиться лише за наявності тіла, інакше Fastify лається «Body cannot be empty» (`client/src/lib/api.ts:24-30`, коментар прямо називає `tour generate`).
- **RTL-зразок** — `ProjectContextView.test.tsx:1-45`: `NextIntlClientProvider` з реальним `messages/en/<ns>.json`, `vi.mock` на `next/navigation`, `@/lib/hooks/*`, `@/components/app-shell`.

**CI**

- Лінії: `.github/workflows/{client,server-unit,server-integration,reviewer-core,mcp,e2e-web,pr-gate}.yml`. `scripts/verify.mjs` інлайнить перші п'ять (`verify.mjs:104-140`); `e2e-web.yml` і `pr-gate.yml` він **не** покриває — це задокументовано в його ж заголовку (`verify.mjs:26-32`), тож це не дрейф.
- Інтеграційна лінія піднімає власний Postgres через testcontainers і сама ганяє міграції (`server/test/helpers/pg.ts:34-51`), тож `pnpm db:migrate` для неї не потрібен.
- `e2e-web.yml:11-24` тригериться на `client/**`, `server/**`, `e2e/**`; ключів немає навмисно — флоу ходять по засіяних read-only даних (`:5-7`).
- Додавання флоу: пронумерувати після останнього + оновити таблицю покриття в `e2e/README.md`, тільки детерміновані локатори (`e2e/specs/README.md:13-18`). Останній — `10-project-context.flow.json`.

## Requirements review

Джерело — SPEC-03 (approved, 40 AC, Open questions закриті таблицею рішень). Дослівно наведені рядки з вердиктом, відмінним від `clear`, і ті, що потребують примітки; послідовні `clear` згорнуті.

| # | Requirement (verbatim) | Verdict | How the plan handles it |
|---|------------------------|---------|-------------------------|
| AC-1, AC-2 | — | 2 × `clear` | Кроки 11 (сторінка), 13 (рядок `NAV`), 9 (`activeKeyFor` розрізняє `/onboarding` і `/repos/:id/onboarding`), 14 (e2e) |
| AC-3 | «ПОКИ для репозиторію немає збереженого тура, система повинна (shall) показувати порожній стан із кнопкою `Generate` і НЕ робити жодного виклику моделі.» | `clear` — форма на дроті див. AC-30 | Крок 6: `GET` без рядка в таблиці й зі справним індексом віддає `status:'ready'`, `sections: []`, `generated_at: null`; крок 11 малює порожній стан. Виклик моделі неможливий: `GET` не має шляху до `container.llm` |
| AC-4, AC-5 | — | 2 × `clear` | Кроки 5 (repository: `INSERT … ON CONFLICT (repo_id) DO UPDATE`, повний перезапис рядка), 6 (єдиний `completeStructured`), 10 (мутація + інвалідація ключа) |
| AC-6 | «Система повинна (shall) показувати під заголовком рядок із трьома фактами: скільки файлів коду проіндексовано з кількох кандидатів обходу, статус індексу і коли тур згенеровано.» | **`conflicts`** | Числа persist-яться (`walk.ts:36-43` → `repo_index_state.stats`), але фасад їх не віддає: `IndexState` не має `stats` (`repo-intel/types.ts:42-50`), а `tryGetIndexState` мапить лише три поля (`repository.ts:212-233`). Конфлікт із Non-goal «Зміна `repo-intel`». **Дефолт — правило репозиторію: фасад лишається єдиним входом** (NFR Architecture «фасад `repo-intel` викликається лише через контейнер DI»), тому крок 2 **адитивно** додає `totalCandidates`/`bounded` в `IndexState` і мапінг у `tryGetIndexState`. `MAX_INDEXED_FILES`, формула рангу й глибина клону — ті три речі, які Non-goal називає поіменно, — не чіпаються. Альтернатива (онбординг читає `repo_index_state` власним репозиторієм) відкинута: дублює read-model фасаду й суперечить NFR Architecture. Записано в **Decisions taken** D1 і в **Open questions** Q-A |
| AC-7 … AC-16 | — | 10 × `clear` | Кроки 11 (`Share link` через `navigator.clipboard` + підтвердження, дизейбл кнопки на час мутації, згортані картки + `ON THIS PAGE`, `Open` через `githubBlobUrl(full_name, default_branch, path)`, нумеровані команди з кнопкою копіювання), 4 (`diagram` дозволений лише в `architecture_overview`, решта нормалізується в `null`), 6 (команди лише читаються). AC-16 — негативна вимога: перевіряється відсутністю `node:child_process`/`exec` у модулі й на екрані (крок 16) |
| AC-17, AC-18 | — | 2 × `clear` | Крок 4: порядок `reading_path` задає КОД зі списку `getTopFilesByRank` (ранг спадно); модель постачає лише `rationale` до кожного шляху й не може переставити список — у драфт-схемі це мапа `path → rationale`, а не масив |
| AC-19 | «ДЕ секція — `first_tasks`, система повинна (shall) будувати кожну задачу лише з детермінованого сигналу з реальним шляхом: маркер `TODO` / `FIXME` у проіндексованому файлі, високоранговий файл без сусіднього тесту, або малий периферійний файл із низьким in-degree.» | `clear` — із приміткою | Це **whitelist** («або»), а не мандат на всі три. Крок 6 збирає сигнали 1 (`TODO`/`FIXME` у топ-`TASK_SCAN_FILES` файлах, читання через `readInsideClone`) і 2 (відсутність сусіднього тесту — точкові проби `<stem>.test.<ext>`, `<stem>.spec.<ext>`, `__tests__/<name>`, тим самим читачем). Сигнал 3 (низький in-degree) **не реалізується**: фасад не має методу in-degree, а `getTopFilesByRank` віддає лише верх списку — дістати «хвіст» без зміни `repo-intel` неможливо. Див. **Recommendation R2** |
| AC-20 … AC-27 | — | 8 × `clear` | Кроки 4 (skeleton-білдер, пост-валідація, секція без блоку посилань), 6 (шість причин skeleton, ввічливий no-op, `llm_failed` без чіпання кешу, 409 `no_provider_key`), 11 (CTA skeleton, відмінний від порожнього стану) |
| AC-28 | «ЯКЩО обхід клону вперся в межу `MAX_INDEXED_FILES`, ТОДІ система повинна (shall) все одно згенерувати тур з обмеженого індексу, віддати статус індексу `partial` і показати в підзаголовку, скільки файлів коду проіндексовано з кількох кандидатів.» | **`conflicts`** | Спека припускає поведінку, якої в конвеєрі немає: `status = clean ? 'full' : 'partial'` рахується лише з soft-budget, збою/порожнечі графа і помилок парсингу (`pipeline/full.ts:253-259`); `stats.bounded` на статус не впливає — обрізаний, але чисто пройдений індекс стоїть `full`. **Дефолт — не міняти конвеєр** (Non-goal + правило «застосований індексатор не чіпаємо»): онбординг виводить ВЛАСНИЙ статус для дроту — `index.status = bounded > 0 ? 'partial' : state.status` (крок 4, чиста функція). `repo_index_state` лишається як є. Записано в **Decisions taken** D2, **Open questions** Q-B і як insight-кандидат |
| AC-29 | — | `clear` | Крок 5: підсумок індексу зберігається ВСЕРЕДИНІ `onboarding.json` на момент генерації й читається звідти, а не з поточного `getIndexState` |
| AC-30 | «Система повинна (shall) нести тур на дроті контрактом `Onboarding`, розширеним полями `status` (`ready` \| `skeleton`), `reason` (причина skeleton, `nullish`), `generated_at` (`nullish`) і підсумком індексу (`files_indexed`, `total_candidates`, `bounded`, `status` індексу), і ці поля повинні бути присутні в ОБОХ копіях `@devdigest/shared` …» | **`ambiguous`** | Перелік `ready \| skeleton` не має значення для стану «тур ще не генерували» (AC-3), а він мусить відрізнятися від skeleton на екрані (AC-24). **Найвужче перевірне прочитання, яке беру за дефолт:** порожній стан = `status:'ready'` + `sections: []` + `generated_at: null`; skeleton = `status:'skeleton'` + `reason` + п'ять заголовків. Перелік не розширюю — він зафіксований дослівно. Друга частина рядка («обидві копії») виконується, але **дзеркалиться блок `Onboarding*`, не файл** — копії сьогодні не ідентичні (див. **Context read**). Див. **Recommendation R1** |
| AC-31, AC-32 | — | 2 × `clear` | Крок 1 (`kind` → `z.enum` із п'яти значень в обох копіях), крок 7 (`/repos/:id/onboarding`, `IdParams` на роуті → 422) |
| AC-33 … AC-35 | — | 3 × `clear` | Крок 4 (чистий білдер полів логу) + крок 7 (єдиний `app.log.info` на роуті: `calls=1`, `attempts`, токени, `costUsd`, `repoId`, `durationMs`; для skeleton — `calls=0` + `reason`) |
| AC-36 | «Система повинна (shall) писати текст тура мовою інтерфейсу користувача, а без такої — англійською, не перекладаючи ідентифікатори коду …» | **`ambiguous`** | Специфікація не каже, ЯК мова інтерфейсу доїжджає до сервера, а сервер локалі не має. **Дефолт:** тіло `POST` несе необов'язкове `locale` (zod, `z.string().min(2).max(10).optional()`), сервер підставляє його в `{{language}}` промта (`prompts.ts:33-37`) і падає на `en`, якщо поля немає. Тіло запиту — не частина контракту `Onboarding`, тож AC-30 не зачіпається. Записано як *default-assumed* (D5) |
| AC-37 | — | `clear` — механіка перевірки нова | Крок 12 (усі рядки в наявному неймспейсі `messages/en/onboarding.json`) + крок 18: RTL рендерить в'ю з sentinel-повідомленнями й стверджує, що на екрані немає жодного англійського літерала за замовчуванням. `check-ui-conventions.mjs` цього не ловить (`:10-19`) |
| AC-38 … AC-40 | — | 3 × `clear` | Крок 11 (`Markdown` без `rehype-raw`; шляхи, скрипти й команди — окремими текстовими вузлами, не через markdown), крок 6 (усе читання клону тільки через `readInsideClone`), крок 8 + крок 6 (вміст файлів їде в промт лише всередині `<untrusted>…</untrusted>`) |
| **Edge cases** — «клон не готовий», «індекс не побудовано», «`REPO_INTEL_ENABLED=false`», «індекс degraded/failed», «невалідний JSON після повтору», «немає ключа провайдера», «модель повернула неіснуючий шлях», «шість або чотири секції», «`diagram` у чужій секції», «mermaid не парситься», «подвійне натискання», «дві вкладки», «видалений файл → GitHub 404», «переіндексовано після кешу», «symlink назовні», «інструкція у `README.md`», «`<script>` у `body`», «дуже довгий шлях», «`TODO` у кожному файлі», «жодного сигналу», «порожня таблиця `onboarding`», «`/onboarding` не підсвічує тур», «наявний `06-onboarding.flow.json` лишається чинним» | — | 23 × `clear` | Кожен уже показує на свій AC і не породжує окремого кроку. Три, що впливають на форму коду: «шість або чотири секції» — драфт-схема ключована за `kind`, тож кількість секцій структурно невиразна, а брак ключа = провал zod усередині виклику → `llm_failed` (крок 4); «дві вкладки» — `repo_id` PK і повний перезапис рядка (крок 5); «`06-onboarding.flow.json` лишається чинним» — крок 14 додає ОКРЕМИЙ флоу і не редагує 06 |
| **Edge case** «**Монорепозиторій із кількома `package.json`** → скрипти збираються з кореневого й найближчих до кореня; те, чого не знайшли, у секцію не потрапляє.» | `ambiguous` | «Найближчі до кореня» без обходу директорій недосяжні (`_shared/clone-fs.ts` вміє лише точкове читання). **Дефолт:** читаються файли з `RUN_CONFIG_FILES` у корені клону ПЛЮС `<seg>/package.json` для кожного унікального першого сегмента шляхів із `getTopFilesByRank`, обмежено `MAX_MANIFEST_DIRS` (крок 6). Детерміновано, обмежено зверху, не потребує ні glob-а, ні нового I/O-примітиву, і на самому dev-digest дає `server/`, `client/` тощо |
| **Edge case** «**Граф імпортів порожній** … `critical_paths` і `reading_path` показують те, що є, без вигадування зв'язків» | `clear` | `getCriticalPaths` віддає `[]` (`service.ts:744`), ранг лишається (окрема таблиця) — крок 4 будує обидві секції з `getTopFilesByRank`, ланцюги лише збагачують опис і діаграму |
| **NFR Performance (читання)** «сторінка повинна віддавати його за ≤ 300 мс (p95, локальна БД)» | **`untestable`** | p95-гарнітури в репо немає, і план її не додає. Найвужче перевірне прочитання, яке реалізую: шлях `GET` робить рівно один `SELECT` по PK `onboarding` + один `getIndexState`, НУЛЬ читань диска клону і НУЛЬ викликів провайдера; це стверджується в `*.it.test.ts` (лічильник `MockLLMProvider.calls` + відсутність `clonePath`-залежності). Записано в **Open questions** Q-C |
| **NFR Performance (генерація)**, **(великий репозиторій)** | 2 × `clear` | Крок 6: обмежене число читань клону (`RUN_CONFIG_FILES` + до `MAX_MANIFEST_DIRS` маніфестів + до `TASK_SCAN_FILES` файлів під `TODO`-скан), решта фактів — запити до вже побудованого індексу; `MAX_INDEXED_FILES` не піднімається |
| **NFR Security**, **Security (секрети)**, **Local-first**, **Accessibility**, **Observability**, **Contracts**, **Contracts (вартість)**, **DB**, **i18n**, **Architecture** | — | 10 × `clear` | Кроки 6 (`readInsideClone`, `.env` не читається — його немає в `RUN_CONFIG_FILES`, `.env.example` є), 11 (клавіатура для карток і змісту, доступна назва кнопки копіювання з самою командою, статус skeleton як текст, активний пункт змісту не лише кольором), 7 (рівно один рядок логу), 1 (обидві копії однією зміною; токенів і вартості на дроті немає), 5 (жодної міграції), 12 (усі рядки в `messages/en/*.json`), 3-7 (анатомія `modules/<name>/…` + один рядок у `modules/index.ts`, `repo-intel` тільки через контейнер) |

## Decisions taken

Інтерв'ю не проводилось: режим задано делегацією, а Open questions спеки закриті
її ж таблицею рішень (SPEC-03, рядки 258-277), яку план не перевідкриває.
Нижче — усе, що план вирішив сам; кожен пункт помічений джерелом.

1. **Execution mode → `multi-agent`** — *human-answered* (делегація: «Mode: multi-agent», лейни за власністю файлів).
2. **Окрема стадія `test-writer` — Є** — *human-answered* (делегація: «test-writer + architecture-reviewer як стадія 4»). Тому основна маса тестів, виведених із `· verify:`-підказок спеки, — кроки 16-18 з виконавцем `test-writer`, а не `implementer`. `implementer` пише тільки те, без чого крок не можна вважати виконаним (він нічого не пише понад кроки 1-15 — жоден із них не містить тестів).
3. **D1. Числа AC-6/AC-28 беруться з розширеного `IndexState`** — *default-assumed*. Адитивні поля `totalCandidates`/`bounded` в `repo-intel/types.ts` + мапінг у `tryGetIndexState`; синтезований деградований стан отримує `0`/`0`. Причина й альтернативи — рядок AC-6 у **Requirements review**.
4. **D2. Статус індексу для дроту виводить онбординг, а не конвеєр** — *default-assumed*. `index.status = bounded > 0 ? 'partial' : state.status`. Причина — рядок AC-28.
5. **D3. Порожній стан = `status:'ready'` + `sections: []` + `generated_at: null`** — *default-assumed*. Перелік `status` не розширюється (AC-30 дослівний). Див. **Recommendation R1**.
6. **D4. Дзеркалиться блок `Onboarding*`, а не файл `knowledge.ts`** — *default-assumed*. Копії не ідентичні сьогодні; вирівнювання файлів затягнуло б у клієнт `AgentVersionConfig`/`AgentVersion`, яких там свідомо немає.
7. **D5. Мова тура їде в тілі `POST` як необов'язкове `locale`, дефолт `en`** — *default-assumed* (AC-36).
8. **D6. Форма єдиного виклику.** `llm.completeStructured({ model, schema: OnboardingDraft, schemaName: 'OnboardingTour', messages, temperature: 0, maxRetries: 2 })`. `OnboardingDraft` — **внутрішня** zod-схема модуля (`helpers.ts`), не контракт: об'єкт, **ключований п'ятьма `kind`** (`architecture_overview`, `critical_paths`, `run_locally`, `reading_path`, `first_tasks`), де `architecture_overview` має необов'язковий `diagram`, а решта — ні; `reading_path` несе мапу `path → rationale`, а не масив (порядок — за кодом, AC-17). Модель структурно не може ні змінити кількість секцій, ні їх порядок, ні поставити діаграму в чужу секцію. Повтор живе ВСЕРЕДИНІ виклику (`maxRetries`), тож `calls` лишається 1, а `attempts` росте (AC-34) — *default-assumed*.
9. **D7. Пост-валідація — за фактами, не за деревом клону.** Дозволений набір шляхів = об'єднання шляхів, які САМ КОД поклав у факти (топ-рангові файли, ланцюги `getCriticalPaths`, реально прочитані конфіги й маніфести, файли-сигнали `first_tasks`). Шлях від моделі, якого там немає, відкидається; `stat` довільного шляху з відповіді моделі НЕ робиться. Це строгіше за букву AC-21 («немає у фактах **або** у файловому дереві клону») і не додає нового поверхні читання атакерського вводу — *default-assumed*.
10. **D8. Рядок логу пишеться на роуті.** Сервіс повертає `{ tour, telemetry }`, де `telemetry` — внутрішній тип (`types.ts`), не дріт; чистий `onboardingLogFields(telemetry)` (`helpers.ts`) будує об'єкт полів, роут робить один `app.log.info(fields, msg)`. Так сервіс лишається HTTP-агностичним (`.dependency-cruiser.cjs:61-69`), формат перевіряється юнітом без контейнера (AC-34), а факт запису — інтеграційним тестом через спай на `app.log.info` (AC-33, AC-35) — *default-assumed*.
11. **D9. AC-37 перевіряється sentinel-повідомленнями** — *default-assumed*: RTL рендерить в'ю з `messages={{ onboarding: <усі ключі → унікальні маркери> }}` і стверджує, що жодного дефолтного англійського літерала на екрані немає. Машинного гейта на захардкоджений текст у репо немає.
12. **D10. Рядок `NAV` виконує ЛЮДИНА (головна сесія), не агент** — *default-assumed*, підстава — root `INSIGHTS.md` (2026-08-18) і `.claude/settings.json:9-12`. Крок 13 у ланцюг `/implement` не входить; PR несе `Vendor-update: client/src/vendor/ui/nav.ts`.
13. **D11. e2e-флоу пише `implementer`, не `test-writer`** — *default-assumed*: `test-writer` явно не має права писати `e2e/specs/*.flow.json` (`.claude/agents/README.md`, рядок test-writer).

## Recommendations

Порада, а не рішення; `plan-verifier` цього не оцінює.

- **R1. Додати `'empty'` третім значенням `Onboarding.status`.** *Чому:* сьогоднішній перелік `ready | skeleton` (AC-30) не має як сказати «тур ще не генерували», і план змушений кодувати цей стан як `ready` з порожнім `sections` — тобто «готово» там, де нічого не готово; клієнт мусить виводити стан із порожнечі масиву (AC-3 проти AC-24). *If accepted:* крок 1 додає третє значення в обидві копії, крок 6 повертає `status:'empty'` замість `ready`+`[]`, крок 11 гілкується явно, тести AC-3 стверджують `status`, а не довжину масиву. **Default: as requested.**
- **R2. Додати фасадний метод для in-degree** (напр. `getLowInDegreeFiles(repoId, n)` або `opts.order` для `getTopFilesByRank`). *Чому:* третій сигнал AC-19 («малий периферійний файл із низьким in-degree») недосяжний — `file_edges` є, але фасад віддає тільки верх рангу й ланцюги (`repo-intel/types.ts:174-180`). *If accepted:* крок 2 отримує другий підпункт, крок 6 — третій збирач сигналів, крок 16 — юніт на нього. **Default: as requested** (два сигнали з трьох; AC-19 — whitelist, а не мандат).
- **R3. Не піднімати `stats.bounded` у статус індексу конвеєра.** *Чому:* спокуса «полагодити» `pipeline/full.ts:253-259`, щоб AC-28 читався буквально, зачепить blast, conventions і review — усіх, хто читає `IndexState.status`, і зробить обрізаний, але справний індекс схожим на зламаний. *If accepted:* нічого не змінюється — це вже дефолт плану (D2). **Default: as requested.**
- **R4. Не додавати токени й вартість на дріт.** *Чому:* спека вже це відхилила (NFR Contracts (вартість)), і додавання поля означало б дзеркалити його в обидві копії заради числа, якого екран не показує. *If accepted:* нічого не змінюється. **Default: as requested.**
- **R5. Стилі `.dd-md` для заголовків у `body`.** *Чому:* `client/INSIGHTS.md` (2026-08-05) — примітив `Markdown` мапить лише `p/strong/code/a`, тож `##` у тілі секції відрендериться як звичайний абзац і картка виглядатиме стіною тексту, хоча промт просить підзаголовки. *If accepted:* один блок правил у `client/src/app/globals.css` (не у вендорованому примітиві) у складі кроку 11. **Default: as requested.**

## Constraints that bind this change

- **Чи щось перетинає дріт?** Так. `Onboarding` розширюється (`status`, `reason`, `generated_at`, `index`), `OnboardingSection.kind` звужується до `z.enum` із п'яти значень, додається `OnboardingIndexSummary`. Обидві копії — `server/src/vendor/shared/contracts/knowledge.ts` і `client/src/vendor/shared/contracts/knowledge.ts` — рухаються **одним кроком (крок 1)**, ніколи двома. Дзеркалиться блок `Onboarding*`, не весь файл (D4).
- **Контракти Zod-first.** `params` і `body` оголошуються на роуті (`IdParams`, `OnboardingGenerateBody`); `Schema.parse(req.body)` у хендлері немає. Та сама схема `Onboarding` серіалізує відповідь (`schema.response[200]`, як радить `_shared/schemas.ts:13-24`). Збережений jsonb читається `safeParse`-ом (`parse-never-trust-json`): неспарсений рядок трактується як «тура немає», а не як 500.
- **Міграції.** **Не потрібні.** Таблиця `onboarding` існує з `0000_init.sql:205` і має рівно потрібну форму (`repo_id` PK, `json`, `generated_at`). Нових таблиць і колонок немає, `pnpm db:generate` не запускається, застосовані `.sql` не редагуються. Skeleton у таблицю не пишеться (AC-23), тож «рядка немає» однозначно означає «тур ще не генерували».
- **Тестова лінія.** Тести з Postgres — `server/test/onboarding.it.test.ts` (`.it.test.ts`, крок 17); чисті хелпери — `server/test/onboarding-*.test.ts` без контейнера (крок 16). Плутанина лінією тиха: `verify.mjs:117` виключає `**/*.it.test.ts` з юніт-лінії.
- **Пакетний менеджер по кроках.** Кроки 1-8, 15-17 → `server/` pnpm; кроки 1, 9-13, 18 → `client/` pnpm; крок 14 → `e2e/` npm. Установка в корені не робить нічого.
- **`reviewer-core` не зачіпається** — тур не бере участі в прогоні рев'ю (Non-goal), у промт агента не потрапляє, JS не емітується.
- **Do-not-touch.** `server/clones/**` — не чіпається (читання тільки через `readInsideClone`, запису немає). Застосовані `src/db/migrations/*.sql` — не чіпаються (міграції не потрібні). `**/src/vendor/ui/**` — **чіпається рівно один файл**, `client/src/vendor/ui/nav.ts`, як **declared vendor update**: рядок `Vendor-update: client/src/vendor/ui/nav.ts` у тілі PR, форма коментаря — за зразком `nav.ts:21-38`, виконавець — людина/головна сесія (D10), бо `.claude/settings.json:9-12` забороняє це і агенту, і сесії. Обхід через `Bash` — саме те, що це правило існує зупинити.
- **Шарування.** Новий модуль лягає рівно в наявну анатомію; жоден крок не перетинає межу: роут не бачить `db/schema` (`routes-through-service`), сервіс/хелпери не імпортують `fastify` (`service-stays-http-agnostic`, тому D8), модуль дістає `repoIntel` і `llm` лише через контейнер (`no-direct-adapter-clients`), а до чужих модулів звертається тільки через `_shared/clone-fs.ts` і `settings/index.ts` (`no-cross-module-internals`). Крок 2 править `repo-intel/types.ts` — це публічна поверхня модуля, не його нутрощі.

## Steps

| # | Change | Files / seams | Slice | Satisfies | Depends on | Executor | Skills the executor applies | Verification |
|---|--------|---------------|-------|-----------|------------|----------|-----------------------------|--------------|
| 1 | Розширити `Onboarding` (`status`, `reason`, `generated_at`, `index`), звузити `OnboardingSection.kind` до `z.enum` п'яти значень, додати `OnboardingIndexSummary`/`OnboardingStatus`/`OnboardingSkeletonReason`. **Обидві копії в одному кроці**; дзеркалиться блок `Onboarding*` (рядки 28-47), не файл | `server/src/vendor/shared/contracts/knowledge.ts:28-47`, `client/src/vendor/shared/contracts/knowledge.ts:28-47` | contracts | AC-9, AC-30, AC-31 | — | `implementer` (лейн A) | `zod` | `node scripts/verify.mjs --slice backend --slice frontend` |
| 2 | Адитивно додати `totalCandidates`, `bounded` в `IndexState` і мапінг зі `stats` у `tryGetIndexState`; синтезований деградований стан → `0`/`0` | `server/src/modules/repo-intel/types.ts:42-50`, `.../repository.ts:212-233`, `.../service.ts:192-204` | backend | AC-6, AC-28 | — | `implementer` (лейн A) | `onion-architecture`, `drizzle-orm-patterns` | `node scripts/verify.mjs --slice backend` |
| 3 | `constants.ts` + `types.ts` модуля: `SECTION_KINDS` (порядок = контракт), `RUN_CONFIG_FILES`, `MAX_MANIFEST_DIRS`, `TOP_FILES_N`, `CRITICAL_FILES_SHOWN`, `READING_PATH_LEN`, `MAX_FIRST_TASKS`, `TASK_SCAN_FILES`, `MAX_FILE_BYTES`, `SCHEMA_NAME`, `NO_PROVIDER_KEY_CODE`, `SKELETON_REASONS`; внутрішні типи `OnboardingFacts`, `OnboardingTelemetry`, `StoredTour` | `server/src/modules/onboarding/{constants,types}.ts` (нові) | backend | AC-9, AC-13, AC-17, AC-19, AC-23 | 1 | `implementer` (лейн A) | `onion-architecture` | `node scripts/verify.mjs --slice backend` |
| 4 | Чисті хелпери (без контейнера, без I/O): драфт-схема `OnboardingDraft` (D6), `orderReadingPath` (ранг спадно, модель дає лише `rationale`), `collectTaskSignals` над уже прочитаним текстом, `filterToKnownPaths` (за зразком `verifyCandidates`), `normalizeDiagram` (null скрізь, крім `architecture_overview`), `buildSkeleton(reason, facts)`, `deriveIndexSummary(state)` (D2), `onboardingLogFields(telemetry)` (D8), `parseStoredTour` (safeParse) | `server/src/modules/onboarding/helpers.ts` (новий) | backend | AC-9, AC-11, AC-13, AC-17, AC-18, AC-19, AC-20, AC-21, AC-22, AC-28, AC-33, AC-34 | 1, 3 | `implementer` (лейн A) | `onion-architecture`, `zod` | `node scripts/verify.mjs --slice backend` |
| 5 | Репозиторій: `getTour(repoId)`, `upsertTour(repoId, stored)` (`ON CONFLICT (repo_id) DO UPDATE` — повний перезапис рядка + `generated_at`), `repoBasics(workspaceId, repoId)` (`full_name`, `default_branch`, `clone_path`), усе scoped `workspaceId`. Підсумок індексу зберігається ВСЕРЕДИНІ `json` | `server/src/modules/onboarding/repository.ts` (новий), читає `src/db/schema/context.ts:120-126`, `src/db/schema/repos.ts:13-16` | backend | AC-4, AC-5, AC-29 | 1, 3 | `implementer` (лейн A) | `drizzle-orm-patterns`, `onion-architecture` | `node scripts/verify.mjs --slice backend` |
| 6 | Сервіс: `getTour` (кеш або порожній стан або skeleton, нуль викликів моделі) і `generate` (збір фактів → ОДИН `completeStructured` → пост-валідація → запис). Факти: `repoIntel.getTopFilesByRank`/`getCriticalPaths`/`getIndexState` через контейнер + читання клону через `readInsideClone` (корінь `realpath`-нутий один раз); `RUN_CONFIG_FILES` + `<seg>/package.json` до `MAX_MANIFEST_DIRS`; сигнали `first_tasks` — `TODO`/`FIXME` у топ-`TASK_SCAN_FILES` і проба сусіднього тесту. Skeleton-гілки: немає клону / не проіндексовано / `repoIntelEnabled=false` / `degraded` / `failed` / `llm_failed`; skeleton не зберігається. `NoProviderKeyError` (409) з `ConfigError` при `container.llm(provider)`. Повертає `{ tour, telemetry }` | `server/src/modules/onboarding/service.ts` (новий); seams: `container.repoIntel`, `container.llm`, `container.config.repoIntelEnabled`, `../_shared/clone-fs.js`, `../settings/index.js` (`resolveFeatureModel`), `../../platform/prompts.js` | backend | AC-3, AC-4, AC-5, AC-15, AC-16, AC-19, AC-21, AC-23, AC-25, AC-26, AC-27, AC-29, AC-36, AC-39, AC-40 | 2, 3, 4, 5 | `implementer` (лейн A) | `onion-architecture`, `zod` | `node scripts/verify.mjs --slice backend` |
| 7 | Роути `GET /repos/:id/onboarding` і `POST /repos/:id/onboarding/generate` (`params: IdParams`, `body: OnboardingGenerateBody` з `locale?`, `response[200]: Onboarding`) + один рядок у `src/modules/index.ts` + ЄДИНИЙ `app.log.info(onboardingLogFields(telemetry), …)` на обидві гілки | `server/src/modules/onboarding/routes.ts` (новий), `server/src/modules/index.ts:14,42` | backend | AC-27, AC-32, AC-33, AC-35, AC-36 | 6 | `implementer` (лейн A) | `fastify-best-practices`, `onion-architecture`, `zod` | `node scripts/verify.mjs --slice backend` |
| 8 | Промт: п'ять секцій із `SECTION_KINDS` замість `architecture`/`routes_and_apis`; діаграма дозволена лише в `architecture_overview`; блок `<untrusted>` і правило «не перекладати ідентифікатори» лишаються; `{{sections}}`/`{{language}}` подаються з коду | `server/src/prompts/onboarding.system.md:1-44` | backend | AC-9, AC-11, AC-36, AC-40 | 3 | `implementer` (лейн A) | `onion-architecture` | `node scripts/verify.mjs --slice backend` |
| 9 | `activeKeyFor` розрізняє два шляхи: `/repos/<id>/onboarding` → `onboarding-tour`, голий `/onboarding` → `""`. Порядок перевірок у функції зберегти | `client/src/components/app-shell/helpers.ts:26-40` | frontend | AC-2 | — | `implementer` (лейн B) | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` | `node scripts/verify.mjs --slice frontend` |
| 10 | Хуки/API: `useOnboardingTour(repoId)` (query) і `useGenerateOnboardingTour(repoId)` (mutation з інвалідацією ключа), увесь доступ через `apiFetch` | `client/src/lib/hooks/onboarding.ts` (новий), іменований реекспорт у `client/src/lib/hooks/index.ts` | frontend | AC-3, AC-4, AC-5, AC-8 | 1 | `implementer` (лейн B) | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` | `node scripts/verify.mjs --slice frontend` |
| 11 | Екран: тонка `page.tsx` + `_components/OnboardingTourView/{OnboardingTourView.tsx,constants.ts,styles.ts,helpers.ts,index.ts}`. Підзаголовок (файли коду з кандидатів, статус індексу, коли згенеровано), `Share link`, згортані картки + `ON THIS PAGE` з активним пунктом, стан завантаження з дизейблом кнопки, порожній стан і окремий skeleton-CTA, `critical_paths` з `Open` через `githubBlobUrl(full_name, default_branch, path)`, нумеровані команди з кнопкою копіювання (доступна назва включає команду), `first_tasks` з чесним «сигналів не знайдено», `MermaidDiagram` лише в `architecture_overview`, `body` через примітив `Markdown` | `client/src/app/repos/[repoId]/onboarding/**` (нове); перевикористовує `client/src/components/mermaid-diagram/`, `@devdigest/ui` `Markdown`, `client/src/lib/github-urls.ts:24-37` | frontend | AC-1, AC-6, AC-7, AC-8, AC-10, AC-12, AC-13, AC-14, AC-15, AC-20, AC-22, AC-24, AC-38 | 1, 10 | `implementer` (лейн B) | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` | `node scripts/verify.mjs --slice frontend` |
| 12 | Рядки інтерфейсу — у наявний неймспейс `messages/en/onboarding.json` (він уже містить `title`, `regenerate`, `generate.*`, `loadError.*` і нікуди не підключений); жодного літерала в компонентах | `client/messages/en/onboarding.json` | frontend | AC-37 | 11 | `implementer` (лейн B) | `frontend-ui-architecture` | `node scripts/verify.mjs --slice frontend` |
| 13 | Рядок `NAV` у `WORKSPACE` між `Pull Requests` і `Project Context`: `{ key: "onboarding-tour", label: "Onboarding Tour", icon: <IconName>, href: "/repos/:repoId/onboarding", gKey: <вільна літера> }` + абзац у коментарі declared-vendor-update. **Поза агентським ланцюгом** (`.claude/settings.json:9-12`, root `INSIGHTS.md` 2026-08-18); PR несе `Vendor-update: client/src/vendor/ui/nav.ts` | `client/src/vendor/ui/nav.ts:21-55` | frontend | AC-1 | 9 | **`main session` / людина** | — (declared vendor update, `routing.md` § Slices; жоден скіл не переглядає `vendor/ui`) | `node scripts/verify.mjs --slice frontend` + `node scripts/pr-gate-ci.mjs` |
| 14 | e2e-флоу `11-onboarding-tour.flow.json`: із списку PR перейти сайдбаром на `Onboarding Tour`, дочекатись `/onboarding`, ствердити skeleton-CTA на засіяному (клон без індексу) стенді; **06-й флоу не редагується**. Рядок у таблиці покриття `e2e/README.md` | `e2e/specs/11-onboarding-tour.flow.json` (новий), `e2e/README.md` | e2e | AC-1, AC-24 | 11, 13 | `implementer` (лейн C) | — (`routing.md`: `e2e` — лише детерміновані гейти, скіл-рев'ю не запускається) | `./scripts/e2e.sh` |
| 15 | Інтеграційний прохід по швах між лейнами (root `INSIGHTS.md` 2026-08-04): метод+шлях роуту проти хука, форма `Onboarding` проти рендера, збіг обох копій контракту, `pnpm arch`, повний прогін трьох ліній | шви: `routes.ts` ↔ `lib/hooks/onboarding.ts`; `knowledge.ts` (обидві копії) ↔ `OnboardingTourView` | backend, frontend | AC-1, AC-4, AC-30, AC-32 | 7, 11, 13 | `implementer` (лейн A, після злиття лейнів) | `onion-architecture`, `frontend-ui-architecture` | `node scripts/verify.mjs --slice backend --slice frontend --slice integration` |
| 16 | Юніт-тести сервера з `· verify:`-підказок спеки — чисті хелпери без контейнера | `server/test/onboarding-helpers.test.ts`, `server/test/onboarding-facts.test.ts` (нові) | backend | AC-11, AC-13, AC-16, AC-17, AC-18, AC-19, AC-21, AC-22, AC-31, AC-34, AC-39, AC-40 | 15 | `test-writer` | `onion-architecture` | `node scripts/verify.mjs --slice backend` |
| 17 | Інтеграційні тести сервера — підміна `llm` і `repoIntel` через `ContainerOverrides`, лічильник `MockLLMProvider.calls`, спай на `app.log.info` | `server/test/onboarding.it.test.ts` (новий) | backend | AC-3, AC-4, AC-5, AC-9, AC-15, AC-23, AC-25, AC-26, AC-27, AC-28, AC-29, AC-30, AC-32, AC-33, AC-35, AC-36 | 15 | `test-writer` | `onion-architecture` | `node scripts/verify.mjs --slice integration` |
| 18 | RTL-специфікації клієнта, включно з sentinel-тестом на i18n (D9) і юнітом на `activeKeyFor` | `client/src/app/repos/[repoId]/onboarding/_components/OnboardingTourView/OnboardingTourView.test.tsx`, `client/src/components/app-shell/helpers.test.ts` (нові) | frontend | AC-1, AC-2, AC-3, AC-6, AC-7, AC-8, AC-10, AC-12, AC-13, AC-14, AC-15, AC-20, AC-24, AC-37, AC-38 | 15 | `test-writer` | `react-testing-library`, `frontend-ui-architecture` | `node scripts/verify.mjs --slice frontend` |
| 19 | Документація по вже збудованій поведінці: карта роутів у `server/README.md`, карта сторінок у `client/README.md`, згадка модуля там, де перелічені модулі. Це scaffolding для виявності AC-1/AC-32, власного AC не має | `server/README.md`, `client/README.md` | meta | — (scaffolding для AC-1, AC-32) | 16, 17, 18 | `doc-writer` | — (`routing.md`: `meta` — скіл-рев'ю не запускається) | «no lane — reviewed by reading» |

## Execution

**Хвиля 1 — блокуюча.** Крок 1 (контракти) виконує лейн A і **завершує його до старту лейнів B і C**: обидві копії `@devdigest/shared` рухаються однією зміною, і клієнтська копія — єдиний файл під `client/`, якого лейн B не торкається взагалі.

**Хвиля 2 — паралельно.** Лейн A (кроки 2-8) і лейн B (кроки 9-12) йдуть одночасно; крок 13 людина робить у будь-який момент після кроку 9; лейн C (крок 14) стартує після кроків 11 і 13, бо флоу ходить сайдбаром.

**Хвиля 3.** Крок 15 (інтеграція) — один `implementer` на злитому дереві. Далі стадія рев'ю: `architecture-reviewer` ∥ `/code-review`, цикл виправлень.

**Хвиля 4.** `test-writer` — кроки 16-18 (можуть іти паралельно між собою: різні пакети, різні файли). Потім `plan-verifier` **один раз** на усталеному дереві, з таблицею трасування нижче. Потім `doc-writer` (крок 19), далі `/pr-self-review`.

Головна сесія комітить між стадіями і сама виконує крок 13 — жоден субагент не може.

### Ownership

| Лейн | Володіє (пише) | Не торкається |
|---|---|---|
| **A — server** | `server/src/vendor/shared/contracts/knowledge.ts`, `client/src/vendor/shared/contracts/knowledge.ts` (**лише крок 1**), `server/src/modules/onboarding/**`, `server/src/modules/index.ts`, `server/src/modules/repo-intel/{types,repository,service}.ts`, `server/src/prompts/onboarding.system.md` | усе під `client/` після кроку 1; `e2e/**`; `server/test/**` (це `test-writer`) |
| **B — client** | `client/src/app/repos/[repoId]/onboarding/**`, `client/src/lib/hooks/onboarding.ts`, `client/src/lib/hooks/index.ts`, `client/src/components/app-shell/helpers.ts`, `client/messages/en/onboarding.json`, `client/src/app/globals.css` (лише якщо прийнято R5) | `client/src/vendor/**` (обидва — і `shared`, і `ui`); `server/**`; `e2e/**`; будь-які `*.test.tsx` (це `test-writer`) |
| **C — e2e** | `e2e/specs/11-onboarding-tour.flow.json`, `e2e/README.md` | усе інше |
| **Людина / головна сесія** | `client/src/vendor/ui/nav.ts` | — |

**Інтеграційний крок (15) обов'язковий і не зливається з жодним лейном.** Він
перевіряє рівно ті шви, які юніт-тести з обох боків підтверджують самі собі за
побудовою: метод і шлях роуту проти того, що кличе хук; форма `Onboarding` у
відповіді проти того, що читає компонент; збіг блоку `Onboarding*` в обох копіях
контракту.

**Що несе кожен handoff:** ім'я плану (`.claude/plans/l05-sdd-onboarding-generator.md`),
номери кроків цього лейна, і — для `test-writer` і `plan-verifier` — звіт
попереднього `implementer` (виконані кроки, відхилення) плюс таблицю трасування нижче.

## Contract & migration impact

**Перетинає дріт:**

- `OnboardingSection.kind`: `z.string()` → `z.enum(['architecture_overview','critical_paths','run_locally','reading_path','first_tasks'])`. Це **звуження** — старе значення, збережене у наявному jsonb, не пройде; чинних рядків у таблиці немає (порожня з `0000_init.sql`), тож ризик нульовий, але `parseStoredTour` усе одно робить `safeParse` і трактує невдачу як «тура немає».
- `Onboarding`: `+ status: z.enum(['ready','skeleton'])`, `+ reason: OnboardingSkeletonReason.nullish()`, `+ generated_at: z.string().nullish()`, `+ index: OnboardingIndexSummary`.
- `OnboardingIndexSummary` (новий): `files_indexed`, `total_candidates`, `bounded`, `status` (`full|partial|degraded|failed`).
- Тіло `POST`: `OnboardingGenerateBody { locale?: string }` — запит, не частина `Onboarding`.
- **Обидві копії рухаються кроком 1.** Дзеркалиться блок `Onboarding*` (рядки 28-47); решта файла лишається розбіжною, як і була.
- **Токени й вартість на дріт НЕ виходять** (NFR Contracts (вартість)) — вони тільки в рядку логу.

**Міграції: жодної.** `onboarding` (`repo_id` PK, `json` jsonb, `generated_at`) уже
має потрібну форму (`server/src/db/schema/context.ts:120-126`, `0000_init.sql:205`).
`pnpm db:generate` не запускається, застосовані `.sql` не редагуються. Побічний
ефект кроку 2 (`IndexState`) — суто типовий: колонка `stats` уже існує й уже
заповнюється, змінюється лише те, що з неї мапиться.

## Verification plan

- `node scripts/verify.mjs --slice backend` — кроки 1-8, 15, 16 (typecheck · depcruise `src ../reviewer-core/src` · vitest unit; лінія `.github/workflows/server-unit.yml`).
- `node scripts/verify.mjs --slice frontend` — кроки 1, 9-13, 15, 18 (typecheck · depcruise · `check-ui-conventions` · vitest; `client.yml`).
- `node scripts/verify.mjs --slice integration` — кроки 15, 17 (`vitest .it.test`; `server-integration.yml`). Власний Postgres піднімають testcontainers і самі ганяють міграції (`server/test/helpers/pg.ts:34-51`) — `pnpm db:migrate` для цієї лінії не потрібен; він потрібен лише для ручного прогону проти dev-БД.
- `./scripts/e2e.sh` — крок 14. `verify.mjs` цієї лінії не покриває (`verify.mjs:26-32`), і ганяти `npm test` у `e2e/` проти dev-БД не можна (`e2e/AGENTS.md`).
- `node scripts/pr-gate-ci.mjs` — крок 13: перевіряє, що `Vendor-update:` у тілі PR називає саме `client/src/vendor/ui/nav.ts` (файл, не директорію). `verify.mjs` цього не покриває (`pr-gate.yml`).
- Крок 19 (`meta`) — коду не має: «no lane — reviewed by reading». Статус спеки на `implemented` переводить людина після мержу; `node scripts/check-specs.mjs` — гейт саме на це.

### Traceability matrix (skeleton — `plan-verifier` заповнює колонку **Test**)

| AC | Step(s) | Verify lane | Test |
|---|---|---|---|
| AC-1 | 11, 13, 14 | frontend, e2e | |
| AC-2 | 9 | frontend | |
| AC-3 | 6, 11 | integration, frontend | |
| AC-4 | 5, 6, 10 | integration | |
| AC-5 | 5, 6, 10 | integration | |
| AC-6 | 2, 4, 11 | backend, frontend | |
| AC-7 | 11 | frontend | |
| AC-8 | 10, 11 | frontend | |
| AC-9 | 1, 3, 4, 8 | backend, integration | |
| AC-10 | 11 | frontend | |
| AC-11 | 4, 8 | backend | |
| AC-12 | 11 | frontend | |
| AC-13 | 3, 4, 11 | backend, frontend | |
| AC-14 | 11 | frontend | |
| AC-15 | 6, 11 | integration, frontend | |
| AC-16 | 6, 11 | backend | |
| AC-17 | 4 | backend, integration | |
| AC-18 | 4 | backend | |
| AC-19 | 3, 4, 6 | backend, integration | |
| AC-20 | 4, 11 | backend, frontend | |
| AC-21 | 4, 6 | backend, integration | |
| AC-22 | 4, 11 | backend | |
| AC-23 | 4, 6 | integration | |
| AC-24 | 11, 14 | frontend, e2e | |
| AC-25 | 6 | integration | |
| AC-26 | 6 | integration | |
| AC-27 | 6, 7 | integration | |
| AC-28 | 2, 4 | integration | |
| AC-29 | 5, 6 | integration | |
| AC-30 | 1, 15 | integration | |
| AC-31 | 1 | backend | |
| AC-32 | 7 | integration | |
| AC-33 | 4, 7 | integration | |
| AC-34 | 4 | backend | |
| AC-35 | 4, 7 | integration | |
| AC-36 | 6, 7, 8 | integration | |
| AC-37 | 12 | frontend | |
| AC-38 | 11 | frontend | |
| AC-39 | 6 | backend | |
| AC-40 | 6, 8 | backend | |

## Out of scope / left to reviewers

Рев'ю архітектури (`architecture-reviewer`), полювання на баги (`/code-review`),
безпека (`/security-review`), відкриття PR (`/pr-self-review`) і переведення
`Status:` спеки в `implemented` — не кроки цього плану.

Non-goals SPEC-03, дослівно:

- **Автоматична генерація при першому відкритті** — тур створюється лише за явною дією (interview: Q1).
- **Персоналізація на користувача або на роль** — один тур на репозиторій, спільний для всіх (interview: Q1).
- **Тур під конкретний PR або задачу** (interview: Q1).
- **Публічний шеринг** — `Share link` копіює поточний URL сторінки в буфер обміну; ні нового маршруту, ні анонімного доступу, ні токена (interview: Q1).
- **Вбудований переглядач файлів** — `Open` веде на GitHub у новій вкладці (interview: додаткові дефолти).
- **Зміна `repo-intel`** — ні `MAX_INDEXED_FILES`, ні формула рангу, ні глибина клону не чіпаються цією фічею (interview: Q3 + додаткові дефолти).
- **Увімкнення `hotness`** — `rank = pagerank`, `hotness = 0`, бо клон shallow (`CLONE_DEPTH = 1`); формула із запиту `PageRank × (1 + hotness)` сьогодні згортається до PageRank і лишається інваріантом.
- **Другий LLM-виклик під будь-яку секцію** — зокрема під діаграму, під «перші задачі» чи під переклад.
- **Редагування тура користувачем** — у цьому лесоні тур лише читається й перегенеровується цілком.
- **Онбординг як окремий агент або скіл** — це системна фіча сторінки, вона не бере участі в прогоні рев'ю і не потрапляє в промт агента.
- **Ембединги, чанкінг і семантичний пошук по репозиторію.**

Примітка до третього з кінця: крок 2 додає в `IndexState` два адитивні поля й
мапінг уже наявної колонки. Це не жодна з трьох поіменованих у Non-goal речей,
але формально це редагування файлів `repo-intel` — рев'юер має побачити це
свідомо, тому воно винесене окремим кроком, а не всередині кроку 6.

## Risks

- **Найдорожчий ризик — крок 13.** Рядок `NAV`, відданий агенту, не виконуваний: `.claude/settings.json:9-12` відмовить і субагенту, і головній сесії, а обхід через `Bash` — саме той байпас, проти якого правило й стоїть. Це вже коштувало стадії в попередньому прогоні L05 (root `INSIGHTS.md`, 2026-08-18). **Найдешевший ранній сигнал:** крок 14 (e2e) падає на `find text "Onboarding Tour" click` — сайдбар не має пункту. Ще раніше — крок 18 (RTL на активний пункт).
- **Кроки 2 і 4 можуть розійтися в тому, ЩО означає `partial`.** Якщо крок 4 забуде D2 і візьме `state.status` напряму, AC-28 тихо не виконається на будь-якому репозиторії понад 5000 файлів коду — а таких у тесті може не бути. **Сигнал:** інтеграційний тест AC-28 із `repoIntel`-мок-станом `{status:'full', bounded: 42}` мусить очікувати `index.status === 'partial'`; це має бути перший тест кроку 17.
- **Пост-валідація може вирізати ВСЕ.** Якщо факти зібрані бідно (клон є, індексу нема), дозволений набір шляхів малий, і кожне посилання моделі відкидається — тур виглядатиме порожнім, хоча статус `ready`. **Сигнал:** лічильник відкинутого в `telemetry` (за зразком `dropped_no_evidence` у conventions) у тому самому рядку логу; аномально високе число видно з першої ручної генерації.
- **Модель проігнорує п'ять `kind` і промт розійдеться з контрактом.** Пом'якшено структурно (D6: драфт-схема ключована за `kind`), але промт і `SECTION_KINDS` живуть у різних файлах. **Сигнал:** крок 8 подає `{{sections}}` ЗІ `SECTION_KINDS`, а не текстом — розбіжність стає неможливою; юніт кроку 16 стверджує, що відрендерений промт містить усі п'ять і жодного зайвого.
- **Читання клону під `first_tasks` може вийти дорогим.** `TASK_SCAN_FILES` читань по `MAX_FILE_BYTES` — це верхня межа, але її легко поставити надто високою. **Сигнал:** `durationMs` у рядку логу генерації; якщо він росте з розміром репозиторію більше, ніж лінійно від `TASK_SCAN_FILES` — межа не тримає.
- **RTL на `MermaidDiagram` у jsdom.** Примітив імпортує `mermaid` ліниво й рендерить у `useEffect`; тест AC-12 має стверджувати ВІДСУТНІСТЬ вузла, а не наявність — інакше він пройде з неправильної причини. **Сигнал:** тест, що проходить і на валідній, і на невалідній діаграмі, — неправильний тест.

## Open questions

- **Q-A. Чи приймається адитивна зміна `IndexState` (крок 2)?** Дефолт, який виконавець бере: **так** — `totalCandidates`/`bounded` додаються в `repo-intel/types.ts` і мапляться в `tryGetIndexState`; `MAX_INDEXED_FILES`, формула рангу і глибина клону не чіпаються. Альтернатива (онбординг читає `repo_index_state` власним репозиторієм) відкинута як така, що дублює read-model фасаду.
- **Q-B. Чи достатньо виводити `index.status = 'partial'` в онбордингу, не чіпаючи конвеєр?** Дефолт: **так** (D2). Конвеєр (`pipeline/full.ts:253-259`) не змінюється, бо `IndexState.status` читають ще blast, conventions і review.
- **Q-C. Як перевіряти NFR «≤ 300 мс p95»?** Дефолт: не перевіряти час, а перевірити структуру шляху — один `SELECT` по PK + один `getIndexState`, нуль читань клону, нуль викликів провайдера (`*.it.test.ts`). Гарнітури p95 план не додає.
- **Q-D. Яка іконка й яка `gKey` для рядка `NAV`?** Дефолт: іконка з наявного набору `client/src/vendor/ui/icons` за змістом («Compass»/«Map»/«BookOpen» — та, що існує), `gKey` — вільна літера, що не конфліктує з `p`, `x`, `s`, `c`, `a`, `,`. Обидва — оборотні рішення на клавіатурі, тому не блокують.
- **Q-E. Скільки саме файлів показують `critical_paths` і `reading_path`?** Дефолт: `CRITICAL_FILES_SHOWN = 4` (за макетом), `READING_PATH_LEN = 6`, `MAX_FIRST_TASKS = 5`, `TOP_FILES_N = 12`, `TASK_SCAN_FILES = 20`, `MAX_MANIFEST_DIRS = 5`. Спека прямо каже, що ці межі — «деталь плану, а не контракт» (Open questions, останній рядок), тож вони живуть у `constants.ts` і змінюються без зміни дроту.

## Cross-model review (19/08/2026) — accepted amendments

Reviewed by an independent model before implementation. Verdict: **APPROVE WITH
CHANGES**. Every finding below is **accepted** and **overrides** the matching step
row / decision above where the two disagree. `implementer`, `test-writer` and
`plan-verifier` read the steps *together with* this section.

| # | Sev | Amendment (binding) | Steps touched |
|---|-----|---------------------|---------------|
| A1 | MAJOR | `server/test/contracts.test.ts:152-165` parses `Onboarding` with `kind: 'architecture'` and no `status`/`index` — step 1 must update that fixture (lane A may write **only this file** under `server/test/`). Add the mirror-on-disk assertion for the `Onboarding*` block in the style of `contracts.test.ts:356-373` (AC-30 "both copies" becomes a real test). | 1 (Files + Ownership) |
| A2 | MAJOR | Draft schema (D6) must survive strict `json_schema` mode (`openai.ts:104-107`, `server/INSIGHTS.md:259`): **no `z.record`, no `.optional()`** anywhere in `OnboardingDraft`; `diagram: z.string().nullable()` only on `architecture_overview`; `reading_path` is `z.array(z.object({ path, rationale }))` and the code re-maps rationales onto the `getTopFilesByRank` order (model order ignored — AC-17). Step 16 adds a unit asserting the JSON schema has `additionalProperties:false` on every object and every property required. | 4, 16 |
| A3 | MAJOR | Prompt size is bounded: step 3 adds `MAX_PROMPT_FILE_CHARS` (per-file excerpt) and `MAX_PROMPT_TOTAL_CHARS` (total); step 4 adds pure `clipForPrompt`; `<untrusted>` wrapping uses `wrapUntrusted` from `platform/prompt.ts:6-11`, not hand-rolled tags; step 16 asserts the rendered user message length bound. | 3, 4, 6, 16 |
| A4 | MAJOR | AC-27 it-test must not hit the network: the 409 case builds the app with `overrides.secrets = new MockSecretsProvider({})` (`mocks.ts:325`) and **no** `llm.openrouter` override; every other case injects `llm: { <provider>: new MockLLMProvider(...) }` on the slot the feature model resolves to. | 17 |
| A5 | MINOR | D2 formula is `index.status = state.status === 'full' && bounded > 0 ? 'partial' : state.status` (never masks `degraded`/`failed`). Step 17 tests both `{status:'full', bounded:42}` → `partial` and `{status:'degraded', bounded:42}` → `degraded`. | 4, 17 |
| A6 | MINOR | D3 discriminator: client branches on `generated_at === null` (never on `sections.length`); server guarantees `status:'ready'` ⇒ (`generated_at` non-null ∧ exactly 5 sections) ∨ (`generated_at` null ∧ `sections: []`). AC-3 tests assert `generated_at === null`. R1 (`'empty'`) stays **not adopted** (needs a spec revision). | 6, 11, 17, 18 |
| A7 | MINOR | Locale transport: the mutation **always** sends a body `{ locale }` from `useLocale()` (`api.post`), route declares `body: OnboardingGenerateBody` (required object, `locale` optional, default `en`); update the stale "body-less POST" comment in `client/src/lib/api.ts:24-30`. Step 17 asserts the sent messages contain the locale. | 7, 10, 17 |
| A8 | MINOR | `onboardingLogFields` carries `provider`, `model`, `calls`, `attempts`, `tokensIn`, `tokensOut`, `costUsd`, `droppedPaths`, `repoId`, `durationMs` (+ `reason` on the skeleton line, AC-35). In `NODE_ENV=test` the app logger is `false` (`app.ts:50-52`) — step 17 spies on `app.log.info` of the built app, not on pino output. | 4, 7, 17 |
| A9 | MINOR | Facts collection and message assembly are module-private files testable without Postgres: `server/src/modules/onboarding/facts.ts` exporting `collectFacts({ repoIntel, root, read })` and `buildTourMessages(facts, language, systemPrompt)` in `helpers.ts`. AC-39/AC-40 units use a temp dir + symlink and a fake `repoIntel` object. | 4, 6, 16 |
| A10 | MINOR | Skeleton reason derivation, in this order: `!clonePath → 'no_clone'`; `!config.repoIntelEnabled → 'disabled'`; `degradedReason === 'no_data' → 'not_indexed'`; `status ∈ {degraded, failed} → that status`; model failure → `'llm_failed'`. GET order: stored row wins (AC-5/AC-29) → skeleton → empty. | 6 |
| A11 | MINOR | NAV icon must be an existing `IconName` (`icons.tsx:86-167`): use `Workflow` (fallback `Layers`); `gKey: "o"`. | 13 |
| A12 | MINOR | e2e flow: `set viewport 1280 900` first, navigate with `find role link --name "Onboarding Tour"` (not find-text click — `e2e/INSIGHTS.md:14-30`), assert the skeleton CTA text, not the page title. | 14 |
| A13 | MINOR | `client/messages/en/onboarding.json` has stale copy (`generate.body` lists a different section set) — step 12 **rewrites** existing keys, not only adds. | 12 |
| A14 | MINOR | Clone-read cost: neighbour-test probes use `maxBytes: 1` existence checks; the per-generation read bound (≈ `RUN_CONFIG_FILES` + `MAX_MANIFEST_DIRS` + `TASK_SCAN_FILES` + probes) is stated in `constants.ts` comments and asserted in step 16 via the fake `read` call counter. | 4, 6, 16 |
| A15 | MINOR | AC-20 gains a unit in step 16 (`collectTaskSignals`/skeleton with zero signals → section without tasks, nothing invented), in addition to the RTL spec in step 18. | 16 |

Agreed without change by the reviewer: D1, D4, D7, D9, D10, D11, R3, R4, R5 (R5 is
**adopted** — `.dd-md` heading styles in `globals.css`, step 11). R2 stays **not
adopted** for this run: AC-19 is a whitelist and signals 1–2 suffice; an in-degree
facade method is recorded as a follow-up.

### Traceability additions
AC-20 → steps 4, 16, 18 · AC-30 → steps 1 (contracts test), 6, 17 · AC-27 → step 17 (A4) · AC-33/AC-35 → steps 4, 7, 17 (A8).
