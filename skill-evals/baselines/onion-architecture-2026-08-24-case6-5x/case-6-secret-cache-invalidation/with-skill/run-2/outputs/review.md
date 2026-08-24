# Ревʼю гілки `publisher` (server/src/modules/publisher + правка `platform/container.ts`)

Огляд за скіллом `onion-architecture`. Шляхи у форматі «файл фікстури → реальний файл гілки».
Фікстури: `.claude/skills/onion-architecture/evals/fixtures/publisher-module/`.

**Вердикт: мерджити не можна.** Гілка не пройде `pnpm typecheck` і не пройде інтеграційну лінію,
а головне — вона ламає seam портів (Slack-клієнт немокабельний) і додає кеш, побудований із секрету,
без інвалідації. `depcruise` при цьому буде зеленим: жодна з двох головних проблем не є імпортом.

---

## Блокери

### 1. Новий кеш із секрету не інвалідується — ротація Slack-токена не діє

**Файл:** `container.excerpt.ts:73-79` і `container.excerpt.ts:106-110`
(→ `server/src/platform/container.ts`)

`slack()` кешує клієнта в `this._slack`, побудованого з `SLACK_BOT_TOKEN`, прочитаного через
`SecretsProvider`. Але `invalidateSecretCaches()` очищає лише `llmCache`, `_github` і `_embedder` —
`_slack` там немає.

Чому це проблема: це список, який ведеться руками, а не свіп по полях. Виклик
`container.invalidateSecretCaches()` після запису нового ключа стоїть у
`server/src/modules/settings/routes.ts:84` (гілка publisher його не чіпала). Після цієї гілки
користувач може вставити новий Slack-токен, UI підтвердить «збережено», і кожна наступна
публікація й далі йтиме зі старим (відкликаним) токеном — до перезапуску процесу. Це не стектрейс,
а тікет у підтримку: симптом «токен правильний, а публікація 401». Ні `depcruise`, ні `tsc` цього
не бачать — це пропуск у списку, а не імпорт.

Як правильно:

```ts
invalidateSecretCaches(): void {
  this.llmCache.clear();
  this._github = undefined;
  this._embedder = undefined;
  this._slack = undefined;   // ← кожен кеш, побудований зі значення SecretsProvider
}
```

Правило, яке варто закріпити в самому коментарі методу: **додав ліниве поле, побудоване з
`this.secrets.get(...)` → додай його сюди в тому ж коміті.**

### 2. `slack()` не перевіряє `overrides` — порт немокабельний

**Файл:** `container.excerpt.ts:73-79` (getter) і `container.excerpt.ts:27-39` (`ContainerOverrides`)

Усі інші резолвери йдуть за шаблоном «`overrides.<x>` перший, кеш другий»:
`github()` — `container.excerpt.ts:60`, `embedder()` — `:92`, `llm()` — `:82`.
`slack()` одразу читає `this._slack` і не має відповідного поля в `ContainerOverrides`
(там є `github`, `git`, `codeIndex`, `embedder`, `llm`, `repoIntel`, `projectContext`, `blast` —
`slack` немає).

Чому це проблема: підстановка адаптерів через `new Container(config, db, { slack: mockSlack })` —
єдина причина, чому `adapters/mocks.ts` взагалі працює. Гетер без перевірки `overrides`
компілюється, проходить depcruise і тихо робить порт непідмінним. Наслідок видно одразу нижче
(пункт 4): тест був змушений мокати шлях модуля адаптера.

Як правильно:

```ts
export interface ContainerOverrides {
  // …
  slack?: SlackClient;
}

async slack(): Promise<SlackClient> {
  if (this.overrides.slack) return this.overrides.slack;
  if (this._slack) return this._slack;
  const token = await this.secrets.get('SLACK_BOT_TOKEN');
  if (!token) throw new ConfigError('SLACK_BOT_TOKEN is not configured');
  this._slack = new SlackWebhookClient(token, this.config.slackDefaultChannel);
  return this._slack;
}
```

### 3. Новий порт без мока — «усі чотири» не виконано

**Файл:** `mocks.excerpt.ts` (весь список експортів → `server/src/adapters/mocks.ts`)

Новий порт вимагає чотирьох речей: інтерфейс у `server/src/vendor/shared/adapters.ts` (є —
`SlackClient` імпортується в `container.excerpt.ts:17`), адаптер у `adapters/` (є —
`adapters/slack/slack.client.ts`), лінивий гетер + запис у `ContainerOverrides` (пункт 2, немає),
і мок у `adapters/mocks.ts`. У списку експортів моків є `MockLLMProvider`, `MockEmbedder`,
`MockGitHubClient`, `MockGitClient`, `MockCodeIndex`, `MockBlast`, `MockAuthProvider`,
`MockSecretsProvider` — `MockSlackClient` немає.

Як правильно: додати `export class MockSlackClient implements SlackClient` з керованим
`postMessage` (лічильник викликів + опція кинути помилку), як зроблено в `MockGitHubClient`.

### 4. Тест мокає шлях модуля замість порту

**Файл:** `publisher.it.test.ts:9-13`

```ts
vi.mock('../../adapters/slack/slack.client.js', () => ({ SlackWebhookClient: class { … } }));
```

Це прямий наслідок пунктів 2-3, але і сам по собі — порушення тестового seam. Мокання шляху
привʼязує тест до графа імпортів: перейменування файлу адаптера або зміна того, як контейнер його
конструює, ламає тест, який про адаптер нічого знати не повинен. `ContainerOverrides` привʼязує
тест до **порту** — саме тієї абстракції, яку сервіс і називає.

Плюс `publisher.it.test.ts:26-30` підсовує `secrets` з приведенням `as never` — теж симптом того ж
болю: щоб дійти до конструювання клієнта, тест мусить підробити секрет. З `overrides.slack` ані
`vi.mock`, ані фейковий секрет не потрібні:

```ts
const slack = new MockSlackClient();
container = new Container(loadConfig(), db, { slack });
```

### 5. Сервіс викликає неіснуючі методи `reviewRepo` — гілка не типчекається

**Файл:** `service.ts:82` і `service.ts:132`

- `service.ts:132`: `this.container.reviewRepo.listReviews(workspaceId, prId)` — методу
  `listReviews` на `ReviewRepository` немає. Найближче — `reviewsForPull(prId)`
  (`server/src/modules/reviews/repository.ts:65`), і вона повертає
  `{ review, findings }[]`, а не `ReviewRecord[]` — тобто `reviews.find((r) => r.kind === 'review')`
  у `service.ts:133` не спрацює навіть після перейменування: `kind` лежить на `r.review`.
- `service.ts:82`: `reviewRepo.getReview(workspaceId, row.reviewId)` — реальна сигнатура
  `getReview(reviewId: string)` (`server/src/modules/reviews/repository.ts:68`), один аргумент.
  Тут передано два, причому `workspaceId` став би `reviewId`.

Чому це проблема: `pnpm typecheck` (лінія `backend` у `scripts/verify.mjs`) впаде. Окремо варто
звернути увагу: `getReview` не скоупиться workspace-ом взагалі — якщо publisher потребує
workspace-скоупленого читання ревʼю, це зміна, яку треба зробити **в репозиторії reviews на
контейнері** (`container.reviewRepo`), а не обходити інлайн-запитом через `container.db`.
Напрям тут обрано правильний (див. «Що зроблено правильно»), помилка лише в контракті.

### 6. `AppError.status` не існує — ретраї 5xx не працюють

**Файл:** `service.ts:137`

```ts
if (err instanceof AppError) return err.status >= 500 || err.code === 'slack_rate_limited';
```

У `server/src/platform/errors.ts:8-18` поле називається `statusCode` (його ж читає обробник помилок
в `server/src/app.ts:167`). `status` на `AppError` немає — це помилка типчеку, а якби її не було
(наприклад, через `any`), поведінка була б гіршою за падіння: `undefined >= 500` — це `false`,
тобто кожна серверна помилка Slack тихо позначалася б `failed` замість `retryable`, і ретрай ніколи
б не спрацював. Треба `err.statusCode >= 500`.

### 7. Інтеграційний тест імпортує неіснуючі хелпери

**Файл:** `publisher.it.test.ts:2`

```ts
import { makeDb, resetDb, seedWorkspace, seedPull, seedReview } from '../../../test/helpers/db.js';
```

У `server/test/helpers/` є лише `pg.ts` і `runs.ts`. Модуля `db.ts` немає, і жодного з пʼяти
імпортованих символів не існує (`pg.ts` експортує `dockerAvailable`, `startPg`, `PgFixture`).
Файл не скомпілюється й не запуститься.

Як правильно — шаблон, за яким живуть усі 12 наявних `*.it.test.ts` (див.
`server/test/blast.it.test.ts:11-27`): `startPg()` з testcontainers, а перед `describe` — гейт по
Docker:

```ts
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
```

Без цього гейта (пункт 11) лінія `integration` червонітиме там, де Docker недоступний, замість
чисто пропуститися.

---

## Суттєві

### 8. `attempts` не інкрементується — ретраї нескінченні

**Файл:** `repository.ts:60` і `repository.ts:102-104`

```ts
.set({ status, error, attempts: sqlIncrement() })
// …
function sqlIncrement() { return undefined as unknown as number; }
```

Це брехливе приведення: функція повертає `undefined`, Drizzle викидає `undefined`-поля з `SET`,
тож `attempts` назавжди лишається початковим значенням. Разом із пунктом 9 це означає, що
публікація, яка стабільно падає, повертатиметься в кожен виклик `POST /publications/retry` вічно —
включно з походом у Slack на кожну ітерацію.

Друга частина тієї ж проблеми: `PUBLISH_RETRY_LIMIT` використано як SQL `LIMIT`
(`repository.ts:78`, `:85` через `listRetryable(workspaceId, PUBLISH_RETRY_LIMIT)` у
`service.ts:78`) — тобто як «скільки рядків взяти за раз», а не як «скільки разів пробувати».
Ліміту спроб у коді немає взагалі, попри назву константи.

Як правильно:

```ts
import { sql } from 'drizzle-orm';
.set({ status, error, attempts: sql`${t.publications.attempts} + 1` })
```

і у `listRetryable` додати умову `lt(t.publications.attempts, PUBLISH_RETRY_LIMIT)`, а розмір
пачки винести окремою константою.

### 9. `retryFailed` ігнорує `row.target` — markdown-публікації йдуть у Slack

**Файл:** `service.ts:90`

```ts
const result = await this.deliverToSlack(review, pull.title, row.channel ?? undefined);
```

`publish` розгалужується за `target` (`service.ts:64-67`), а `retryFailed` — ні: будь-який
`retryable`-рядок вирушає у Slack, навіть якщо його `target` — `markdown`. Для workspace без
Slack-токена це ще й перетворить тихий ретрай на 409 «No Slack token configured».

Як правильно: винести розгалуження в один приватний метод (`deliver(row.target, …)`) і викликати
його з обох місць — зараз логіка доставки продубльована й уже розʼїхалася.

### 10. `listRecent` не скоупиться по `workspaceId`

**Файл:** `repository.ts:90-99`

```ts
.where(inArray(t.publications.prId, prIds))
```

Кожен інший запит у файлі має `eq(t.publications.workspaceId, workspaceId)` — цей ні. Правило
репозиторію: **кожен запит скоупиться workspace-ом**; ідентифікатори з іншого workspace, що
потрапили у `prIds`, повернуть чужі рядки. Додатково: метод ніде в модулі не викликається — або
приберіть його, або додайте `workspaceId` першим параметром (і врахуйте, що `no-orphans` у
`.dependency-cruiser.cjs` дасть попередження на мертвий код).

### 11. Інтеграційний тест не за конвенцією розташування й без Docker-гейта

**Файл:** `publisher.it.test.ts` (розташування) і `publisher.it.test.ts:15-32`

- Ім'я `*.it.test.ts` — правильне, лінії справді розходяться по цьому глобу
  (`scripts/verify.mjs:117` виключає `**/*.it.test.ts` з unit; `:131` і
  `.github/workflows/server-integration.yml:65` фільтрують `.it.test`).
- Але всі 12 наявних DB-тестів лежать у `server/test/`, а не поруч із модулем. Файл у
  `src/modules/publisher/` формально підхопиться (`vitest.config.ts:15` включає
  `src/**/*.test.ts`), але розійдеться з рештою пакета.
- Немає гейта `dockerAvailable()`; `makeDb()` викликається синхронно в тілі `describe`, тож без
  Docker впаде весь файл, а не пропуститься.

### 12. Маршрути без `response`-схеми і без rate-limit на POST, що ходить назовні

**Файл:** `routes.ts:19-38`

- Жоден із трьох маршрутів не оголошує `schema.response`. Конвенція описана прямо в
  `server/src/modules/_shared/schemas.ts:14-23`: одна Zod-схема валідує запит **і** серіалізує
  відповідь, інакше хендлер, що почав повертати сирий Drizzle-рядок (з `workspaceId`), тихо
  розширює публічний API. Приклад для копіювання — `server/src/modules/brief/routes.ts:43,53`.
  Тут `PublishRecord` (і `z.array(PublishRecord)` для історії) уже існує в контрактах — вистачить
  `response: { 200: … }`.
- `POST /pulls/:id/publications` робить зовнішній HTTP-виклик у Slack, а
  `POST /publications/retry` — цілу пачку таких викликів; обидва без `config.rateLimit`. У репо
  всі POST, що витрачають зовнішній ресурс, обмежені (`brief/routes.ts:54`,
  `settings/routes.ts:71`).

### 13. Перевірити те, чого немає у фікстурі: реєстрація модуля і дзеркало контрактів

- **`server/src/modules/index.ts`** — publisher має бути доданий одним імпортом і одним записом
  у `modules`. Без цього маршрути просто не існують, а `no-orphans` дасть попередження.
- **`client/src/vendor/shared`** — `PublishRecord`, `PublishRequest`, `PublishTarget`,
  `PublishStatus` перетинають дріт (GET історії повертає їх у UI), отже мусять бути віддзеркалені
  з канонічної серверної копії `server/src/vendor/shared/contracts` у клієнтську. Порт
  `SlackClient` — навпаки, серверний і дзеркалення не потребує.

---

## Дрібне

### 14. Власний код помилки замість наявного класу таксономії

**Файл:** `service.ts:110-118`

`AppError(SLACK_NOT_CONFIGURED_CODE, 'No Slack token configured — add one in Settings to publish
to Slack.', 409)` дослівно повторює `NoProviderKeyError` із `server/src/platform/errors.ts:52-62`
(той самий 409, та сама фраза «add one in Settings to …», той самий сенс «ключа ще немає — це стан
UI, а не збій сервера»). Клас існує саме для того, щоб код, статус і форма повідомлення не
розʼїжджалися по модулях; клієнт відрізняє цей стан за `NO_PROVIDER_KEY_CODE`. Або скористайтеся
ним, або, якщо Slack справді інший випадок, додайте окремий клас у `platform/errors.ts`, а не
разовий рядок у сервісі.

### 15. Non-null assertions ховають реальний шлях помилки

**Файл:** `repository.ts:29` (`toDto(inserted!)`) і `repository.ts:49` (`toDto(row!)`)

`markDelivered` фільтрує по `workspaceId` + `id`: якщо рядок належить іншому workspace, `.returning()`
поверне порожній масив, і `row!` дасть `TypeError` всередині `toDto` — тобто 500 замість чесного
404. Поверніть `undefined` і киньте `NotFoundError` у сервісі.

### 16. Валідація `target` продубльована в сервісі

**Файл:** `service.ts:45-47`

`target` уже типізований як `PublishTarget` і приходить із розібраного `PublishRequest`
(`routes.ts:26`). Якщо в схемі це `z.enum([...])` — перевірка `SUPPORTED_TARGETS.includes(target)`
недосяжна, і 422 на неї ніколи не спрацює; якщо це `z.string()` — валідація стоїть не на краю.
Розбирайте на межі, всередині кілець дані вже довірені.

### 17. Назва тесту не збігається з тим, що він перевіряє

**Файл:** `publisher.it.test.ts:34-42`

Тест «records the delivery before attempting it» перевіряє лише кінцевий стан (`delivered`) — саме
властивість «рядок зʼявився **до** спроби», яку ретельно описує докблок сервіса
(`service.ts:26-30`), не перевіряється. Перевіряти її треба з `postMessage`, що падає, і
подальшим читанням рядка (частково це робить наступний тест) — або з асерцією всередині мока
`postMessage`, що на момент виклику в БД уже є `pending`-рядок.

---

## Що зроблено правильно (не міняти при виправленнях)

- Крос-модульні дані беруться з `container.reviewRepo` (`service.ts:49,82,132`), а не інлайн-запитом
  по `t.reviews` через `container.db` і не імпортом `../reviews/repository.js`. Це саме той
  напрям, який вимагає скіл, — зламані лише сигнатури (пункт 5).
- `repository.ts` — єдине місце, що торкається `publications`; сервіс не імпортує `db/schema`
  напряму, маршрути не торкаються ні того, ні іншого (`routes-through-service` буде зеленим).
- Сервіс не імпортує нічого з `fastify` і приймає розвʼязані значення (`workspaceId`, `prId`,
  `target`) — `service-stays-http-agnostic` дотримано, `FastifyRequest` не протік навіть як тип.
- Рендеринг винесений у чистий `helpers.ts`, літерали — у `constants.ts`; сервіс лишає собі
  рішення. Структура модуля (routes/service/repository/helpers/constants) відповідає чеклісту.
- `getContext(app.container, req)` на кожному маршруті — скоупінг workspace не забутий на краю.
