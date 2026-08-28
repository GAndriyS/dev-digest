# Ревʼю модуля `digests` перед вливанням у `server/src/modules/digests`

Матеріал: `.claude/skills/onion-architecture/evals/fixtures/digests-module/{routes.ts,service.ts}`.
Критерії: `.claude/skills/onion-architecture/SKILL.md` (v1.1.0), `server/.dependency-cruiser.cjs`,
чинні модулі `server/src/modules/{repos,reviews,onboarding}`.

Вердикт: **не вливати як є**. Три блокери, з них один валить CI (`depcruise`),
один валить `tsc`, один ламає контракт помилок API.

---

## Блокери

### B1. `FastifyRequest` протік у сервіс — це помилка навіть як `import type`

**Файл:** `service.ts:1`, `service.ts:47`, `service.ts:55`
**Дотично:** `routes.ts:43`

```ts
// service.ts:1
import type { FastifyRequest } from 'fastify';
// service.ts:47
private auditContext(req: FastifyRequest) { ... }
// service.ts:55
async recordDelivery(req: FastifyRequest, workspaceId: string, digestId: string): Promise<void>
```

**Чому це проблема.**

1. *Механічно.* Правило `service-stays-http-agnostic`
   (`server/.dependency-cruiser.cjs:78-86`) забороняє ребро
   `^src/modules/.+/(service|repository|helpers)\.ts$` → `node_modules/fastify/`
   і — на відміну від `no-direct-adapter-clients` (`:88-97`) — **не має**
   `dependencyTypesNot: ['type-only']`. Плюс у конфізі ввімкнено
   `tsPreCompilationDeps: true` (`:186`), тож `import type` теж потрапляє у граф.
   Тобто `pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs`
   впаде з `error`, і разом з ним job `typecheck` у `.github/workflows/server-unit.yml`.
   Це не «попередження на ревʼю» — це червоний CI.
2. *По суті.* Виняток для type-only існує рівно для одного випадку — назвати
   інтерфейс порту (`import type { GitHubClient }`). Тут же тип у сигнатурі
   означає, що **сигнатура сервісу говорить HTTP**. Саме ту звʼязність правило й
   ловить: `DigestsService` неможливо викликати з job-а, з CLI чи з тесту без
   підробленого `FastifyRequest`. Для дайджестів це не абстрактна шкода — дайджест
   за визначенням будується за розкладом (cron/job), а не тільки з HTTP-запиту.
   SKILL.md, розділ «Blind spots», пункт 2 — прямо про цей випадок.

**Як правильно.** Резолвити на краю, передавати всередину готові значення.

```ts
// modules/digests/types.ts — публічна поверхня модуля
export interface DeliveryAudit {
  requestId: string;
  userAgent: string;
  ip: string;
}

// service.ts — жодного імпорту з 'fastify'
async recordDelivery(workspaceId: string, digestId: string, audit: DeliveryAudit): Promise<void> {
  await this.repo.markDelivered(workspaceId, digestId, audit);
}

// routes.ts — край знає про транспорт, це його робота
app.post('/digests/:id/delivered', { schema: { params: IdParams, response: { 200: OkResponse } } },
  async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.recordDelivery(workspaceId, req.params.id, {
      requestId: req.id,
      userAgent: req.headers['user-agent'] ?? 'unknown',
      ip: req.ip,
    });
    return { ok: true };
  });
```

`auditContext` (`service.ts:47-53`) переїжджає в `routes.ts` або в
`helpers.ts` як чиста функція від уже витягнутих значень. Зверни увагу й на
порядок аргументів у `recordDelivery` — транспорт стояв першим, перед
`workspaceId`; у решті кодбази tenancy-скоуп завжди перший аргумент
(`modules/repos/service.ts`, `modules/repos/repository.ts`).

---

### B2. Ручний `safeParse` у хендлері замість `schema.body`

**Файл:** `routes.ts:24-29`

```ts
app.post('/repos/:id/digests', { schema: { params: IdParams } }, async (req, reply) => {
  const { workspaceId } = await getContext(app.container, req);
  const parsed = DigestBuild.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid_window', details: parsed.error.flatten() });
  }
```

**Чому це проблема.** SKILL.md, «Validation at the edge»: *«Never hand-roll
`Schema.parse(req.body)` in a handler»*. Наслідки конкретні:

- **Неправильний статус.** Уся кодбаза віддає `422` на невалідний вхід
  (`app.ts:129-140`, `hasZodFastifySchemaValidationErrors` → 422). Тут `400`.
  Клієнт, який розрізняє 400 і 422, отримує інший клас помилки на тому самому
  сценарії.
- **Інший конверт помилки.** Глобальний обробник (`app.ts:129-176`) віддає
  `{ error: { code, message, details } }`. Тут `{ error: 'invalid_window', details }` —
  `error` рядок замість обʼєкта. Це вже не «інша обгортка», це несумісний тип
  для клієнтського парсера.
- **Немає типізації від type-provider-а.** `parsed.data.window` типізований
  вручну; `req.body` лишається `unknown` для `ZodTypeProvider`.
- **Валідація виконується після `getContext`** (`routes.ts:25`) — тобто після
  походу в `AuthProvider`. З декларативною схемою невалідний запит відсікається
  ще до хендлера.

**Як правильно.**

```ts
app.post('/repos/:id/digests',
  { schema: { params: IdParams, body: DigestBuild, response: { 200: DigestRecord } } },
  async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.build(workspaceId, req.params.id, req.body.window);
  });
```

**Пастка при цьому фіксі.** `service.build` має дефолт `DEFAULT_WINDOW`
(`service.ts:24`), тобто тіло має бути необовʼязковим. Записаний інсайт
`server/INSIGHTS.md` («Tool & Library Notes», 2026-08-19): звичайний zod-обʼєкт
у `schema.body` відхиляє **порожній** POST з 422 навіть з `.optional()` — без
`content-type` валідатор отримує `null`, не `undefined`. Треба `.nullish()` і
читання `req.body?.window` — робочий приклад у
`server/src/modules/onboarding/routes.ts:40-50`. Тести через
`app.inject({ payload: {} })` цю пастку не ловлять.

---

### B3. Роут вручну мапить доменну помилку — і робить це за текстом повідомлення

**Файл:** `routes.ts:31-38`, у парі з `service.ts:27`

```ts
// routes.ts:31-38
} catch (err) {
  if (err instanceof Error && err.message === 'Nothing merged in this window') {
    return reply.code(404).send({ error: 'empty_window', message: err.message });
  }
  throw err;
}
```

**Чому це проблема.** SKILL.md: *«Services throw domain errors; routes do not map
them by hand»*. Сервіс уже кидає `NotFoundError` (`service.ts:27`), а
`app.setErrorHandler` (`app.ts:166-171`) уже перетворює будь-який `AppError` на
`reply.status(err.statusCode).send({ error: { code, message, details } })` — тобто
на коректний `404` у стандартному конверті. Цей `catch` перехоплює правильну
поведінку і підміняє її на нестандартну (`error` — рядок `'empty_window'`).

Гірше — звʼязок тримається на **збігу рядка повідомлення**. Будь-яка правка
тексту в `service.ts:27` (переклад, уточнення, додавання назви репозиторію)
тихо розриває звʼязок; тест на 404 при цьому продовжить проходити, бо
`NotFoundError` усе одно дасть 404 — але вже з іншим `code`, іншим тілом і без
жодного падіння. Це найгірший клас регресії: мовчазна зміна публічного контракту.

**Як правильно.** Видалити `try/catch` цілком; хендлер стає одним рядком
`return service.build(...)`. Якщо потрібен саме код `empty_window`, а не
`not_found` — це рішення сервісу, і виражається воно класом помилки, а не рядком:

```ts
// platform/errors.ts  (або modules/digests/errors.ts, якщо код суто модульний)
export class EmptyWindowError extends AppError {
  constructor(window: string) {
    super('empty_window', `Nothing merged in the ${window} window`, 404);
  }
}
```

Дискусійне окремо: чи `404` — правильний статус для «за період нічого не
змержили». Порожній результат зазвичай не помилка; варіант — віддавати
`200` з `authors: []`, тоді питання мапінгу зникає само.

---

## Важливе

### I1. Типи `DigestBuild` / `DigestRecord` / `DigestWindow` у `@devdigest/shared` не існують

**Файл:** `routes.ts:3`, `service.ts:2`

Пошук по `server/src/vendor/shared/**` та `client/src/vendor/shared/**` не дає
жодного з трьох імен. Що там реально є — `server/src/vendor/shared/contracts/productionize.ts:196-211`:
`Digest` (рядок дайджесту) і `DigestRunRequest` (тіло `POST /digest/run` з
`period_start` / `period_end`).

**Чому це проблема.** `pnpm typecheck` впаде на обох файлах. Плюс: у контракті
вже закладена модель «діапазон ISO-дат», а фікстура вводить паралельну модель
«іменоване вікно» (`DigestWindow`, `DEFAULT_WINDOW`). Дві моделі періоду для
однієї фічі — це розходження, яке треба вирішити **до** мержу, а не після.

**Як правильно.** Або перевикористати `Digest` / `DigestRunRequest`, або
свідомо додати нові схеми — і тоді: правити **серверну** копію
(`server/src/vendor/shared`, канонічна), після чого дзеркалити все, що
перетинає дріт, у `client/src/vendor/shared` (AGENTS.md + SKILL.md, «Ports and
adapters»). Не редагувати лише одну копію.

### I2. Схема `digests` у БД не підтримує те, що робить сервіс

**Файл:** `server/src/db/schema/ops.ts:41-49`, проти `service.ts:26,43,56`

Таблиця має рівно: `id`, `workspaceId`, `periodStart`, `periodEnd`, `bodyMd`,
`deliveredTo`. У ній **немає** `repoId`, немає звʼязку зі змерженими PR і немає
жодної колонки під audit-контекст.

А сервіс розраховує на:

- `listForRepo(workspaceId, repoId)` (`service.ts:43`) — скоуп по репозиторію,
  якого в таблиці не існує;
- `listMerged(workspaceId, repoId, from, to)` (`service.ts:26`) — читання
  змержених PR, тобто вже інша таблиця (`db/schema/pulls.ts`);
- `markDelivered(workspaceId, digestId, auditContext)` (`service.ts:56`) —
  куди писати `requestId` / `userAgent` / `ip`? `deliveredTo` — один `text`.

**Як правильно.** Перед мержем потрібна **нова** міграція
(`server/src/db/migrations/` — застосовані `.sql` не редагувати, AGENTS.md), і
рішення, чи `repoId` справді має бути на дайджесті. Окремо: якщо
`listMerged` читає таблицю `pulls`, це вже чужа предметна область — коли
запит іде інлайном через `container.db` по `t.pulls`, `depcruise` цього не
побачить (імпортується лише `db/schema`), але звʼязність реальна: SKILL.md,
«Blind spots», пункт 3. Правильний хід — репозиторій `pulls` на контейнері,
а не власний інлайн-запит по чужій таблиці.

### I3. Жоден роут не декларує `response`-схему

**Файл:** `routes.ts:19`, `routes.ts:24`, `routes.ts:41`

`server/src/modules/_shared/schemas.ts:14-27` пояснює, чому це не декорація:
серіалізатор валідує те, що **виходить** з процесу, тож хендлер, який почав
віддавати сирий Drizzle-рядок (з `workspaceId`, внутрішніми таймстемпами),
падає голосно, а не тихо розширює публічний API.

`GET /repos/:id/digests` (`routes.ts:19-22`) віддає результат
`repo.listForRepo` наскрізь — тобто рівно той сценарій, від якого схема
захищає: `workspaceId` витікає клієнту. `{ ok: true }` на `routes.ts:44` має
використати готовий `OkResponse` з `_shared/schemas.ts:26`.

Живі приклади: `modules/onboarding/routes.ts:30`, `modules/brief/routes.ts:43,53`.

### I4. Модуль не зареєстрований

**Файл:** `server/src/modules/index.ts`

Пункт 5 чеклиста нового модуля в SKILL.md: один запис у реєстрі. Без нього
плагін ніколи не монтується (роути просто не існують), а `depcruise` додатково
дасть `no-orphans` (`.dependency-cruiser.cjs:44-49`). Реєстрація статична
свідомо — динамічний `import()` `.ts` не переносний між tsx, бандлером і vitest.

### I5. У фікстурі бракує половини модуля

**Файл:** `service.ts:5-7`

Імпортуються `./repository.js`, `./helpers.js`, `./constants.js` — жодного з
цих файлів у теці немає. Отже, найважливіший шар — той, що реально торкається
таблиць, — ще не ревʼюшений. Вимога з чеклиста: репозиторій — єдине місце, що
торкається своїх таблиць, і **кожен** запит скоупиться по `workspaceId`.
Плюс `types.ts` (див. B1) і `constants.ts` — це публічна поверхня модуля,
єдине, що іншим модулям дозволено імпортувати.

---

## Дрібне

### M1. `POST` і `GET` віддають різні за формою обʼєкти

`service.ts:29-34` (`build`) повертає літерал `{ window, from, to, authors }` —
це не `DigestRecord` і воно ніде не персиститься. `listForRepo`
(`service.ts:43-45`) при цьому обіцяє `Promise<DigestRecord[]>`. Тобто
`POST /repos/:id/digests` «будує» дайджест, який `GET /repos/:id/digests`
ніколи не поверне. Або `build` зберігає рядок і повертає `DigestRecord`, або
ендпоінт треба назвати чесно (`/preview`). Декларація `response`-схеми з I3
зловила б це одразу.

### M2. `get()` мертвий

`service.ts:37-41` — публічний метод, який не викликає жоден роут і жоден
інший модуль. Або підключити (`GET /digests/:id`), або прибрати.

### M3. `authors` без обмеження розміру

`groupByAuthor(merged)` (`service.ts:33`) віддає все вікно одним обʼєктом. Для
активного репозиторію за тиждень це може бути дуже великий JSON. Не блокер, але
варте ліміту або пагінації — і `response`-схема (I3) робить це рішення явним.

---

## Що зроблено правильно

Щоб ревʼю не читалося як суцільне «ні»:

- `constructor(private container: Container)` + `new DigestsRepository(container.db)`
  (`service.ts:20-22`) — рівно та форма, що в `modules/repos/service.ts`. Сервіс
  бере контейнер і будує свій репозиторій; ніяких `new`-ів адаптерів.
- Жодного прямого імпорту з `src/adapters/**` — `no-direct-adapter-clients`
  чистий.
- `NotFoundError` з `platform/errors.js` замість голого `Error`
  (`service.ts:27,39`) — правильний клас, просто роут (B3) не дає йому
  спрацювати.
- `getContext(app.container, req)` у кожному роуті (`routes.ts:20,25,42`) —
  tenancy не забутий у жодному з трьох.
- `IdParams` на всіх трьох роутах — `:id` валідується як uuid на краю.
- Чиста межа модуля: жодного імпорту з `../<інший-модуль>/` —
  `no-cross-module-internals` чистий.

---

## Порядок дій перед PR

1. Прибрати `fastify` з `service.ts` (B1) — інакше CI червоний.
2. Визначитись з контрактами в `vendor/shared` обох копій (I1) — інакше `tsc` червоний.
3. `schema.body` + `schema.response` замість ручного парсингу (B2, I3),
   з урахуванням пастки `.nullish()`.
4. Викинути `try/catch` з `routes.ts:31-38` (B3).
5. Міграція під `repoId` / audit-колонки або перегляд моделі (I2).
6. Дописати `repository.ts` / `helpers.ts` / `constants.ts` / `types.ts` і
   віддати на окреме ревʼю (I5); зареєструвати модуль (I4).
7. `node scripts/verify.mjs --slice backend` — локально, до пушу.
