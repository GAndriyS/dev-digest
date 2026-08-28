# Ревʼю гілки `publisher` — перед мерджем

Матеріал: `.claude/skills/onion-architecture/evals/fixtures/publisher-module/`
(`routes.ts`, `service.ts`, `repository.ts`, `publisher.it.test.ts`,
`container.excerpt.ts`, `mocks.excerpt.ts`). Звірено з реальним деревом
`server/` на поточній гілці (`platform/container.ts`, `platform/errors.ts`,
`platform/resilience.ts`, `modules/reviews/repository.ts`, `db/schema/**`,
`test/**`, `.dependency-cruiser.cjs`, `vitest.config.ts`, `scripts/verify.mjs`).

**Вердикт: не мерджити.** Каркас модуля правильний (див. «Що зроблено
правильно»), але зламано seam контейнера для нового порту `SlackClient`, і
разом із ним — інвалідацію кешу секретів. Це саме той клас дефекту, який не
бачить ні `depcruise`, ні typecheck: це пропуск у списку, а не імпорт.
Плюс кілька помилок, які не компілюються або течуть між воркспейсами.

Нумерація рядків — за файлами фікстури (для `container.excerpt.ts` у дужках
даю відповідник у реальному `server/src/platform/container.ts`).

---

## Блокери

### 1. `invalidateSecretCaches()` не скидає `_slack` — ротація токена нічого не змінює

**Файл:** `container.excerpt.ts:106-110` (реально `server/src/platform/container.ts:260-264`)

```ts
invalidateSecretCaches(): void {
  this.llmCache.clear();
  this._github = undefined;
  this._embedder = undefined;
}
```

Гілка додала четвертий кеш — `private _slack?: SlackClient` (`container.excerpt.ts:49`),
який будується з секрету `SLACK_BOT_TOKEN` (`:75-77`) — і не додала його сюди.

**Чому це проблема.** `invalidateSecretCaches()` — це **список, який чиститься
руками**, а не обхід усіх полів. Його викликає `server/src/modules/settings/routes.ts`
одразу після `secrets.set(...)` (рядок ~85, шлях `POST /settings/test-connection`;
той самий виклик стоїть і на записі секретів). Наслідок для користувача:
він вставляє новий Slack-токен, UI пише «збережено» і навіть «Connected»,
а `container.slack()` до кінця життя процесу віддає клієнта зі **старим,
відкликаним** токеном. Кожна публікація йде з мертвим ключем, поки хтось не
перезапустить сервер. Стек-трейсу не буде — буде тікет у підтримку.

CI цього не спіймає: `depcruise` читає імпорти, а тут імпорту немає взагалі —
є відсутній рядок.

**Як правильно:**

```ts
invalidateSecretCaches(): void {
  this.llmCache.clear();
  this._github = undefined;
  this._embedder = undefined;
  this._slack = undefined;
}
```

І в докблоці над методом (`:102-105`) варто явно записати правило: **кожен
новий лінивий геттер, побудований зі значення `SecretsProvider`, зобовʼязаний
зʼявитися в цьому списку**. Ідеальний варіант — тримати кеші в одній мапі
(`Map<string, unknown>`), яку `invalidate` чистить цілком, щоб забути стало
неможливо.

### 2. `slack()` не перевіряє `overrides` — порт неможливо підмінити

**Файл:** `container.excerpt.ts:73-79` (геттер) і `:27-39` (`ContainerOverrides`)

```ts
async slack(): Promise<SlackClient> {
  if (this._slack) return this._slack;      // ← немає `if (this.overrides.slack) ...`
  const token = await this.secrets.get('SLACK_BOT_TOKEN');
  ...
}
```

`ContainerOverrides` перелічує `secrets`, `auth`, `github`, `git`, `codeIndex`,
`embedder`, `llm`, `repoIntel`, `projectContext`, `blast` — але **не** `slack`.

**Чому це проблема.** Порядок «`overrides.<x>` перевіряється **першим**, потім
кеш, потім побудова» — це не стиль, це єдина причина, чому працює підстановка
`adapters/mocks.ts`. Геттер без цієї перевірки компілюється, проходить
`depcruise` і тихо робить порт немокабельним. Порівняйте з сусідами в тому ж
файлі: `github()` (`:60`), `embedder()` (`:92`), `llm()` (`:82`) — усі три
починають саме з `overrides`.

**Як правильно:**

```ts
export interface ContainerOverrides {
  ...
  /** Slack delivery (L06) — тести інжектять MockSlackClient. */
  slack?: SlackClient;
}

async slack(): Promise<SlackClient> {
  if (this.overrides.slack) return this.overrides.slack;
  if (this._slack) return this._slack;
  ...
}
```

### 3. Немає `MockSlackClient` в `adapters/mocks.ts`

**Файл:** `mocks.excerpt.ts:6-18` (звірено з реальним `server/src/adapters/mocks.ts` — там 12 експортів, `MockSlackClient` серед них немає)

Правило для нового порту — **чотири елементи, або seam зламано**:

1. інтерфейс у `server/src/vendor/shared/adapters.ts` (серверна копія канонічна) — зроблено (`SlackClient` імпортується в контейнері);
2. адаптер у `server/src/adapters/slack/slack.client.ts` — зроблено;
3. лінивий геттер **+ запис у `ContainerOverrides`** — зроблено наполовину (див. п. 2);
4. мок у `adapters/mocks.ts` — **не зроблено**.

Наслідок п. 3 і 4 видно неозброєним оком у тесті — див. п. 4.

### 4. Інтеграційний тест мокає шлях модуля замість того, щоб інжектити порт

**Файл:** `publisher.it.test.ts:7-13`

```ts
vi.mock('../../adapters/slack/slack.client.js', () => ({
  SlackWebhookClient: class { postMessage = postMessage; },
}));
```

**Чому це проблема.** Це прямий наслідок пунктів 2-3: підмінити адаптер через
`ContainerOverrides` неможливо, тож тест підмінює **шлях імпорту**. Такий тест
привʼязаний до графа імпортів, а не до порту: перейменування файлу адаптера,
зміна імені класу чи будь-яка зміна способу конструювання клієнта в контейнері —
і мок мовчки перестає застосовуватись (тест піде в реальний Slack або впаде
незрозумілою помилкою). Саме тому в репозиторії підстановка робиться через
контейнер: `new Container(config, db, { github: mockGitHub })`
(див. `server/test/integration.it.test.ts`, `MockLLMProvider`/`MockGitClient`).

**Як правильно:** після виправлення п. 2-3 —

```ts
const slack = new MockSlackClient();
container = new Container(loadConfig(), db, { slack });
```

і жодного `vi.mock`.

### 5. `err.status` не існує на `AppError` — ретраї мертві, typecheck червоний

**Файл:** `service.ts:137`

```ts
if (err instanceof AppError) return err.status >= 500 || err.code === 'slack_rate_limited';
```

`server/src/platform/errors.ts:9-19` визначає `AppError` з полем **`statusCode`**
(`public readonly statusCode = 400`), поля `status` немає. TS це відхилить
(`Property 'status' does not exist on type 'AppError'`), а якщо десь пройде —
`undefined >= 500` це `false`, тобто **жодна 5xx-помилка ніколи не позначиться
`retryable`**, і весь `POST /publications/retry` існує даремно.

**Як правильно:** використати наявний хелпер, який якраз для цього й написаний —
`httpStatusOf(err)` з `server/src/platform/resilience.ts:37-43` (він знає, що
Octokit кладе статус у `.status`, а Fastify/`AppError` — у `.statusCode`):

```ts
private isRetryable(err: unknown): boolean {
  const status = httpStatusOf(err);
  if (status != null) return status >= 500 || status === 429;
  return err instanceof Error && /ETIMEDOUT|ECONNRESET|fetch failed/.test(err.message);
}
```

### 6. `listRecent()` не скоупиться воркспейсом — витік між тенантами

**Файл:** `repository.ts:90-99`

```ts
async listRecent(prIds: string[]): Promise<PublishRecord[]> {
  const rows = await this.db.select().from(t.publications)
    .where(inArray(t.publications.prId, prIds))   // ← жодного workspaceId
```

**Чому це проблема.** Чек-лист модуля: репозиторій — єдине місце, що торкається
своїх таблиць, і **кожен запит скоупиться `workspaceId`**. Решта методів цього ж
файлу це роблять (`:46`, `:61`, `:68`, `:80`) — цей один ні. Достатньо, щоб
викликач передав чужий `prId` (а він приходить з HTTP), і рядки іншого
воркспейсу поїдуть у відповідь. Метод до того ж ніким не викликається — мертвий
код із діркою в тенантності.

**Як правильно:** або видалити метод до появи реального споживача, або
`where(and(eq(t.publications.workspaceId, workspaceId), inArray(...)))` з
обовʼязковим першим аргументом `workspaceId: string`.

### 7. `attempts` ніколи не інкрементується, а `PUBLISH_RETRY_LIMIT` — не ліміт спроб

**Файли:** `repository.ts:60` + `repository.ts:102-104`, `service.ts:78`

```ts
.set({ status, error, attempts: sqlIncrement() })
...
function sqlIncrement() {
  return undefined as unknown as number;   // ← заглушка, замаскована кастом
}
```

Каст `undefined as unknown as number` бреше системі типів: Drizzle просто
викине `undefined`-поле з `UPDATE`, тож `attempts` вічно лишається початковим.
Далі, `service.ts:78` вживає `PUBLISH_RETRY_LIMIT` як **`LIMIT` SQL-вибірки**
(`listRetryable(workspaceId, PUBLISH_RETRY_LIMIT)`), а не як стелю кількості
спроб. Разом це означає: рядок, який падає завжди, ретраїться **нескінченно**,
щоразу стукаючи в Slack.

**Як правильно:**

```ts
import { sql } from 'drizzle-orm';
...
.set({ status, error, attempts: sql`${t.publications.attempts} + 1` })
```

а у вибірці ретраїв додати умову стелі:
`and(eq(status,'retryable'), lt(t.publications.attempts, PUBLISH_RETRY_LIMIT))`,
і окремо — розумний `limit()` на розмір батча (це різні числа, їм потрібні
різні константи).

### 8. `retryFailed()` шле в Slack усе підряд, ігноруючи `row.target`

**Файл:** `service.ts:81-97` (конкретно `:90`)

```ts
const result = await this.deliverToSlack(review, pull.title, row.channel ?? undefined);
```

`publish()` розрізняє таргети (`service.ts:64-67`), а ретрай — ні. Рядок із
`target: 'markdown'`, який колись позначили `retryable`, при ретраї полетить
повідомленням у Slack-канал. Це не архітектурна причіпка — це доставка не туди,
куди просив користувач.

**Як правильно:** винести вибір доставки в один приватний метод
(`deliver(target, review, title, channel)`), який викликають обидві гілки —
`publish()` і `retryFailed()`. Заодно зникне дублювання обробки помилки
(`:70-74` і `:93-96` — байт у байт однакові).

### 9. Виклики `container.reviewRepo` не збігаються з реальним API `ReviewRepository`

**Файл:** `service.ts:49`, `:82-83`, `:132`

- `listReviews(workspaceId, prId)` — такого методу в
  `server/src/modules/reviews/repository.ts` **немає взагалі**; найближчий —
  `reviewsForPull(prId)` (рядок 65), який повертає
  `{ review, findings }[]`, а не `ReviewRecord[]`.
- `getReview(workspaceId, row.reviewId)` — реальний `getReview(reviewId)`
  (рядок 69) приймає **один** аргумент.
- `getPull(workspaceId, prId)` (рядок 32) — єдиний, що збігається.

Це не компілюється. Напрям виправлення — правильний (спільний репозиторій
береться з контейнера, а не імпортом чужої папки), тож або підганяємо виклики
під наявні сигнатури, або **розширюємо `ReviewRepository`** новим методом
`listReviews(workspaceId, prId)` — з обовʼязковим `workspaceId`, бо
`reviewsForPull`/`getReview` сьогодні його не питають, а publisher має бути
скоупленим. Що не можна робити — писати запит до `t.reviews` інлайном через
`container.db`: `depcruise` промовчить, а чужа таблиця стане вашою.

### 10. Таблиці `publications` немає ані в схемі, ані в міграціях

**Файл:** `repository.ts:4, 24, 38, 66, 76, 92, 106`

`t.publications` не існує в `server/src/db/schema/**` (перевірено — там є
`digests` у `ops.ts`, але не `publications`), тож `import * as t from
'../../db/schema.js'` дасть помилку типів на кожному запиті.

**Як правильно:** додати таблицю у відповідний файл `server/src/db/schema/*.ts`
(колонки `workspaceId`, `prId`, `reviewId`, `target`, `channel`, `status`,
`attempts`, `externalId`, `body`, `error`, `createdAt`, `deliveredAt` — саме їх
читає `toDto`) **плюс нову міграцію**. Наявні `.sql` у
`server/src/db/migrations/` вже застосовані — їх не чіпаємо, додаємо нову.
Нагадування: міграції не накочуються на старті, треба `cd server && pnpm db:migrate`.

### 11. `config.slackDefaultChannel` не оголошено

**Файл:** `container.excerpt.ts:77`

```ts
this._slack = new SlackWebhookClient(token, this.config.slackDefaultChannel);
```

У `server/src/platform/config.ts` поля `slackDefaultChannel` немає (і взагалі
жодної згадки Slack). Треба додати його до Zod-схеми конфігу з дефолтом,
інакше typecheck червоний, а канал за замовчуванням — `undefined`.

---

## Тести

### 12. Файл лежить не там, спирається на неіснуючі хелпери й не гейтиться Docker-ом

**Файл:** `publisher.it.test.ts:1-32`

Три окремі речі:

1. **Розташування.** Усі 12+ DB-тестів репозиторію лежать у `server/test/*.it.test.ts`
   (`reviews.it.test.ts`, `blast.it.test.ts`, `skills.it.test.ts`, …), а цей —
   у `server/src/modules/publisher/`. Формально лани не поламані (`vitest.config.ts`
   інклюдить і `src/**/*.test.ts`, а розділ ланів у `scripts/verify.mjs:117,131`
   і в `.github/workflows/*` іде по підрядку `.it.test`), але це розходження з
   конвенцією — перенести у `server/test/publisher.it.test.ts`.
2. **Хелперів не існує.** `../../../test/helpers/db.js` немає; у `server/test/helpers/`
   є лише `pg.ts` (`startPg`, `dockerAvailable`, `PgFixture`) і `runs.ts`.
   Функцій `makeDb`, `resetDb`, `seedWorkspace`, `seedPull`, `seedReview` не існує —
   імпорт впаде.
3. **Немає self-skip без Docker.** Конвенція інтеграційної лани (див. коментар у
   `scripts/verify.mjs:31` і будь-який існуючий `*.it.test.ts`):

   ```ts
   const hasDocker = await dockerAvailable();
   const d = hasDocker ? describe : describe.skip;
   ```

   Без цього набір не «самоскіпнеться», а впаде на машині чи в джобі без Docker.

Додатково: `secrets: { get: ... } as never` (`:26-30`) — каст, який глушить
компілятор. Для цього вже є `MockSecretsProvider` у `adapters/mocks.ts`.

---

## Контракти й крайовий шар

### 13. Жоден маршрут не оголошує `schema.response`

**Файл:** `routes.ts:19, 24-32, 34`

`server/src/modules/_shared/schemas.ts:14-26` прямо фіксує правило: response-схема
не декорація — серіалізатор валідує те, що виходить із процесу, тож хендлер,
який раптом почав віддавати сирий Drizzle-рядок (з `workspaceId`, внутрішніми
таймстемпами), падає голосно, а не розширює публічний API мовчки. Тут усі три
маршрути віддають те, що поверне сервіс, без схеми.

**Як правильно:** `schema: { params: IdParams, response: { 200: PublishRecord } }`,
для списку — `z.array(PublishRecord)`, для `/publications/retry` — власна
`z.object({ sent: z.number().int() })` (у `_shared/schemas.ts` для таких відповідей
уже є приклад `OkResponse`). Одна Zod-схема має вести і валідацію запиту, і
серіалізацію відповіді.

### 14. `POST /publications/retry` без rate-limit

**Файл:** `routes.ts:34`

Маршрут одним викликом породжує N вихідних HTTP-запитів у Slack, скоуп —
цілий воркспейс, тіла й ідемпотентності немає. Усі інші «дорогі назовні»
маршрути в репозиторії лімітовані: `settings/routes.ts:72`, `reviews/routes.ts:29,151`,
`blast/routes.ts:33`, `brief/routes.ts:54`, `onboarding/routes.ts:50`.

**Як правильно:** `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`.

### 15. Валідація `target` продубльована в сервісі

**Файл:** `service.ts:45-47` (+ `SUPPORTED_TARGETS` у `constants.ts`)

Парсимо на межі — всередині кілець дані вже довірені. Якщо `PublishRequest`
описує `target` як enum, ця перевірка недосяжна (мертвий код); якщо ж вона
реально спрацьовує — значить контракт занадто широкий, і чинити треба **його**,
а не додавати другу перевірку в сервісі. `SUPPORTED_TARGETS` тоді має бути
джерелом для Zod-enum, а не паралельним списком, який розʼїдеться з ним.

### 16. Свій код помилки замість наявної таксономії

**Файл:** `service.ts:110-118` + `SLACK_NOT_CONFIGURED_CODE` у `constants.ts`

`server/src/platform/errors.ts:47-62` уже містить `NoProviderKeyError` з
коментарем, що це **один клас на всі фічі**, аби «код, статус і формулювання не
розʼїхались по модулях» — і навіть текст там той самий: «… add one in Settings
to <action>.». Модуль натомість заводить власний wire-код у `constants.ts`
і вручну складає 409.

**Як правильно:** кинути `new NoProviderKeyError('slack', 'publish to Slack')`,
або, якщо Slack — не «provider key» у сенсі клієнта, додати сусідній клас у
`platform/errors.ts` і експортувати код звідти. Wire-код, на який зав'язаний
клієнт, не має жити в `constants.ts` окремого модуля.

### 17. `toDto` губить `body` — markdown-таргет нічого не повертає

**Файли:** `repository.ts:106-119`, `service.ts:67`

Для `target: 'markdown'` сервіс кладе відрендерений markdown у
`{ externalId: null, body: renderMarkdown(...) }`, репозиторій записує його в
колонку, а `toDto` поле `body` у DTO не мапить. Тобто `POST /pulls/:id/publications`
з `target=markdown` повертає запис зі `status: 'delivered'` і **без самого
markdown** — фіча, заради якої існує цей таргет («блоб, який можна вставити
будь-де»), недосяжна через API. Тест `publisher.it.test.ts:65-72` це не ловить,
бо перевіряє лише статус.

**Як правильно:** додати `body` до `PublishRecord` (і віддзеркалити в клієнтську
копію контрактів) або віддавати markdown окремим полем відповіді. І покрити
тестом вміст, а не тільки статус.

### 18. `latestReview()` не «latest»

**Файл:** `service.ts:131-134`

```ts
const reviews = await this.container.reviewRepo.listReviews(workspaceId, prId);
return reviews.find((r) => r.kind === 'review') ?? null;
```

`find()` бере **перший у порядку, який повернула БД**. Якщо репозиторій не
гарантує `ORDER BY created_at DESC`, опублікується випадкове (часто найстаріше)
ревʼю. Порядок має бути заданий явно в SQL (як це зроблено в
`repository.ts:69,84` для publications), а не матись на увазі.

### 19. `row!` замість помилки

**Файл:** `repository.ts:29, 49`

`markDelivered` шукає рядок за `(workspaceId, id)`; якщо не знайшов —
`.returning()` дає порожній масив, і `toDto(row!)` кине
`TypeError: Cannot read properties of undefined`, тобто 500 із сирим стеком
замість `NotFoundError`. Перевірити `if (!row) throw new NotFoundError(...)`.

### 20. Реєстрація модуля не показана

`server/src/modules/index.ts` у фікстурі відсутній, і в поточному дереві
`publisher` там не зареєстрований. Без одного імпорту + одного запису
маршрути просто не існують у застосунку, а `routes.ts` стане orphan-ом
(правило `no-orphans`, severity `warn`). Реєстрація статична навмисне —
динамічний `import()` `.ts` не переносний між tsx, бандлером і vitest.

### 21. Дзеркалення контрактів у клієнтську копію

`routes.ts:3` і `service.ts:1-6` тягнуть `PublishRequest`, `PublishRecord`,
`PublishTarget`, `PublishStatus` з `@devdigest/shared`, а контейнер — порт
`SlackClient`. Канонічна копія — `server/src/vendor/shared`; усе, що перетинає
дріт (усі чотири `Publish*`), **зобовʼязане** бути віддзеркалене в
`client/src/vendor/shared`. Порт `SlackClient` — серверний, у клієнта йому
робити нічого. У фікстурі жодного з цих файлів немає — перевірити в діффі
гілки перед мерджем.

### 22. Дрібниця: `inArray` з одним елементом

**Файл:** `repository.ts:81` — `inArray(t.publications.status, ['retryable'])`
читається як «тут колись буде список»; поки його немає, це `eq(..., 'retryable')`.

---

## Що зроблено правильно (не ламати при виправленні)

- Шар за шаром: `routes.ts` парсить і делегує, `service.ts` вирішує, `repository.ts`
  — єдине місце, що торкається `publications`. `depcruise`-правила
  `routes-through-service` і `service-stays-http-agnostic` не порушені: у роуті
  немає Drizzle, у сервісі немає Fastify — навіть як `import type`.
- Сервіс бере `Container` і сам будує свій репозиторій із `container.db`
  (`service.ts:35-37`) — рівно як `modules/repos/service.ts`.
- Дані чужого модуля беруться з `container.reviewRepo`, а не імпортом
  `../reviews/repository.js` і не інлайновим запитом до `t.reviews`. Напрям
  правильний, сигнатури — ні (п. 9).
- Рендеринг винесений у `helpers.ts` як чисті функції, літерали — у `constants.ts`.
- Сервіс приймає розвʼязані значення (`workspaceId`, `prId`, `target`), а не
  `FastifyRequest`; тенантність береться через `getContext` на краю.
- Лінива побудова Slack-клієнта (а не на старті) — правильне рішення, і докблок
  у `container.excerpt.ts:68-72` пояснює чому.
- «Спершу записати рядок `pending`, потім доставляти» — свідомий і добре
  задокументований вибір (`service.ts:26-30`).

---

## Мінімальний список до зеленого

1. `_slack = undefined` в `invalidateSecretCaches()` (п. 1).
2. `slack?: SlackClient` в `ContainerOverrides` + перевірка `overrides` першою в `slack()` (п. 2).
3. `MockSlackClient` у `adapters/mocks.ts`; тест переписати на `ContainerOverrides`, `vi.mock` прибрати (п. 3, 4).
4. `httpStatusOf` замість `err.status` (п. 5).
5. `workspaceId` у `listRecent` або видалити метод (п. 6).
6. Справжній інкремент `attempts` + стеля спроб у вибірці ретраїв (п. 7).
7. Єдиний `deliver()` для обох шляхів, з повагою до `row.target` (п. 8).
8. Узгодити виклики `reviewRepo` з реальним API або розширити `ReviewRepository` (п. 9).
9. Таблиця `publications` у схемі + **нова** міграція; `slackDefaultChannel` у конфіг (п. 10, 11).
10. Тест — у `server/test/`, на `startPg`/`dockerAvailable`, з `describe.skip` без Docker (п. 12).
11. `response`-схеми на трьох маршрутах, rate-limit на `/publications/retry` (п. 13, 14).
12. Реєстрація в `modules/index.ts`; дзеркалення `Publish*` у `client/src/vendor/shared` (п. 20, 21).

Після цього прогнати `node scripts/verify.mjs --slice backend` і
`--slice integration` — не інлайнити `tsc`/`depcruise`/`vitest` вручну.
І врахувати: зелений `depcruise` тут не доказ — пункти 1, 2, 3, 6 він не бачить
у принципі.
