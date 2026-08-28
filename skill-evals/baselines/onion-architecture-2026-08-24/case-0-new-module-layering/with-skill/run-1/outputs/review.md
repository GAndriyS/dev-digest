# Ревʼю модуля `exports` перед PR

Файли: `.claude/skills/onion-architecture-workspace/fixtures/exports-module/{routes,service,repository}.ts`
Критерій: `.claude/skills/onion-architecture/SKILL.md` + `server/.dependency-cruiser.cjs` (CI, job `typecheck` у `.github/workflows/server-unit.yml`).

**Вердикт: PR у поточному вигляді відкривати не можна.** Три помилки depcruise (`severity: error`) завалять CI автоматично, ще чотири речі просто не компілюються (`t.exports`, `ExportRecord`, `reviewRepo.listReviews`, `pull.repoFullName`), плюс одна дірка в tenancy. `repository.ts` при цьому написаний майже правильно — його чіпати треба найменше.

Нумерація нижче: `[A-*]` — блокери (архітектура / CI), `[B-*]` — не компілюється або відсутнє, `[C-*]` — варте виправлення, але не блокує.

---

## A. Блокери архітектури — падає depcruise

### A-1. `routes.ts:3, 7, 29–47` — роут ходить у БД повз сервіс

```ts
// routes.ts:3
import { eq, and, desc } from 'drizzle-orm';
// routes.ts:7
import * as t from '../../db/schema.js';
...
// routes.ts:29–39
const rows = await app.container.db.select({...}).from(t.exports)...
```

**Чому це проблема.** Правило `routes-through-service` (`server/.dependency-cruiser.cjs`, блок `---- Edge (routes) ----`) забороняє ребру `^src/modules/.+/routes\.ts$ → ^src/db/(schema|client)|(^|/)repository`. `exports` не входить у `LAYERLESS_MODULES` (там тільки `polling|pulls|settings|workspace` — це grandfathered борг, і SKILL.md прямо каже «New modules must not»). Тобто CI впаде `error` одразу.

Змістовно: `routes.ts` — це транспорт (розпарсити, викликати, віддати). SQL на краю означає, що цей самий лістинг не можна викликати з джоби чи з MCP-тула, і його не протестуєш без підняття HTTP.

Найкращий доказ, що це саме недогляд: у `repository.ts:43–51` вже лежить `listForPull(workspaceId, prId)`, який робить рівно те саме — тобто метод написали і забули підключити.

**Як правильно.** Додати в `ExportsService`:

```ts
async listForPull(workspaceId: string, prId: string): Promise<ExportRecord[]> {
  return this.repo.listForPull(workspaceId, prId);
}
```

а роут звести до трьох рядків у стилі `server/src/modules/repos/routes.ts:38–41`:

```ts
app.get('/pulls/:id/exports', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(app.container, req);
  return service.listForPull(workspaceId, req.params.id);
});
```

Імпорти `drizzle-orm` (рядок 3) і `../../db/schema.js` (рядок 7) з `routes.ts` після цього зникають — саме вони і є ребро, яке ловить правило.

### A-2. `service.ts:5, 40–43` — сервіс сам конструює GitHub-адаптер

```ts
// service.ts:5
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
...
// service.ts:40–42
const token = await this.container.secrets.get('GITHUB_TOKEN');
if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
const github = new OctokitGitHubClient(token);
```

**Чому це проблема.** Правило `no-direct-adapter-clients` забороняє `^src/modules/ → ^src/adapters/` для всього, крім `PURE_ADAPTERS` (`git/diff-parser`, `codeindex/extract`, `astgrep/`) і крім `import type`. Тут імпорт саме value-івський і саме stateful-клієнта → `error`.

Це не стилістика. `OctokitGitHubClient`, створений всередині сервісу, неможливо підмінити через `new Container(config, db, { github: new MockGitHubClient(...) })` — а це єдиний тестовий шов, який тут є (`server/src/adapters/mocks.ts:131`). Тобто кожен юніт-тест `ExportsService.create` полізе в мережу.

Додатково: ці три рядки — дослівна копія `Container.github()` (`server/src/platform/container.ts`, гетер `async github()`), включно з тим самим `ConfigError('GITHUB_TOKEN is not configured')`. Композиційний корінь уже вирішує цю задачу, з кешуванням і з `invalidateSecretCaches()`, який після зміни ключа в Settings скидає клієнт. Локальна копія цього скидання не побачить і буде тримати протухлий токен.

**Як правильно.** Викинути рядок 5 і рядки 40–42, лишити один виклик:

```ts
const github = await this.container.github();
```

Якщо десь потрібен тип — це `import type { GitHubClient } from '@devdigest/shared'`; `import type` порту правило пропускає свідомо (`dependencyTypesNot: ['type-only']`).

### A-3. `service.ts:1, 25–27` — `FastifyRequest` протік у сервіс

```ts
// service.ts:1
import type { FastifyRequest } from 'fastify';
// service.ts:25–27
async create(req: FastifyRequest, prId: string): Promise<ExportRecord> {
  const workspaceId = req.headers['x-workspace-id'] as string;
  const body = req.body as { format: ExportFormat; include_diff: boolean };
```

і відповідна сторона на краю:

```ts
// routes.ts:52–54
async (req) => {
  return service.create(req, req.params.id);
},
```

**Чому це проблема.** Правило `service-stays-http-agnostic` забороняє ребро `^src/modules/.+/(service|repository|helpers)\.ts$ → node_modules/(fastify|fastify-type-provider-zod|fastify-sse-v2)/`. Зверніть увагу: на відміну від `no-direct-adapter-clients`, тут **немає** винятку `dependencyTypesNot: ['type-only']` — тобто навіть `import type` на рядку 1 дає `error`. Це зроблено навмисно: коментар правила каже «A service must be callable from a job, a CLI, or a test without a request».

Практично: HTTP просочився на два кільця всередину. Викликати `create` з JobRunner або з MCP-сервера тепер неможливо — доведеться підробляти `FastifyRequest`. Плюс два `as`-касти (рядки 26 і 27) викидають типізацію, яку `ZodTypeProvider` уже дав на краю задарма.

**Як правильно** (шаблон — `server/src/modules/repos/service.ts`, метод `add(workspaceId, userId, url)`):

```ts
// service.ts
async create(
  workspaceId: string,
  prId: string,
  input: { format: ExportFormat; includeDiff: boolean },
): Promise<ExportRecord> { ... }
```

```ts
// routes.ts
app.post('/pulls/:id/exports', { schema: { params: IdParams, body: ExportCreate } }, async (req, reply) => {
  const { workspaceId } = await getContext(app.container, req);
  const record = await service.create(workspaceId, req.params.id, {
    format: req.body.format,
    includeDiff: req.body.include_diff,
  });
  reply.status(201);
  return record;
});
```

### A-4. `service.ts:26` — tenancy береться з сирого заголовка, а не з `AuthProvider`

```ts
const workspaceId = req.headers['x-workspace-id'] as string;
```

**Чому це проблема** (окремо від A-3, бо не зникне саме собою). Це єдине місце в кодовій базі, яке визначає workspace не через `getContext` (`server/src/modules/_shared/context.ts`). Наслідки:

- `x-workspace-id` — це заголовок від клієнта. Ким би не був `AuthProvider`, тут його підміняє будь-хто, хто вміє слати HTTP: підставив чужий `workspaceId` → отримав чужий PR і чужий рев'ю в дайджест. Зараз `LocalNoAuthProvider` і так віддає дефолтний workspace, тож дірка «спить», але коли зʼявиться реальна автентифікація, це стане тихим горизонтальним обходом ізоляції — і знайдуть його не тут.
- Заголовка може не бути взагалі. `as string` перетворює `undefined` на `string` тільки для компілятора; далі `eq(t.exports.workspaceId, undefined)` дасть 500 з надр драйвера замість чесної відповіді.
- Коментар у `context.ts` формулює правило прямо: «Every module uses this so workspace scoping is never forgotten».

**Як правильно.** `workspaceId` резолвиться **тільки** на роуті через `await getContext(app.container, req)` і передається всередину значенням — як у A-3. Ніякого читання заголовків нижче за `routes.ts`.

### A-5. `service.ts:29–31` — валідація формату продубльована в сервісі, і статус неправильний

```ts
if (!SUPPORTED_FORMATS.includes(body.format)) {
  throw new ConfigError(`Unsupported export format "${body.format}"`);
}
```

**Чому це проблема.** Дві окремі речі.

1. **Не той рівень.** SKILL.md: «Parse at the boundary; inside the rings the data is already trusted» + «Never hand-roll `Schema.parse(req.body)` in a handler». Формат — це вхід від користувача, і його місце — у Zod-схемі `ExportCreate` на роуті (`routes.ts:51`). Тоді невалідний формат ловиться **до** входу в хендлер, а сервіс далі має справу з уже звуженим типом і взагалі не має цієї гілки.
2. **Не той статус.** `ConfigError` — це `config_error` / **500** (`server/src/platform/errors.ts`). Тобто помилку користувача («ти прислав `format: "pdf"`») ми звітуємо як поломку сервера: вона потрапить в алерти, а клієнт покаже full-screen помилку замість інлайн-підказки. Для 4xx тут є `ValidationError` → `validation_error` / **422**, і це рівно те, що Zod віддав би сам.

**Як правильно.** У канонічному `server/src/vendor/shared` описати формат як enum і вивести константу з нього, а не навпаки:

```ts
export const EXPORT_FORMATS = ['markdown', 'html'] as const; // фактичний перелік — за вами
export const ExportFormat = z.enum(EXPORT_FORMATS);
export type ExportFormat = z.infer<typeof ExportFormat>;

export const ExportCreate = z.object({
  format: ExportFormat,
  include_diff: z.boolean().default(false),
});
```

Після цього рядки 29–31 у сервісі просто видаляються, а `SUPPORTED_FORMATS` з `constants.ts` більше не потрібен (одне джерело правди замість двох списків, які розʼїдуться).

---

## B. Не компілюється / відсутнє

Це не причіпки — `pnpm exec tsc --noEmit` (і `node scripts/verify.mjs --slice backend`) впаде на кожному пункті.

### B-1. Таблиці `exports` не існує — `repository.ts:4, 20, 35, 45, 54`, `routes.ts:7, 32–37`

`t.exports` немає ні в `server/src/db/schema.ts` (барель), ні в жодному файлі `server/src/db/schema/*.ts`. Найближче за змістом — `digests` (`server/src/db/schema/ops.ts:41`, поля `periodStart`/`periodEnd`/`bodyMd`/`deliveredTo`), але це інша сутність, і полів `pr_id` / `format` / `file_name` там немає.

**Як правильно.**

1. Додати таблицю у `server/src/db/schema/` (логічно — новий `exports.ts` або поруч у `ops.ts`) і дописати рядок у барель `schema.ts` (і `export *`, і обʼєкт `schema`).
2. Обовʼязково `workspaceId` з FK на `workspaces` з `onDelete: 'cascade'` + `prId` з FK на `pullRequests` — так, як зроблено в `schema/pulls.ts:9–15`. Плюс індекс по `(workspace_id, pr_id)`, бо `listForPull` фільтрує саме по цій парі.
3. Згенерувати **нову** міграцію (наступний номер після `0017_shallow_swordsman.sql`). Правити вже застосовані `.sql` заборонено (`AGENTS.md`, розділ «Do not touch»).
4. Не забути `cd server && pnpm db:migrate` — міграції на старті не застосовуються.

### B-2. Контрактів `ExportRecord` / `ExportCreate` / `ExportFormat` не існує — `routes.ts:4`, `service.ts:2`, `repository.ts:2`

У `server/src/vendor/shared/` цих імен немає взагалі (грепом — нуль збігів).

**Як правильно.** Описати їх у **серверній** копії `server/src/vendor/shared/` — вона канонічна — Zod-first, одна схема на валідацію і на серіалізацію (див. A-5). І далі за `AGENTS.md`: `@devdigest/shared` існує двічі, тож `ExportRecord` (він перетинає провід — це тіло відповіді) треба **віддзеркалити** в `client/src/vendor/shared/contracts/`. Правило: «Edit the server copy, then mirror wire-crossing changes into the client copy — never edit only one».

### B-3. `reviewRepo.listReviews` не існує — `service.ts:36`

```ts
const reviews = await this.container.reviewRepo.listReviews(workspaceId, prId);
const latest = reviews.find((r) => r.kind === 'review');
```

`ReviewRepository` (`server/src/modules/reviews/repository.ts`) такого методу не має. Найближчий — `reviewsForPull(prId)`, і в нього **інша сигнатура і інша форма результату**: один аргумент (без `workspaceId`) і `Promise<{ review: ReviewRow; findings: FindingRow[] }[]>`.

Тобто далі по коду ламається все, що з цього виведене:

- `r.kind` — поля `kind` на верхньому рівні немає, елемент це `{ review, findings }`;
- `latest.findings` (рядок 48) — насправді `latest.findings` існує, але у сусідній гілці обʼєкта, а не на `review`;
- `review: latest` (рядок 46) — у `renderDigest` поїде обгортка замість самого рев'ю.

**Як правильно.** Або використати наявний `reviewsForPull(prId)` і розпакувати пару:

```ts
const rows = await this.container.reviewRepo.reviewsForPull(prId);
const latest = rows[0]; // впорядкування перевірити в repository/review.repo.ts, не вгадувати
if (!latest) throw new NotFoundError('This pull request has no review to export');
// далі: latest.review, latest.findings
```

Зверніть увагу, що `reviewsForPull` не приймає `workspaceId` — тому перевірка `getPull(workspaceId, prId)` вище (рядки 33–34) **обовʼязкова** і має лишитися: саме вона тут забезпечує tenancy. Це добре, що вона вже є.

Або, якщо потрібен саме «останній рев'ю такого-то kind» — додати такий метод у `ReviewRepository` (він на контейнері, тож це легально), а не збирати вибірку в сервісі.

### B-4. `pull.repoFullName` не існує — `service.ts:43`

```ts
const permalink = await github.commitUrl(pull.repoFullName, pull.headSha);
```

`PullRow` = `typeof t.pullRequests.$inferSelect` (`server/src/db/rows.ts:15`). У `schema/pulls.ts` там є `repoId`, `headSha`, `number`, `branch`… але `repoFullName` немає — full name живе на `repos`.

**Як правильно.** `ReviewRepository` уже має `getRepo(repoId)`:

```ts
const repo = await this.container.reviewRepo.getRepo(pull.repoId);
if (!repo) throw new NotFoundError('Repository not found');
// далі repo.fullName
```

### B-5. `GitHubClient.commitUrl` не існує — `service.ts:43`

Порт `GitHubClient` (`server/src/vendor/shared/adapters.ts:143–167`) має `listPullRequests`, `getPullRequest`, `postReview`, `listReviewComments`, `createReviewComment`, `openPullRequest`, `commitFiles`, `findOpenPr`, `getIssue`, `currentLogin` — і жодного `commitUrl`. Крім того, всі методи порту приймають `RepoRef`, а не рядок `fullName`.

**Тут варто спершу спитати себе, чи потрібен взагалі мережевий виклик.** URL коміту на GitHub — це чиста конкатенація `https://github.com/{fullName}/commit/{sha}`. Якщо так — це `helpers.ts` (чиста функція, нуль I/O, тестується без контейнера) і весь пункт A-2 разом з `container.github()` з сервісу зникає. Це і є найпростіший правильний варіант.

Якщо ж вам справді треба сходити в API (наприклад, підтвердити, що комміт існує, або дістати канонічний `html_url`), то за SKILL.md новий метод порту — це не один рядок, а **чотири**, інакше шов ламається:

1. метод в `interface GitHubClient` — `server/src/vendor/shared/adapters.ts` (канонічна копія);
2. реалізація в `OctokitGitHubClient` — `server/src/adapters/github/octokit.ts`;
3. контейнер — тут нічого, `github()` уже є;
4. реалізація в `MockGitHubClient` — `server/src/adapters/mocks.ts:131`, інакше кожен наявний тест з мок-GitHub перестане задовольняти інтерфейс.

Плюс дзеркало в `client/src/vendor/shared/adapters.ts`, якщо тип перетинає провід.

### B-6. `helpers.ts` і `constants.ts` у наборі відсутні — `service.ts:7–8`

```ts
import { renderDigest, digestFileName } from './helpers.js';
import { MAX_FINDINGS_IN_DIGEST, SUPPORTED_FORMATS } from './constants.js';
```

Ви кажете, що вливаєте `routes.ts`, `service.ts`, `repository.ts` — але без цих двох файлів модуль не збереться. Або вони є і просто не потрапили в набір на ревʼю (тоді ігноруйте пункт), або їх треба дописати. Розкладка за чеклістом SKILL.md правильна: `renderDigest`/`digestFileName` — чисті трансформації → `helpers.ts`; літерали → `constants.ts`. Памʼятайте, що `constants.ts` і `types.ts` — це **публічна поверхня** модуля (єдине, що можуть імпортувати інші модулі), тож не складайте туди приватні дрібниці.

Один нюанс: `helpers.ts` теж підпадає під `service-stays-http-agnostic` (правило перелічує `(service|repository|helpers)\.ts`) — тож `renderDigest` не має знати ні про Fastify, ні про запит.

### B-7. Модуль не зареєстровано — `server/src/modules/index.ts`

Плагіна `exports` немає ні в імпортах, ні в обʼєкті `modules`. Роути просто не піднімуться, а depcruise видасть `no-orphans` (`severity: warn`) на весь новий підкаталог.

**Як правильно.** Один імпорт + один рядок у `modules`, статично (динамічний `import()` `.ts` навмисно не використовується — він не працює однаково під tsx, бандлером і vitest).

Обережно з іменем: `exports` — зарезервоване слово в CommonJS-контексті. Реєстр — це обʼєкт (`export const modules: Record<string, FastifyPluginAsync>`), тож ключ `exports` синтаксично валідний, але імпортувати `import exports from './exports/routes.js'` — погана ідея. Назвіть біндинг інакше: `import exportsModule from './exports/routes.js'` і `{ exports: exportsModule }`.

---

## C. Варте виправлення, але не блокує CI

### C-1. `repository.ts:43–51` — `listForPull` мертвий і без ліміту

Наслідок A-1: метод є, але його ніхто не кличе. Після виправлення A-1 він оживе — і тоді зверніть увагу, що в ньому немає `.limit(...)`, тоді як роут-версія (`routes.ts:39`) лімітує 50. Вибірка «всі експорти PR» необмежена: PR, який експортували сотні разів, витягне все в памʼять. Перенесіть ліміт у репозиторій, а число — у `constants.ts` (`EXPORTS_PAGE_SIZE = 50`), бо `50` на `routes.ts:39` — це саме той «літерал», для якого чеклист SKILL.md і заводить `constants.ts`.

### C-2. `routes.ts:41–46` — ручний мапінг DTO дублює `toDto`

```ts
return rows.map((row) => ({ id: row.id, pr_id: row.prId, format: row.format, created_at: row.createdAt.toISOString() }));
```

Це усічена копія `toDto` (`repository.ts:54–63`). Два місця, що перекладають рядок у DTO, розʼїдуться при першій же зміні контракту — і роут почне тихо віддавати іншу форму, ніж `GET /exports/:id`. Після A-1 цей код зникає сам; головне не перенести його в сервіс, а лишити мапінг у репозиторії, де він уже є.

Зверніть увагу, що дві відповіді зараз і так різні: лістинг віддає без `file_name` і `body`, а `ExportRecord` їх містить. Якщо це навмисно («у списку тіло не потрібне» — розумно, тіло може бути великим), то це окремий тип, і його треба назвати чесно (`ExportSummary`) і описати в `vendor/shared`, а не отримувати мовчазним звуженням у `.select({...})`.

### C-3. `repository.ts:30` — `inserted!`

`return toDto(inserted!);` — non-null assertion. Тут вона фактично безпечна (`insert().returning()` з одним `values` завжди дає рядок), але це той самий стиль, що й `as string` у `service.ts:26`, і рецензент справедливо спитає. Дешевше написати явно:

```ts
if (!inserted) throw new AppError('export_insert_failed', 'Failed to persist export', 500);
```

### C-4. `repository.ts:59` — `row.format as ExportFormat`

Каст натякає, що колонка в схемі буде звичайним `text`. Оскільки таблиці ще немає (B-1), у вас є вільний вибір: зробіть колонку з `CHECK`-обмеженням або pg enum по тому ж переліку, що й Zod-enum з A-5. Тоді БД і контракт не розʼїдуться, а каст перетвориться на чесний тип.

### C-5. `service.ts` — немає `createdBy` / `userId`

`getContext` повертає `{ workspaceId, userId }`, і `RepoService.add` бере обидва. Експорт — це артефакт, яким діляться з командою; «хто його зробив» майже напевно знадобиться в UI. Оскільки схему ви все одно пишете з нуля (B-1), закласти `created_by` (FK→`users`) зараз коштує нуль, а додавати потім — це ще одна міграція.

### C-6. Тестів у наборі немає

Після виправлення A-2 і A-3 сервіс стає тестованим рівно тим швом, який архітектура вже дає:

```ts
const container = new Container(config, db, { github: new MockGitHubClient({ ... }) });
```

— без `vi.mock` шляхів модулів. Тести, що торкаються БД (а тут це майже все — `insert`/`get`/`listForPull`), **мусять** називатися `*.it.test.ts`: юніт- та інтеграційна лінії CI розділяються рівно по цьому глобу. `renderDigest` з `helpers.ts` — чиста функція, їй контейнер не потрібен взагалі.

Перевірити локально: `node scripts/verify.mjs --slice backend` (і `--slice integration` для `.it.test.ts`). Не запускайте `tsc`/`depcruise`/`vitest` вручну — скрипт дзеркалить `.github/workflows/**`.

---

## Що зробити по порядку

1. **Схема і контракти** (B-1, B-2): таблиця `exports` + нова міграція + `pnpm db:migrate`; `ExportRecord`/`ExportCreate`/`ExportFormat` у `server/src/vendor/shared`, дзеркало в `client/src/vendor/shared`.
2. **Вирівняти сигнатури** (B-3, B-4, B-5): `reviewsForPull` замість `listReviews`, `getRepo(pull.repoId).fullName` замість `pull.repoFullName`, а `commitUrl` — спершу спробувати як чисту функцію в `helpers.ts`.
3. **Прибрати HTTP із сервісу** (A-3, A-4, A-5): `create(workspaceId, prId, input)`, `workspaceId` тільки з `getContext`, формат — Zod-enum на роуті; викинути `import type { FastifyRequest }`.
4. **Прибрати адаптер із сервісу** (A-2): `await this.container.github()` або чиста функція.
5. **Прибрати SQL із роута** (A-1): `service.listForPull(...)` → `repo.listForPull(...)`.
6. **Зареєструвати модуль** (B-7) і дописати `helpers.ts` / `constants.ts` (B-6).
7. Пройтися по C-1…C-6, тоді `node scripts/verify.mjs --slice backend`.
8. Перед відкриттям PR — `/pr-self-review` (автоінвокації немає навмисно), і не забути секцію **Insights** у тілі PR.

Окреме питання до автора, на яке ревʼю не може відповісти за вас: чи `exports` не дублює наявну таблицю `digests` (`server/src/db/schema/ops.ts:41`)? Назви («digest» фігурує і в `renderDigest`, і в `digestFileName`, і в докстрінгу `service.ts`) підозріло перетинаються. Якщо це та сама сутність — краще розібратися до міграції, ніж після.
