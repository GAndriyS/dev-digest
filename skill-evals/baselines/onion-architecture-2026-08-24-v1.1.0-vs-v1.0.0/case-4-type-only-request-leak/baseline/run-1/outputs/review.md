# Ревʼю модуля `digests` перед вливанням у `server/src/modules/digests`

Файли: `.claude/skills/onion-architecture/evals/fixtures/digests-module/routes.ts`,
`.claude/skills/onion-architecture/evals/fixtures/digests-module/service.ts`.
Нічого не редаговано.

Вердикт: **не вливати як є**. Є щонайменше два блокери, які покладуть CI
(`depcruise` і `tsc`), і кілька відхилень від конвенцій репозиторію.

---

## Блокери

### 1. Fastify протік у сервіс — `service-stays-http-agnostic` впаде в CI

**Файл:** `service.ts`, рядки **1**, **47–53**, **55–57**

```ts
1:  import type { FastifyRequest } from 'fastify';
47: private auditContext(req: FastifyRequest) { ... }
55: async recordDelivery(req: FastifyRequest, workspaceId: string, digestId: string)
```

**Чому це проблема.**
Сервіс — це кільце застосунку; воно не має права знати про транспорт. Правило
`service-stays-http-agnostic` у `server/.dependency-cruiser.cjs:63-70` забороняє
будь-яке ребро з `^src/modules/.+/(service|repository|helpers)\.ts$` у
`node_modules/(fastify|fastify-type-provider-zod|fastify-sse-v2)/`. Коментар
правила формулює намір прямо: «A service must be callable from a job, a CLI, or
a test without a request. Needs the request? Take the resolved values as
arguments.»

**Окремо наголошую: `import type` тут НЕ рятує.** Це найпоширеніша хибна
інтуїція в цьому місці, бо в сусідньому правилі `import type` справді
дозволений. Різниця механічна й перевіряється в конфізі:

- `options.tsPreCompilationDeps: true` (`.dependency-cruiser.cjs`, блок
  `options`) — граф будується **до** стирання типів, тому type-only ребро в
  ньому присутнє.
- `no-direct-adapter-clients` (рядок 72) має явний виняток
  `dependencyTypesNot: ['type-only']` — саме тому `import type` порту законний
  (SKILL.md: «`import type` of a port interface is always fine»).
- `service-stays-http-agnostic` (рядок 63) такого винятку **не має**. Отже
  `import type { FastifyRequest }` — це порушення такого ж рівня, як звичайний
  імпорт.

Виняток для портів існує тому, що назвати абстракцію — і є мета. `FastifyRequest`
не абстракція домену, це транспортний тип; називати його зсередини сервісу нема
жодного сенсу — саме це правило й ловить.

Практичний бік, а не тільки лінтер: `recordDelivery` неможливо викликати з
джоби (`platform/jobs.ts`), з CLI чи з юніт-тесту без того, щоб зліпити фейковий
`FastifyRequest`. `modules/repos/service.ts` — еталон протилежного підходу.

**Як правильно.**
Резолвити аудит-контекст на межі й передавати вже готове значення:

```ts
// types.ts (або constants.ts) модуля — публічна поверхня модуля
export interface DeliveryAudit { requestId: string; userAgent: string; ip: string; }

// routes.ts — межа, тут FastifyRequest доречний
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

// service.ts — жодного імпорту з 'fastify'
async recordDelivery(workspaceId: string, digestId: string, audit: DeliveryAudit): Promise<void>
```

Зверни увагу на порядок аргументів: `workspaceId` першим, як у решті методів
цього ж класу (`build`, `get`, `listForRepo`) і як у `repos/service.ts`. У
поточному коді `recordDelivery(req, workspaceId, digestId)` ще й ламає власну
конвенцію файлу.

### 2. Контрактів `DigestBuild` / `DigestWindow` / `DigestRecord` не існує — `tsc` впаде

**Файли:** `routes.ts:3`, `service.ts:2`

```ts
routes.ts:3   import { DigestBuild } from '@devdigest/shared';
service.ts:2  import type { DigestRecord, DigestWindow } from '@devdigest/shared';
```

**Чому це проблема.** Жодного з трьох імен немає ні в
`server/src/vendor/shared/**`, ні в `client/src/vendor/shared/**` (перевірено
grepʼом по обох деревах — 0 збігів). У канонічній копії
(`server/src/vendor/shared/contracts/productionize.ts:192-211`) під digest є
рівно два експорти:

```ts
export const Digest = z.object({ id, period_start, period_end, body_md, delivered_to });
export const DigestRunRequest = z.object({ period_start?, period_end? });
```

Тобто наявний контракт описує **діапазон ISO-дат**, а фікстура — **іменоване
вікно** (`DigestWindow`, `DEFAULT_WINDOW`). Це не дрібна невідповідність назв, а
дві різні моделі запиту, і треба свідомо обрати одну.

**Як правильно.** Або перевикористати `DigestRunRequest`/`Digest`, або додати
нові схеми в **серверну копію** `vendor/shared` (вона канонічна) і **віддзеркалити
їх у `client/src/vendor/shared/contracts/productionize.ts`** — обидва типи
перетинають дріт, а AGENTS.md прямо забороняє правити лише одну копію.

---

## Порушення конвенцій

### 3. Ручний `safeParse` у хендлері замість `schema.body`

**Файл:** `routes.ts`, рядки **26–29**

```ts
const parsed = DigestBuild.safeParse(req.body);
if (!parsed.success) {
  return reply.code(400).send({ error: 'invalid_window', details: parsed.error.flatten() });
}
```

**Чому це проблема.** Три окремі наслідки:

1. AGENTS.md і SKILL.md кажуть однозначно: «Never hand-roll `Schema.parse(req.body)`
   in a handler» — валідація декларується схемою й відпрацьовує **до** хендлера.
2. **Неправильний статус.** Уся решта API віддає на невалідний вхід **422**
   (`app.ts:129-141`, `_shared/schemas.ts:8-10`). Тут — 400. Клієнт, який
   розрізняє валідацію за статусом, зламається саме на цьому роуті.
3. **Неправильний конверт помилки.** Канонічне тіло —
   `{ error: { code, message, details } }` (`platform/errors.ts` + `app.ts:129-176`).
   Тут повертається пласке `{ error: 'invalid_window', details }`, де `error` —
   рядок, а не обʼєкт. Це мовчазне розширення публічного API у бік, якого
   фронтенд не розбирає.

**Як правильно.**

```ts
app.post('/repos/:id/digests',
  { schema: { params: IdParams, body: DigestBuild, response: { 200: /* ... */ } } },
  async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.build(workspaceId, req.params.id, req.body.window);
  });
```

Невалідний body тоді сам стане 422 із канонічним конвертом, а хендлер схудне до
двох рядків.

### 4. Ручний маппінг доменної помилки за текстом повідомлення

**Файл:** `routes.ts`, рядки **31–38** (у парі зі `service.ts:27`)

```ts
if (err instanceof Error && err.message === 'Nothing merged in this window') {
  return reply.code(404).send({ error: 'empty_window', message: err.message });
}
```

**Чому це проблема.** Сервіс уже кидає `NotFoundError` (`service.ts:27`), а
`app.ts:166-171` уже мапить будь-який `AppError` у його власний статус із
правильним конвертом. Тобто цей `try/catch` дублює наявний механізм — і робить
це гірше:

- порівняння за **текстом** повідомлення: будь-яке редагування рядка в сервісі
  тихо ламає роут, і жоден тест на це не вкаже;
- код помилки розʼїжджається — глобальний хендлер віддав би `not_found`, а тут
  зʼявляється `empty_window`, якого нема в таксономії `platform/errors.ts`;
- знову плаский конверт `{ error: 'empty_window', message }` замість
  `{ error: { code, message, details } }`.

**Як правильно.** Прибрати `try/catch` цілком і дати помилці дійти до
`setErrorHandler`. Якщо «порожнє вікно» справді має бути окремим кодом для UI —
завести підклас у `platform/errors.ts` (за зразком `NoProviderKeyError`) і
кидати його з сервісу; роут не мапить нічого руками.

Окремо варто перепитати продуктове рішення: «за це вікно нічого не змерджено» —
це радше порожній результат (200 із порожнім списком авторів), ніж 404. 404
змушує клієнта ловити помилку для цілком штатного стану.

### 5. Немає жодної `response`-схеми

**Файл:** `routes.ts`, рядки **19**, **24**, **41**

**Чому це проблема.** `_shared/schemas.ts:14-25` пояснює, що
`schema.response[200]` — не декорація: серіалізатор валідує те, що **виходить** з
процесу, тож хендлер, який почне повертати сирий рядок Drizzle (з `workspaceId`,
внутрішніми таймстемпами), впаде голосно, а не розширить публічний API тихцем.
Еталон поруч — `modules/brief/routes.ts:41-49`, де `response: { 200: PrWhyBrief }`
стоїть на обох роутах.

Найгостріше це на `GET /repos/:id/digests` і `POST /repos/:id/digests`, бо вони
віддають те, що прийшло з репозиторію.

**Як правильно.** Оголосити `response: { 200: … }` на всіх трьох роутах; для
`/digests/:id/delivered` уже є готове `OkResponse` з `_shared/schemas.ts:26` —
`{ ok: true }` на рядку 44 повертається без схеми, хоча схема буквально
існує під це.

### 6. Модуль неповний: немає `repository.ts`, `helpers.ts`, `constants.ts`

**Файл:** `service.ts`, рядки **5–7**

```ts
import { DigestsRepository } from './repository.js';
import { groupByAuthor, windowBounds } from './helpers.js';
import { DEFAULT_WINDOW } from './constants.js';
```

**Чому це проблема.** У теці фікстури лежать тільки `routes.ts` і `service.ts` —
трьох імпортованих файлів немає. Це і `tsc`, і неможливість оцінити найважливіше
для onion: чи `repository.ts` — єдине місце, що торкається таблиць, і чи **кожен**
запит скоупиться `workspaceId`. Сигнатури сервісу натякають, що так
(`workspaceId` передається в усі чотири виклики репозиторію — це добре), але
перевірити нічим.

**Як правильно.** Донести всі три файли в PR і на ревʼю окремо перевірити
репозиторій на `where eq(t.digests.workspaceId, workspaceId)` у кожному запиті.
Також памʼятати: `constants.ts` / `types.ts` — єдина публічна поверхня модуля
(`no-cross-module-internals`, `.dependency-cruiser.cjs:83`); `repository.ts`,
`service.ts`, `helpers.ts` іншим модулям недоступні.

### 7. Модуль не зареєстровано в `src/modules/index.ts` → `no-orphans`

**Файл:** `server/src/modules/index.ts` (у фікстурі змін немає)

**Чому це проблема.** Реєстрація статична навмисне (динамічний `import()` `.ts`
не портабельний між tsx, бандлером і vitest). Поки `digests` немає в реєстрі,
`routes.ts` — недосяжний модуль, і правило `no-orphans`
(`.dependency-cruiser.cjs:43-48`) впаде з коментарем «Unreachable module — dead
code, or a missing registration in modules/index.ts».

**Як правильно.** Один імпорт + один запис у `modules`, як у чеклісті нового
модуля (крок 5).

---

## Зауваження меншого калібру

### 8. `markDelivered` пише аудит, для якого немає колонок

**Файл:** `service.ts:56` проти `server/src/db/schema/ops.ts:41-50`

Таблиця `digests` має рівно пʼять колонок: `id`, `workspaceId`, `periodStart`,
`periodEnd`, `bodyMd`, `deliveredTo`. Ані `requestId`, ані `userAgent`, ані `ip`
записати нікуди. Тобто аудит-контекст із пункту 1 — це не лише порушення межі,
а ще й дані без місця призначення: або потрібна нова міграція (нова, не правка
застосованої — `server/src/db/migrations/*.sql` чіпати не можна), або аудит слід
викинути й спростити `recordDelivery(workspaceId, digestId)`. Другий варіант
заодно знімає блокер №1 повністю.

### 9. `build()` нічого не персистить, а повертає ad-hoc обʼєкт

**Файл:** `service.ts:24-35`

Докстрінг роуту (`routes.ts:12`) каже «build one for the requested window», у
схемі БД є таблиця `digests` — але `build` лише читає змерджені PR і повертає
обчислений обʼєкт `{ window, from, to, authors }`, який не збігається ні з
`DigestRecord` (що його повертають два інші методи), ні з рядком таблиці. Тобто
«побудований» дайджест ніде не зберігається, і `GET /repos/:id/digests` його
потім не побачить. Схоже на незавершену реалізацію — варто зафіксувати намір до
мержу.

### 10. `get()` — мертвий код

**Файл:** `service.ts:37-41`

Роуту `GET /digests/:id` немає, метод ніхто не викликає. `no-orphans` працює на
рівні файлів і цього не спіймає, тож або додати роут, або прибрати метод.

---

## Що зроблено правильно (не чіпати на рефакторингу)

- `constructor(private container: Container)` + `new DigestsRepository(container.db)`
  (`service.ts:20-22`) — рівно шаблон `modules/repos/service.ts`, сервіс не
  конструює адаптери сам.
- `getContext(app.container, req)` на кожному роуті — тенансі не забуто ніде.
- `workspaceId` першим аргументом у `build`/`get`/`listForRepo` і далі в кожен
  виклик репозиторію.
- `NotFoundError` з `platform/errors.ts`, а не самописний клас помилки.
- `IdParams` з `_shared/schemas.ts` на всіх трьох роутах.

---

## Чекліст перед мержем

| # | Що | Де | Блокер |
|---|---|---|---|
| 1 | Прибрати `FastifyRequest` із сервісу | `service.ts:1,47,55` | так (depcruise) |
| 2 | Завести/узгодити контракти digest + дзеркало в client | `routes.ts:3`, `service.ts:2` | так (tsc) |
| 3 | `schema.body` замість `safeParse`, 422 + канонічний конверт | `routes.ts:26-29` | так |
| 4 | Прибрати ручний маппінг помилки за текстом | `routes.ts:31-38` | так |
| 5 | Додати `response` схеми (є готовий `OkResponse`) | `routes.ts:19,24,41` | ні |
| 6 | Донести `repository.ts` / `helpers.ts` / `constants.ts` | тека модуля | так |
| 7 | Зареєструвати модуль | `src/modules/index.ts` | так (no-orphans) |
| 8 | Визначитись з аудит-полями або міграцією | `db/schema/ops.ts:41` | ні |
| 9 | Визначитись, чи `build()` персистить | `service.ts:24` | ні |
| 10 | Прибрати або заекспонувати `get()` | `service.ts:37` | ні |

Локальна перевірка після правок:

```bash
node scripts/verify.mjs --slice backend
# або точково:
cd server && pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs
```
