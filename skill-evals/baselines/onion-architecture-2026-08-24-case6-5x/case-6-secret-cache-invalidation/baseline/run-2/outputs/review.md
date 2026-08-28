# Ревʼю гілки `publisher` (модуль `server/src/modules/publisher`)

Огляд за правилами onion-архітектури DevDigest. Рев'ювались файли з
`.claude/skills/onion-architecture/evals/fixtures/publisher-module/`:
`routes.ts`, `service.ts`, `repository.ts`, `publisher.it.test.ts`,
`container.excerpt.ts`, `mocks.excerpt.ts`. Нічого не редаговано.

**Вердикт: не мерджити.** Шар-розкладка правильна (маршрут делегує, сервіс бере
resolved-значення, репозиторій — єдине місце для `publications`, до чужого
модуля — через `container.reviewRepo`), тому `depcruise` цю гілку, найімовірніше,
пропустить без жодної помилки. Але зламано рівно те, чого конфіг не бачить:
шов підміни адаптера, інвалідація кешу секретів і кілька речей, які просто не
скомпілюються або не спрацюють у рантаймі.

---

## Блокери

### 1. Порт `SlackClient` доданий у контейнер без `ContainerOverrides` — шов підміни зламано

`container.excerpt.ts:27-39` (інтерфейс `ContainerOverrides`), `container.excerpt.ts:73-79`
(гетер `slack()`).

`ContainerOverrides` перелічує `secrets, auth, github, git, codeIndex, embedder,
llm, repoIntel, projectContext, blast` — входу `slack?: SlackClient` немає. Відповідно
й гетер не починається з перевірки override, на відміну від сусіда `github()`
(`container.excerpt.ts:59-66`), який першим рядком робить
`if (this.overrides.github) return this.overrides.github;`.

Чому це проблема: `ContainerOverrides` — це і є єдиний санкціонований шов для
тестів. Порт без входу в overrides неможливо підмінити нічим, окрім підробки
`SecretsProvider` плюс мокання шляху модуля — що тест і робить (див. пункт 4).
Правило скіла: новий порт = чотири кроки (інтерфейс у `vendor/shared`, адаптер у
`adapters/`, лінивий гетер **+ вхід у `ContainerOverrides`**, мок у
`adapters/mocks.ts`); пропущений будь-який — шов зламано.

Як правильно — дослівно за формою `github()`:

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

### 2. Немає `MockSlackClient` у `adapters/mocks.ts`

`mocks.excerpt.ts:6-17` — весь список експортів. Є `MockLLMProvider`, `MockEmbedder`,
`MockGitHubClient`, `MockGitClient`, `MockCodeIndex`, `MockBlast`, `MockAuthProvider`,
`MockSecretsProvider`. Для `SlackClient` двійника немає, і гілка його не додала.

Це друга половина того самого зламаного шва: навіть якщо додати `slack?` в
overrides, підставляти буде нічого, і кожен тест виготовлятиме свій ad-hoc об'єкт.
Потрібен клас поруч з рештою:

```ts
// server/src/adapters/mocks.ts
export class MockSlackClient implements SlackClient {
  readonly posted: Array<{ channel?: string; blocks: unknown[]; fallbackText: string }> = [];
  constructor(private ts = '1712345678.000100') {}
  async postMessage(msg: { channel?: string; blocks: unknown[]; fallbackText: string }) {
    this.posted.push(msg);
    return { ts: this.ts };
  }
}
```

### 3. `invalidateSecretCaches()` не скидає `_slack` — протухлий токен живе до перезапуску

`container.excerpt.ts:49` (`private _slack?: SlackClient;`), `container.excerpt.ts:73-79`
(гетер кешує в `_slack`), `container.excerpt.ts:102-110` (`invalidateSecretCaches()`
чистить `llmCache`, `_github`, `_embedder` — і не чистить `_slack`).

Це не стилістика, а користувацький баг з рантайм-наслідком. Метод викликається з
`server/src/modules/settings/routes.ts:84` одразу після
`await container.secrets.set(SECRET_KEY_BY_PROVIDER[provider], key)` — саме для
того, щоб щойно збережений ключ підхопився без рестарту. Кожен інший лінивий
клієнт, побудований з секрету, у цьому методі перелічений; `_slack` — ні.

Сценарій: користувач зберігає новий `SLACK_BOT_TOKEN` у Settings (старий відкликано
або протух) → `invalidateSecretCaches()` відпрацьовує → `_slack` лишається зі
старим токеном → усі наступні `POST /pulls/:id/publications` падають з
Slack-401 → `isRetryable` (див. пункт 6) навіть не позначить їх retryable → і
жодне повторне збереження ключа в UI ситуацію не виправить. Лікується лише
рестартом процесу, причому симптом виглядає як «Slack зламався», а не як
«кеш протух».

Дзеркальна ситуація на старті: перший `slack()` до того, як користувач взагалі
налаштував токен, кине `ConfigError`, нічого не закешує — це ок; але після
успішного побудування клієнта жодна зміна секрету вже не діє.

Виправлення — один рядок:

```ts
invalidateSecretCaches(): void {
  this.llmCache.clear();
  this._github = undefined;
  this._embedder = undefined;
  this._slack = undefined;      // ← бракує
}
```

Окремо варто додати правило в голову на майбутнє: кожне нове приватне поле
`_x`, яке будується з `this.secrets.get(...)`, зобов'язане з'явитись у
`invalidateSecretCaches()` тим самим комітом. Це найдешевше місце, де така
помилка ловиться.

### 4. Інтеграційний тест мокає шлях модуля замість підміни порту

`publisher.it.test.ts:7-13`:

```ts
const postMessage = vi.fn(async () => ({ ts: '1712345678.000100' }));
vi.mock('../../adapters/slack/slack.client.js', () => ({
  SlackWebhookClient: class { postMessage = postMessage; },
}));
```

`vi.mock` шляху адаптера — прямо заборонений спосіб: він прив'язує тест до
графа імпортів, а не до порту, і ламається від будь-якого перейменування файлу
(а файл тут ще й новий, тобто перейменування дуже ймовірне). Архітектура вже
дає для цього шов — `ContainerOverrides`. У всій директорії `server/test/`
`vi.mock` зустрічається рівно в одному юніт-тесті і в жодному `*.it.test.ts`;
решта підставляє `MockGitClient`/`MockGitHubClient`/`MockLLMProvider` через overrides.

Симптоматично, що тест тут ще й підробляє `SecretsProvider` кастом
(`publisher.it.test.ts:26-30`):

```ts
container = new Container(loadConfig(), db, {
  secrets: { get: async (key: string) => (key === 'SLACK_BOT_TOKEN' ? 'xoxb-test' : undefined) } as never,
});
```

`as never` тут — це не типова дрібниця, а сигнал: об'єкт не задовольняє порт
(`SecretsProvider` має ще й `set`), і його прогнали повз перевірку типів. У
`adapters/mocks.ts` для цього вже є `MockSecretsProvider`.

Як має виглядати після виправлення пунктів 1-2:

```ts
const slack = new MockSlackClient();
container = new Container(loadConfig(), db, {
  secrets: new MockSecretsProvider({ SLACK_BOT_TOKEN: 'xoxb-test' }),
  slack,
});
// перевірки — по slack.posted, без vi.fn і без vi.mock
```

Додатковий побічний ефект: у нинішньому вигляді тест не покриває пункт 3 і
покрити не може — він ніколи не проходить через реальний `SlackWebhookClient`,
тому протухлий кеш для нього невидимий. Тест на інвалідацію має бути окремий і
на рівні контейнера: побудувати `slack()`, змінити секрет, викликати
`invalidateSecretCaches()`, переконатись, що наступний `slack()` бере новий токен.

### 5. Тест лежить не там, гейта на Docker немає, хелпер не існує

`publisher.it.test.ts:1-5`.

Три окремі проблеми в шапці файлу:

- **Розташування.** Файл лежить у `server/src/modules/publisher/publisher.it.test.ts`
  (це видно з відносних шляхів `../../platform/container.js` і `../../../test/helpers/db.js`).
  Усі 14 наявних інтеграційних тестів лежать у `server/test/*.it.test.ts`.
  Правильне місце: `server/test/publisher.it.test.ts`.
- **Хелпер не існує.** Імпорт `../../../test/helpers/db.js` з
  `makeDb, resetDb, seedWorkspace, seedPull, seedReview` — у репозиторії в
  `server/test/helpers/` є лише `pg.ts` (експортує `PgFixture`, `dockerAvailable`,
  `startPg`) і `runs.ts`. Ані `db.ts`, ані жодної з цих п'яти функцій немає.
  Гілка або мовчки додає новий хелпер-модуль (тоді він має бути в наборі на ревʼю),
  або тест просто не компілюється.
- **Немає Docker-гейта.** Конвенція наявних `*.it.test.ts`:
  `const hasDocker = await dockerAvailable(); const d = hasDocker ? describe : describe.skip;`
  Тут — голий `describe`, тож на машині чи в CI-лейні без Docker цей файл впаде
  замість того, щоб скіпнутись.

Назва `*.it.test.ts` — єдине правильне, що тут є: юніт- і інтеграційний лейни
розділяються рівно по цьому глобу.

### 6. `err.status` на `AppError` не існує — ретраї не працюють взагалі

`service.ts:136-139`:

```ts
private isRetryable(err: unknown): boolean {
  if (err instanceof AppError) return err.status >= 500 || err.code === 'slack_rate_limited';
  return err instanceof Error && /ETIMEDOUT|ECONNRESET|fetch failed/.test(err.message);
}
```

`AppError` (`server/src/platform/errors.ts:8-18`) має поле **`statusCode`**, не
`status`. Тобто `err.status` — це `undefined`, `undefined >= 500` → `false`, і вся
ліва частина умови завжди хибна. Наслідок: будь-яка помилка з боку Slack, яка
приїхала як `AppError`/`ExternalServiceError` (502 і т.д.), класифікується як
`failed`, а не `retryable`, і `/publications/retry` її ніколи не підбере.
Ретраїтимуться тільки сирі мережеві `Error` за регуляркою.

Ба більше — це самописна копія того, що вже є в `server/src/platform/resilience.ts`:
`httpStatusOf(err)` навмисне збирає статус з усіх трьох форм
(`.status` в Octokit, `.statusCode` в Fastify/AppError, `.response.status` у
fetch-обгортках), а `defaultIsRetryable` уже вважає 429 і 5xx ретраябельними
плюс `ECONNRESET/ETIMEDOUT/ENOTFOUND`. Правильно:

```ts
import { httpStatusOf } from '../../platform/resilience.js';
// …
const status = httpStatusOf(err);
```

Тут добре видно, чому дублювання платформного хелпера — не «стилістика»:
копія не просто повторює логіку, вона повторює її **неправильно**, і мовчки.

### 7. Сервіс кличе неіснуючі методи `container.reviewRepo`

`service.ts:82` і `service.ts:131-134`:

```ts
const review = await this.container.reviewRepo.getReview(workspaceId, row.reviewId);
// …
const reviews = await this.container.reviewRepo.listReviews(workspaceId, prId);
```

Реальний `ReviewRepository` (`server/src/modules/reviews/repository.ts`) має
`getReview(reviewId)` — **один** аргумент — і не має `listReviews` взагалі
(найближче — `reviewsForPull(prId)`, яке повертає `{ review, findings }[]`).
`getPull(workspaceId, prId)` (`service.ts:49`) — єдиний із трьох викликів, що
збігається з реальною сигнатурою.

Тобто одне з двох: або гілка не компілюється, або вона мовчки правила
`modules/reviews/repository.ts`, а ця правка не показана в наборі на ревʼю
(при тому що PR описано як «модуль + правка платформи»). Друге — гірше:
розширення чужого репозиторію під потреби нового модуля треба бачити й
узгоджувати, бо `reviewRepo` спільний.

Окремо зверніть увагу на скоупінг: передача `workspaceId` першим аргументом у
`getReview` створює **хибне враження** ізоляції по воркспейсу. Реальний
`getReview(reviewId)` шукає по одному лише id. Якщо додаєте метод — додавайте
його справді скоупленим (`and(eq(reviewId), eq(workspaceId))`), інакше сервіс
опублікує ревʼю чужого воркспейсу, отримавши валідний `row.reviewId` зі своєї
таблиці.

### 8. `attempts` ніколи не інкрементується, а «ліміт ретраїв» — не ліміт ретраїв

`repository.ts:58-62` і `repository.ts:102-104`:

```ts
.set({ status, error, attempts: sqlIncrement() })
// …
function sqlIncrement() {
  return undefined as unknown as number;
}
```

`sqlIncrement()` — заглушка, що повертає `undefined`, замаскований під `number`
подвійним кастом. Drizzle отримує `attempts: undefined`, тобто колонку просто не
оновлює. Лічильник спроб стоїть на нулі назавжди, а каст глушить єдиний механізм,
який мав би це зловити на етапі компіляції.

Гірше те, що навіть робочий лічильник ні на що б не вплинув: `PUBLISH_RETRY_LIMIT`
передається (`service.ts:78`) у `listRetryable(workspaceId, limit)` і там
(`repository.ts:74-88`) використовується як SQL `.limit(limit)` — тобто це
«скільки рядків узяти за раз», а не «скільки разів пробувати». Фільтра по
`attempts` немає. Разом: рядок, який стабільно падає (наприклад, через протухлий
токен з пункту 3), ретраїтиметься при кожному виклику `/publications/retry`
вічно, довбаючи Slack.

Як має бути:

```ts
import { sql, lt } from 'drizzle-orm';
// markFailed:
.set({ status, error, attempts: sql`${t.publications.attempts} + 1` })
// listRetryable — ліміт спроб як умова, а не як .limit():
.where(and(
  eq(t.publications.workspaceId, workspaceId),
  eq(t.publications.status, 'retryable'),
  lt(t.publications.attempts, PUBLISH_RETRY_LIMIT),
))
```

І окремою константою — скільки рядків забирати за прохід.

---

## Важливе

### 9. `listRecent(prIds)` не скоуплений по `workspaceId`

`repository.ts:90-99`:

```ts
async listRecent(prIds: string[]): Promise<PublishRecord[]> {
  const rows = await this.db.select().from(t.publications)
    .where(inArray(t.publications.prId, prIds))
    .orderBy(desc(t.publications.createdAt)).limit(200);
  return rows.map(toDto);
}
```

Кожен інший метод репозиторію фільтрує по `workspaceId`; цей — ні. Правило
модульного чекліста: репозиторій — єдине місце, що торкається своїх таблиць, і
**кожен запит скоупиться `workspaceId`**. Метод, який приймає лише масив
`prId`, — це готовий міжтенантний витік, щойно якийсь виклик передасть у нього
id з іншого джерела.

До того ж його ніхто не викликає: у `service.ts` його немає, отже це мертвий код,
що чекає на першого користувача, який не подивиться на реалізацію. Або додайте
`workspaceId` першим параметром, або видаліть до появи реальної потреби.

### 10. `retryFailed` ігнорує `row.target` і шле все у Slack

`service.ts:81-97`, зокрема рядок 90:

```ts
const result = await this.deliverToSlack(review, pull.title, row.channel ?? undefined);
```

`publish()` уважно розгалужується по `target` (`service.ts:64-67`), а `retryFailed()`
— ні. Рядок з `target = 'markdown'` (наприклад, той, де впав `renderMarkdown`)
під час ретраю поїде в Slack-канал. Розгалуження має бути спільним приватним
методом `deliver(row.target, …)`, який використовують обидва шляхи.

### 11. Жоден маршрут не оголошує `schema.response`

`routes.ts:19-38` — усі три маршрути мають `params`/`body`, і жоден не має
`response`.

`server/src/modules/_shared/schemas.ts` пояснює це прямо в коментарі: response-схема
не декорація — серіалізатор валідує те, що виходить із процесу, тож хендлер, який
почав повертати сиру Drizzle-строку (з `workspaceId`, внутрішніми таймстемпами),
падає голосно, а не тихо розширює публічний API. Тут `history` і `publish`
повертають те, що віддав репозиторій, без жодної перевірки на виході.

Окремо `POST /publications/retry` (`routes.ts:34-38`) не має `schema` взагалі —
ні тіла, ні відповіді, хоча повертає `{ sent }`.

Правило скіла: одна Zod-схема веде і валідацію запиту, **і** серіалізацію
відповіді.

### 12. Свій код помилки замість наявної таксономії

`service.ts:106-119` + константа `SLACK_NOT_CONFIGURED_CODE` (`constants.ts`):

```ts
throw new AppError(SLACK_NOT_CONFIGURED_CODE,
  'No Slack token configured — add one in Settings to publish to Slack.', 409);
```

У `platform/errors.ts:43-60` для рівно цього кейсу вже є `NoProviderKeyError`:
409, стабільний код `no_provider_key`, і повідомлення тієї самої форми
(«No API key configured for provider "x" — add one in Settings to <action>.»).
Клас там єдиний саме для того, щоб код, статус і форма повідомлення не
розповзалися по модулях, а клієнт вимикає свої дії по одному відомому коду.
Новий код доведеться окремо навчити клієнт розпізнавати — інакше UI покаже
generic-помилку замість підказки «налаштуй токен».

Використовуйте `new NoProviderKeyError('slack', 'publish to Slack')` і викиньте
`SLACK_NOT_CONFIGURED_CODE`.

Дрібніше в тому ж місці: `catch (err) { if (err instanceof ConfigError) … }`
навколо `this.container.slack()` перехопить **будь-який** `ConfigError`, зокрема
той, що виник з іншої причини глибше, і перепише його на «немає токена».
Звужуйте перевірку, або хай контейнер кидає одразу правильний тип.

### 13. Валідація `target` дублюється всередині сервісу

`service.ts:45-47` перевіряє `SUPPORTED_TARGETS.includes(target)` і кидає 422 —
при тому, що `routes.ts:26` уже прогнав тіло через `PublishRequest`.

Парсимо на межі; всередині кілець дані вже довірені. Тут одне з двох: або
`PublishRequest.target` — не `z.enum` і схема надто вільна (тоді лікувати треба
схему, а не додавати другу перевірку на кільце глибше), або гілка дійсно
валідує enum двічі і це мертва гілка коду з недосяжним 422.

### 14. Не-null асерти на результаті `UPDATE` дадуть 500 замість 404

`repository.ts:29` (`toDto(inserted!)`) і `repository.ts:49` (`toDto(row!)`).

`markDelivered` фільтрує по `workspaceId` + `id`. Якщо рядка немає (чужий
воркспейс, гонка з видаленням), `.returning()` віддасть порожній масив, `row` буде
`undefined`, і `toDto` впаде на `row.createdAt.toISOString()` — TypeError, 500,
без корисного повідомлення. Має бути явна перевірка й `NotFoundError`.

---

## Дрібне

- `repository.ts:78-82`: `inArray(t.publications.status, ['retryable'])` з одним
  елементом — це `eq(t.publications.status, 'retryable')`.
- `service.ts:131-134`: `latestReview` бере `reviews.find(r => r.kind === 'review')`,
  тобто «останнє» тримається на порядку, який повертає **чужий** репозиторій і
  який жодним контрактом не зафіксовано. Беріть максимум по `createdAt` явно,
  або нехай метод у `reviewRepo` називається так, як сортує.
- `service.ts:128`: `{ externalId: posted.ts }` — Slack-специфічне поле `ts`
  протікає в узагальнений `DeliveryResult`. Хай порт `SlackClient.postMessage`
  повертає вже нормалізоване `{ externalId }`, і сервіс не знатиме, що всередині
  Slack це таймстемп.
- `container.excerpt.ts:24`: ім'я файлу адаптера `adapters/slack/slack.client.js`
  вибивається з конвенції сусідів — `github/octokit.ts`, `llm/openai.ts`,
  `secrets/local.ts`, `auth/local.ts`. Тут напрошується `adapters/slack/webhook.ts`.
- `routes.ts:34`: `/publications/retry` не має `config.rateLimit`, хоча це
  маршрут із зовнішнім side-effect'ом, який у циклі стукає в Slack. Сусідні
  дорогі маршрути (`POST /pulls/:id/review`, `/settings/test-connection`) свої
  ліміти мають.
- `service.ts:64-69`: для `target === 'markdown'` рядок отримує статус
  `delivered`, хоча нічого нікуди не доставлялось. Для таргета, який лише
  рендерить блоб, статус `rendered`/`ready` чесніший — інакше «історія доставок»
  змішує два різні факти.

---

## Не було в наборі — перевірити перед мерджем

Ці файли гілка мала зачепити, але їх немає серед наданих фікстур, тож вони не
рев'ювались:

1. **`server/src/modules/index.ts`** — запис `publisher` у реєстрі модулів.
   Без нього маршрути просто не зареєстровані, а `depcruise` дасть `no-orphans`
   (warn). Реєстрація статична навмисно — один імпорт + один рядок.
2. **`server/src/db/schema.ts`** — таблиця `publications` (у поточному `schema.ts`
   її немає) і **нова** міграція в `server/src/db/migrations/`. Застосовані `.sql`
   не редагувати. Міграції не застосовуються на старті: `cd server && pnpm db:migrate`.
3. **`server/src/vendor/shared/adapters.ts`** — інтерфейс `SlackClient`
   (канонічна серверна копія). Це порт, серверний — у клієнтську копію його
   дзеркалити **не** треба.
4. **Контракти, що перетинають дріт** — `PublishRequest`, `PublishRecord`,
   `PublishTarget`, `PublishStatus`: у серверному `vendor/shared` і **дзеркалом**
   у `client/src/vendor/shared`. Правити лише серверну копію й забути про
   клієнтську — типова причина дрейфу.
5. **`server/src/platform/config.ts`** — `slackDefaultChannel`, який читає
   `container.excerpt.ts:77`.
6. **`helpers.ts` / `constants.ts` модуля** — `renderSlackBlocks`, `renderMarkdown`,
   `truncateForSlack`, `MAX_BLOCKS_PER_MESSAGE`, `PUBLISH_RETRY_LIMIT`,
   `SLACK_NOT_CONFIGURED_CODE`, `SUPPORTED_TARGETS`. Не бачив — не рев'ював.
   Нагадування: `constants.ts` і `types.ts` — публічна поверхня модуля, решта
   приватна.
7. **`server/src/modules/settings/routes.ts`** — `SECRET_KEY_BY_PROVIDER` і
   `/settings/test-connection` нічого не знають про Slack. Якщо токен вводиться в
   Settings, то і кнопка «перевірити з'єднання», і мапа провайдерів мають
   покривати `slack` — інакше пункт 3 користувач узагалі не має способу
   продіагностувати з UI.
8. **Прогнати гейти:** `node scripts/verify.mjs --slice backend` і
   `--slice integration`, плюс
   `cd server && pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs`.

---

## Що зроблено правильно

Щоб не загубилося серед списку проблем:

- `routes.ts` — чистий транспорт: `getContext`, Zod на `params`/`body`, делегування
  в сервіс, жодного Drizzle на межі. `routes-through-service` не порушено.
- `PublisherService` бере `Container` у конструкторі й будує власний репозиторій з
  `container.db` (`service.ts:35-37`) — точно за формою `modules/repos/service.ts`.
- Сервіс приймає `workspaceId, prId, target, channel` — resolved-значення, а не
  `FastifyRequest`. Модуль викличеться з джоба чи CLI без змін.
- До чужих даних — через контейнер (`container.reviewRepo`), а не імпортом
  `modules/reviews/repository.js`. `no-cross-module-internals` не порушено
  (питання до сигнатур методів — окремо, пункт 7).
- Slack-клієнт лінивий, і коментар у `container.excerpt.ts:68-72` правильно
  пояснює чому: відсутній токен — це вимкнена фіча, а не падіння на старті.
- Рішення записувати `pending` **до** спроби доставки, а не після, і мотивація в
  докблоці `service.ts:27-30` — це саме той клас коментаря, який вартий місця в
  коді.
