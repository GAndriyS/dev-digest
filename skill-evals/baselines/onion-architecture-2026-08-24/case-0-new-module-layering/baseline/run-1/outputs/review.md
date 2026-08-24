# Ревʼю модуля `exports` (перед вливанням у `server/src/modules/exports`)

Файли: `.claude/skills/onion-architecture-workspace/fixtures/exports-module/{routes,service,repository}.ts`

Загальний висновок: **не вливати в поточному вигляді**. Модуль не збереться (немає
таблиці, контрактів і двох файлів, на які він посилається), а ще він порушує три
`error`-правила dependency-cruiser із `server/.dependency-cruiser.cjs` — CI впаде
на `pnpm exec depcruise` ще до тестів. Плюс одна діра в тенансі, яку варто
розглядати як security-issue.

Нижче — проблеми, згруповані за критичністю. Для кожної: файл і рядок, чому це
проблема, як правильно.

---

## A. Блокери — код не збереться / не запуститься

### A1. Немає таблиці `exports` у схемі БД

**Де:** `repository.ts:20, 36, 46` (`t.exports`), `routes.ts:36` (`t.exports`)

**Проблема:** у `server/src/db/schema/` (`agents, ci, context, core, eval,
knowledge, ops, pulls, repo-intel, repos, reviews, runs, skills, _shared`) таблиці
`exports` не існує. `t.exports` — це `undefined` у типах, тобто TS-помилка в
кожному з чотирьох місць.

**Як правильно:** додати таблицю в новий файл `server/src/db/schema/exports.ts`
(колонки `id`, `workspaceId`, `prId`, `format`, `fileName`, `body`, `createdAt`,
з `references(...onDelete: 'cascade')` на `workspaces` і `pull_requests`, індекс
по `(workspace_id, pr_id)`), реекспортувати з `src/db/schema.ts`, згенерувати
міграцію `pnpm db:generate` і застосувати `pnpm db:migrate`. Уже застосовані
міграції в `src/db/migrations/*.sql` не редагувати.

### A2. Немає контрактів `ExportCreate` / `ExportRecord` / `ExportFormat`

**Де:** `routes.ts:4`, `service.ts:2`, `repository.ts:2`

**Проблема:** у `server/src/vendor/shared` (канонічна копія) немає жодного з цих
символів — імпорт із `@devdigest/shared` не резолвиться.

**Як правильно:** описати їх у `server/src/vendor/shared` як Zod-first контракти
(`export const ExportFormat = z.enum([...])`, `ExportCreate`, `ExportRecord`,
плюс `export type` через `z.infer`) і **віддзеркалити** в
`client/src/vendor/shared` — за `AGENTS.md` правити лише серверну копію без
дзеркалення заборонено, бо ці типи перетинають дріт.

### A3. `helpers.ts` і `constants.ts` у модулі відсутні

**Де:** `service.ts:7` (`./helpers.js` → `renderDigest`, `digestFileName`),
`service.ts:8` (`./constants.js` → `MAX_FINDINGS_IN_DIGEST`, `SUPPORTED_FORMATS`)

**Проблема:** у теці модуля лише три файли. Або їх забули додати до змін, або
вони ще не написані — у будь-якому разі PR у такому вигляді не збереться.
Коментар у `service.ts:15-16` каже, що рендеринг — чиста функція в `helpers.ts`;
це правильний намір, але код відсутній.

**Як правильно:** додати обидва файли. Зверни увагу, що `constants.ts` і
`types.ts` — це, за правилом `no-cross-module-internals`, **єдина публічна
поверхня** модуля для інших модулів, а `helpers.ts` — приватний. Тримати цю межу
свідомо.

### A4. `container.reviewRepo.listReviews(...)` не існує

**Де:** `service.ts:36`

**Проблема:** у `server/src/modules/reviews/repository.ts` метод називається
`reviewsForPull(prId)` — **один** аргумент, без `workspaceId` — і повертає
`{ review: ReviewRow; findings: FindingRow[] }[]`, а не масив рев'ю.

**Наслідок:** `service.ts:37` (`r.kind === 'review'`) ніколи не спрацює —
`kind` лежить на `r.review.kind`, а не на `r`. І `service.ts:48`
(`latest.findings`) читає поле з обгортки, якого там немає, — теж TS-помилка.

**Як правильно:**

```ts
const rows = await this.container.reviewRepo.reviewsForPull(prId);
const latest = rows.find((r) => r.review.kind === 'review');
// ...
findings: latest.findings.slice(0, MAX_FINDINGS_IN_DIGEST)
```

`reviewsForPull` не скоупиться по workspace навмисно — тенансі забезпечує
попередній `getPull(workspaceId, prId)` (`service.ts:33`). Це зроблено правильно,
але тільки за умови, що `workspaceId` заслуговує довіри — див. B1.

### A5. `pull.repoFullName` не існує на `PullRow`

**Де:** `service.ts:43`

**Проблема:** `PullRow = typeof t.pullRequests.$inferSelect` (`src/db/rows.ts:15`),
а таблиця `pull_requests` (`src/db/schema/pulls.ts:8-28`) має `repoId`, не
`repoFullName`. Повного імені репозиторію в рядку PR просто немає.

**Як правильно:** дістати репо окремо — `const repo = await
this.container.reviewRepo.getRepo(pull.repoId)` — і брати повне імʼя звідти
(з перевіркою на `undefined`).

### A6. `github.commitUrl(...)` не існує ні в порті, ні в адаптері

**Де:** `service.ts:43`

**Проблема:** `grep commitUrl` по `server/src` не дає жодного збігу. У порті
`GitHubClient` (`src/vendor/shared/adapters.ts:143-167`) такого методу немає, в
`OctokitGitHubClient` — теж.

**Як правильно:** пермалінк на коміт детермінований і мережі не потребує взагалі:

```ts
const permalink = `https://github.com/${repo.fullName}/commit/${pull.headSha}`;
```

Це прибирає з `create()` і виклик GitHub, і залежність від `GITHUB_TOKEN`
(`service.ts:40-41`), і робить експорт офлайновим — що краще пасує до
local-first. Якщо мережевий виклик усе ж потрібен (наприклад, перевірка
існування коміта), то метод треба спершу додати в порт `GitHubClient`, потім у
`OctokitGitHubClient` **і** в `src/adapters/mocks.ts`, інакше тести з мок-контейнером
зламаються.

### A7. Модуль ніде не зареєстрований

**Де:** відсутній запис у `server/src/modules/index.ts`

**Проблема:** реєстрація статична навмисно (коментар у `index.ts:22-25`). Без
`import exports from './exports/routes.js'` + запису в обʼєкт `modules` роути
просто не змонтуються, а `depcruise` додатково видасть `no-orphans` (`warn`) на
весь модуль як на недосяжний код.

**Як правильно:** один імпорт + один запис у `modules`. Обережно з іменем
біндингу: `exports` — зарезервоване слово в CJS-контексті, краще
`exportsModule` або `digests`.

---

## B. Тенансі і безпека

### B1. `workspaceId` береться з клієнтського заголовка — обхід `AuthProvider`

**Де:** `service.ts:26`

```ts
const workspaceId = req.headers['x-workspace-id'] as string;
```

**Проблема:** це найсерйозніша річ у PR. Заголовок `x-workspace-id` у кодовій базі
не зустрічається **ніде** — ні на сервері, ні в клієнті. Тобто:

1. Значення повністю контролює той, хто шле запит. Хто завгодно може підставити
   чужий `workspaceId` і зробити експорт із чужого PR — усі подальші перевірки
   (`getPull(workspaceId, prId)` на рядку 33) відпрацюють «чесно», але вже в
   чужому тенанті.
2. Клієнт цей заголовок не шле, тож у реальному житті там буде `undefined`,
   заретушований `as string`. Помилка спливе десь у SQL, а не на межі.
3. Це обхід `AuthProvider`, задля якого і існує `getContext` — див. коментар у
   `src/modules/_shared/context.ts:9-13`: «Every module uses this so workspace
   scoping is never forgotten».

**Як правильно:** резолвити контекст у роуті і передавати сервісу вже готове
значення:

```ts
// routes.ts
app.post('/pulls/:id/exports', { schema: { params: IdParams, body: ExportCreate } },
  async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    reply.status(201);
    return service.create(workspaceId, req.params.id, req.body);
  });
```

`as string` тут теж треба прибрати: кожен `as` на вхідних даних — це місце, де
валідація мала бути, але її нема.

### B2. Помилка «формат не підтримується» повертає 500

**Де:** `service.ts:29-31`

**Проблема:** `ConfigError` — це `statusCode: 500, code: 'config_error'`
(`src/platform/errors.ts:39-43`), тобто «сервер зламаний». Але непідтриманий
формат у тілі запиту — це помилка **клієнта**. Користувач побачить
full-screen-помилку замість inline-підказки, а в логах буде фальшивий 500.

**Як правильно:** валідація формату взагалі не має доїжджати до сервісу — це
робота Zod-схеми на межі (див. C1). Якщо якась перевірка все ж лишається в
сервісі — кидати `ValidationError` (422) або `AppError('...', ..., 400)`, не
`ConfigError`.

Дрібніше, поруч: `service.ts:38` кидає `NotFoundError` (404) на «у цього PR немає
рев'ю для експорту». Сам PR при цьому знайдено. 404 на існуючий ресурс збиває
клієнта з пантелику — тут доречніше 409 (стан, а не відсутність), як це вже
зроблено для `NoProviderKeyError` (`errors.ts:54-63`).

---

## C. Порушення шарів (падає `depcruise`)

Три правила з `server/.dependency-cruiser.cjs` — усі `severity: 'error'`.

### C1. Роут ходить у БД повз сервіс і репозиторій — правило `routes-through-service`

**Де:** `routes.ts:3` (`drizzle-orm`), `routes.ts:7` (`../../db/schema.js`),
`routes.ts:29-39` (сам запит)

**Проблема:** правило `routes-through-service` (рядки 51-59 конфігу) забороняє
будь-який шлях `^src/modules/.+/routes\.ts$` → `^src/db/(schema|client)`.
`exports` не входить у `LAYERLESS_MODULES` (там лише `polling|pulls|settings|
workspace` — легасі-борг), тож виняток не діє. Коментар правила прямо каже:
«routes.ts is the HTTP edge: validate with zod, call the service, serialize.
Persistence belongs behind a repository the service owns».

Найприкріше, що цей запит **уже написано двічі**: `ExportsRepository.listForPull`
(`repository.ts:43-51`) робить рівно те саме. Тобто роут дублює живий метод
репозиторію, який через це лишається мертвим кодом.

**Як правильно:**

```ts
app.get('/pulls/:id/exports', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(app.container, req);
  return service.listForPull(workspaceId, req.params.id);
});
```

плюс тонкий `listForPull` у сервісі, що делегує в репозиторій. Ліміт `50`
(`routes.ts:39`) при цьому переїжджає в `constants.ts` як іменована константа,
а не магічне число в роуті — і `repository.ts:43-51` теж має його застосовувати
(зараз він тягне **всі** рядки без ліміту взагалі, див. E2).

### C2. Сервіс залежить від Fastify — правило `service-stays-http-agnostic`

**Де:** `service.ts:1` (`import type { FastifyRequest } from 'fastify'`),
`service.ts:25` (`create(req: FastifyRequest, prId: string)`), `service.ts:26-27`

**Проблема:** правило `service-stays-http-agnostic` (рядки 62-70 конфігу) забороняє
`^src/modules/.+/(service|repository|helpers)\.ts$` → `node_modules/fastify/`.
Коментар: «A service must be callable from a job, a CLI, or a test without a
request. Needs the request? Take the resolved values as arguments».

Це не формальність: експорт цілком імовірно захочуть викликати з джоби або з
MCP-інструмента, а туди `FastifyRequest` не візьмеш. Заодно тест на `create()`
зараз змушений мокати обʼєкт запиту замість того, щоб передати два рядки.

Варто зазначити: **жоден** інший `src/modules/*/service.ts` у репозиторії не
імпортує `FastifyRequest`. Цей модуль був би першим.

**Як правильно:** сигнатура `create(workspaceId: string, prId: string, input:
ExportCreate): Promise<ExportRecord>`. Уся робота з `req` лишається в `routes.ts`.

### C3. Сервіс сам конструює конкретний адаптер — правило `no-direct-adapter-clients`

**Де:** `service.ts:5` (`import { OctokitGitHubClient } from
'../../adapters/github/octokit.js'`), `service.ts:40-42`

**Проблема:** правило `no-direct-adapter-clients` (рядки 71-81 конфігу) забороняє
`^src/modules/` → `^src/adapters/` для всього, крім чистих адаптерів
(`git/diff-parser`, `codeindex/extract`, `astgrep/`) і `import type`. Octokit —
statefull-клієнт, тобто порт. Коментар правила: «resolve the instance through the
container — that is what makes adapters/mocks.ts substitution work».

Практичний наслідок: тест із `ContainerOverrides.github` цей сервіс **не
підмінить** — він піде в справжній GitHub. І дістає токен вручну
(`service.ts:40-41`), дублюючи те, що `Container.github()` уже робить
(`platform/container.ts:199-206`), включно з тим самим `ConfigError`.

**Як правильно:** якщо GitHub справді потрібен — `const github = await
this.container.github();`. Але з огляду на A6 краще взагалі його звідси
прибрати: пермалінк будується з `repo.fullName` і `pull.headSha` без мережі.

---

## D. Валідація та контракт на межі

### D1. Тіло запиту читається через `as`, а не через тип-провайдер

**Де:** `service.ts:27`

```ts
const body = req.body as { format: ExportFormat; include_diff: boolean };
```

**Проблема:** `AGENTS.md` формулює це прямо: «Contracts are Zod-first: one schema
drives request validation **and** response serialization. Never hand-roll
`Schema.parse(req.body)` in a handler». Каст `as` — той самий гріх, тільки без
`parse`: він **нічого** не перевіряє, просто вимикає перевірку типів. Якщо
`ExportCreate` зробить `include_diff` опційним, тут мовчки буде `undefined`.

**Як правильно:** схема вже оголошена на роуті (`routes.ts:51`, `body:
ExportCreate`) — з `withTypeProvider<ZodTypeProvider>()` (`routes.ts:23`)
`req.body` **уже** типізований і вже провалідований. Достатньо передати його
сервісу як звичайний аргумент, типізований як `ExportCreate`. Жодних кастів.

### D2. Перевірка формату дублює те, що має робити Zod

**Де:** `service.ts:29-31` (`SUPPORTED_FORMATS.includes(body.format)`)

**Проблема:** два джерела правди для одного й того ж — Zod-схема `ExportCreate` і
масив `SUPPORTED_FORMATS`. Вони роз'їдуться. Плюс `Array.includes` на
`readonly` кортежі з вужчим типом елемента зазвичай ще й не тайпчекається без
касту.

**Як правильно:** зробити формат `z.enum` всередині `ExportCreate` у
`vendor/shared`. Тоді невалідний формат стає чистим 422 **до** входу в хендлер
(`server/AGENTS.md`: «invalid input 422s before the handler runs»), а
`SUPPORTED_FORMATS` і перевірка в сервісі просто зникають.

### D3. Немає `response`-схем

**Де:** `routes.ts:26, 49, 57`

**Проблема:** `src/modules/_shared/schemas.ts:14-24` пояснює, навіщо вони
потрібні: серіалізатор валідує те, що **виходить** із процесу, тож хендлер, який
почав повертати сирий Drizzle-рядок із `workspaceId` усередині, падає голосно, а
не тихо розширює публічний API. Для модуля, який віддає `body` експорту
(`repository.ts:59`), це не абстрактний ризик.

Тут це не блокер (частина роутів у репо їх не оголошує — див. коментар у
`blast/routes.ts:18`), але новий модуль варто робити за кращим зразком:
`brief/routes.ts:43,53` і `onboarding/routes.ts:30,48` схеми оголошують.

**Як правильно:** `response: { 200: ExportRecord }` для `GET /exports/:id` і
POST, `response: { 200: z.array(ExportListItem) }` для списку.

### D4. POST не повертає 201

**Де:** `routes.ts:49-55`

**Проблема:** роут створює ресурс, а віддає 200. У цьому ж репо `POST /agents`
(`agents/routes.ts:105-106`) робить `reply.status(201)`.

**Як правильно:** `async (req, reply) => { ... reply.status(201); return ... }`.

---

## E. Дублювання і дрібніше

### E1. DTO мапиться двічі, різними формами

**Де:** `routes.ts:41-46` проти `repository.ts:54-63` (`toDto`)

**Проблема:** дві незалежні реалізації перетворення рядка таблиці в snake_case
DTO. Коли в контракт додадуть поле, оновлять одну — і список почне відрізнятися
від картки. Ця проблема зникає сама, щойно буде виправлено C1.

**Як правильно:** одне місце мапінгу — `toDto` в репозиторії. Якщо для списку
навмисно не потрібне важке поле `body` — оголосити окремий тип
`ExportListItem` у `vendor/shared` і окрему функцію `toListDto`, щоб «списковий»
контракт був явним, а не побічним ефектом того, які колонки обрав `select`.

### E2. `listForPull` — мертвий код і без ліміту

**Де:** `repository.ts:43-51`

**Проблема:** метод не викликається нізвідки (роут робить власний запит), тобто
поїде в main непротестованим. І на відміну від роуту (`limit(50)`) він тягне
**всі** експорти PR без обмеження — на активному PR це необмежене зростання
відповіді, тим паче що `select()` без проєкції тягне ще й колонку `body` цілком.

**Як правильно:** підключити його з сервісу (C1), додати `.limit(...)` з
константи і явну проєкцію колонок без `body`.

### E3. Non-null assertion на результаті `insert`

**Де:** `repository.ts:30` — `return toDto(inserted!)`

**Проблема:** `!` глушить перевірку там, де інваріант справді існує, але ніде не
задокументований. Якщо `.returning()` колись віддасть порожній масив, впаде
`Cannot read property 'id' of undefined` замість зрозумілої помилки.

**Як правильно:** або явна перевірка з осмисленою помилкою, або хоча б коментар,
чому масив гарантовано непорожній.

### E4. Каст `row.format as ExportFormat`

**Де:** `repository.ts:58`

**Проблема:** каст потрібен лише тому, що колонка оголошена як `text` без
переліку значень.

**Як правильно:** оголосити колонку як `text('format', { enum: [...] })` — саме
так зроблено для `reviews.kind` (`src/db/schema/reviews.ts:20`). Тоді Drizzle
виведе літеральний юніон і каст стане непотрібним.

### E5. Змінна `latest` не гарантовано найновіша

**Де:** `service.ts:37`

**Проблема:** `reviews.find(...)` бере **перший** елемент у порядку, який віддала
БД. Тут пощастило — `reviewsForPull` документовано повертає «newest first»
(`reviews/repository.ts:64`), тож поведінка правильна. Але покладатися на це
мовчки крихко.

**Як правильно:** короткий коментар «rows are newest-first» біля `find`, щоб зміна
`ORDER BY` в чужому модулі не зламала експорт непомітно.

### E6. Немає тестів

**Проблема:** у PR немає жодного тесту. Для модуля, який заявляє «expensive to
lose» (`routes.ts:17`), варто мати як мінімум: юніт на `renderDigest` (чиста
функція — найдешевший тест у модулі) і `*.it.test.ts` на репозиторій.

**Як правильно:** тести з БД **мають** називатися `exports.repository.it.test.ts` —
юніт- і інтеграційна доріжки розділяються саме по цьому глобу
(`AGENTS.md`, `server/AGENTS.md:25-27`).

---

## Чек-ліст перед відкриттям PR

1. Додати таблицю `exports` + міграцію (`pnpm db:generate` → `pnpm db:migrate`).
2. Додати контракти в `server/src/vendor/shared` **і** віддзеркалити в
   `client/src/vendor/shared`.
3. Додати `helpers.ts` і `constants.ts`.
4. Прибрати SQL із `routes.ts`; список іде через сервіс → `listForPull`.
5. Прибрати `FastifyRequest` із сервісу; `workspaceId` — з `getContext` у роуті.
6. Прибрати `new OctokitGitHubClient(...)`; пермалінк будувати без мережі
   (або через `container.github()` з методом, доданим у порт і в моки).
7. Виправити `reviewsForPull` / `r.review.kind` / `repo.fullName`.
8. Формат валідувати Zod-ом; `ConfigError` → `ValidationError`.
9. Зареєструвати модуль у `src/modules/index.ts`.
10. Прогнати локально: `node scripts/verify.mjs --slice backend` (і `--slice
    integration`, якщо додано `*.it.test.ts`) — саме він дзеркалить
    `.github/workflows/**` і дасть ті самі помилки `depcruise`, що й CI.
11. У тілі PR не забути секцію **Insights**, і провести PR через
    `/pr-self-review` (вручну — авто-хук вимкнений).
