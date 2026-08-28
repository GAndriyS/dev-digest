# Ревʼю гілки `publisher` — перед мерджем

Перевірено за скілом `onion-architecture` (v1.0.0) і звірено з реальним кодом у
`server/`. Рядки нижче — це рядки у файлах фікстури
`.claude/skills/onion-architecture/evals/fixtures/publisher-module/`; у дужках
вказано, куди файл лягає на гілці.

**Вердикт: мерджити не можна.** Є 3 блокери архітектурного шва (порт Slack не
має точки підміни), 4 блокери «воно просто не збереться / не працює» (немає
таблиці, немає адаптера, невірне поле `AppError`, невірний API `reviewRepo`) і
низка порушень тенансі та конвенцій.

---

## A. Блокери — шов «порт → адаптер → контейнер → мок» розірваний

### A1. `container.slack()` не перевіряє `overrides` — підміна в тестах неможлива

**Файл:** `container.excerpt.ts:73-79` (`server/src/platform/container.ts`)

```ts
async slack(): Promise<SlackClient> {
  if (this._slack) return this._slack;          // ← немає overrides.slack
  const token = await this.secrets.get('SLACK_BOT_TOKEN');
  ...
}
```

**Чому проблема.** Кожен інший геттер у цьому ж файлі починається з перевірки
overrides — `github()` (рядок 60), `llm()` (рядок 82), `embedder()` (рядок 92).
Скіл формулює це прямо: «Lazy getter with `??=` caching; `overrides.<x>` checked
**first** so tests win». Тут overrides не перевіряються взагалі, і в
`ContainerOverrides` (рядки 27-39) немає поля `slack`. Наслідок видно
безпосередньо в тесті цієї ж гілки — він змушений мокати шлях модуля
(див. A3). Це не стиль: підміна через `ContainerOverrides` — єдина причина,
чому `adapters/mocks.ts` взагалі працює.

**Як правильно.** Дві правки в `container.ts`, за зразком `github()`:

```ts
export interface ContainerOverrides {
  ...
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

---

### A2. `invalidateSecretCaches()` не скидає `_slack` — ротація токена не діє до рестарту

**Файл:** `container.excerpt.ts:102-110` (`server/src/platform/container.ts`)

```ts
invalidateSecretCaches(): void {
  this.llmCache.clear();
  this._github = undefined;
  this._embedder = undefined;
  // _slack не скинуто
}
```

**Чому проблема.** Це не косметика — метод має єдиного реального викликача:
`server/src/modules/settings/routes.ts:84`, `POST /settings/test-connection`,
який викликає його одразу після `container.secrets.set(...)`. Власний докблок
методу каже: «Drop cached provider clients so the next resolve picks up changed
secrets. Call after persisting a new API key/PAT». `slack()` кешує клієнт разом
із **токеном, вшитим у конструктор** (`new SlackWebhookClient(token, ...)`), —
тобто після кешування токен більше ніколи не перечитується з
`SecretsProvider`.

Практичні наслідки, кожен із яких — інцидент у продакшені:

1. Користувач ротує скомпрометований `SLACK_BOT_TOKEN` у Settings → бекенд і
   далі шле дайджести старим (відкликаним) токеном; кожна публікація падає, і
   `retryFailed` довічно ретраїть її (див. C2), поки процес не перезапустять.
2. Зворотний випадок: перший виклик `slack()` до налаштування токена кидає
   `ConfigError`, користувач додає токен — тут пронесе, бо невдалий виклик нічого
   не закешував. Але щойно закешувався **будь-який** валідний клієнт, будь-яка
   подальша зміна токена ігнорується.
3. Кеш живе на рівні `Container`, тобто на весь процес і на всі воркспейси
   одночасно.

**Як правильно.** Додати `_slack` до списку скидань — і трактувати цей список як
інваріант «кожне закешоване поле, побудоване з секрету, скидається тут»:

```ts
invalidateSecretCaches(): void {
  this.llmCache.clear();
  this._github = undefined;
  this._embedder = undefined;
  this._slack = undefined;
}
```

Оскільки список уже двічі забували доповнити, варто зробити помилку
неможливою — тримати кеші провайдерів, що залежать від секретів, в одному
`Map`, який очищається цілком, або додати юніт-тест, який після
`invalidateSecretCaches()` перевіряє, що `slack()` повторно читає секрет
(з `MockSecretsProvider`, що віддає різні значення на першому й другому
виклику). Скіл вимагає саме такої семантики: «Anything needing a secret is
`async` … the key is read through `SecretsProvider` **at resolve time**, not at
boot» — зараз токен читається один раз за життя процесу, що цю обіцянку
порушує.

---

### A3. Немає `MockSlackClient` — і тест через це мокає шлях модуля

**Файли:** `mocks.excerpt.ts` (весь; `server/src/adapters/mocks.ts`),
`publisher.it.test.ts:7-13`

**Чому проблема.** Скіл описує додавання порту як чотири кроки, які працюють
лише разом: «New port → interface in `vendor/shared`, adapter in `adapters/`,
lazy getter + `ContainerOverrides` entry in `container.ts`, mock in
`adapters/mocks.ts`. **All four, or the seam is broken**». Гілка зробила
частину кроку 3 і не зробила крок 4 — у списку експортів `mocks.ts` немає
`MockSlackClient` (є `MockLLMProvider`, `MockEmbedder`, `MockGitHubClient`,
`MockGitClient`, `MockCodeIndex`, `MockBlast`, `MockAuthProvider`,
`MockSecretsProvider`).

Тест платить за це напряму:

```ts
vi.mock('../../adapters/slack/slack.client.js', () => ({
  SlackWebhookClient: class { postMessage = postMessage; },
}));
```

Це дослівно антипатерн з `examples.md` §9: «couples the test to the import
graph; breaks when a file moves». Тест прив'язаний до конкретного шляху файлу
адаптера, а не до порту; він мовчки перестане мокати будь-що, якщо адаптер
переїде або контейнер почне будувати іншу реалізацію, — і тоді інтеграційний
тест піде в реальний Slack.

**Як правильно.** Додати мок і переписати тест на підміну порту:

```ts
// server/src/adapters/mocks.ts
export class MockSlackClient implements SlackClient {
  readonly posted: Array<{ channel?: string; blocks: unknown[] }> = [];
  constructor(private ts = '1712345678.000100') {}
  async postMessage(msg: { channel?: string; blocks: unknown[]; fallbackText: string }) {
    this.posted.push(msg);
    return { ts: this.ts };
  }
}

// тест
const slack = new MockSlackClient();
container = new Container(config(), db, { slack });
```

---

### A4. Порт `SlackClient` не заведено у канонічній копії контрактів

**Файл:** `container.excerpt.ts:6-18` (імпортує `SlackClient` з `@devdigest/shared`)

**Чому проблема.** У `server/src/vendor/shared/adapters.ts` інтерфейсу
`SlackClient` немає (перевірено: файл експортує `LLMProvider`, `Embedder`,
`GitHubClient`, `GitClient`, `CodeIndex`, `AuthProvider`, `SecretsProvider` —
і все). Інвентар гілки, як він описаний, `vendor/shared` не чіпає, тож імпорт
у контейнері не резолвиться. Скіл: порт живе саме там, «server copy is
canonical».

**Як правильно.** Додати інтерфейс у `server/src/vendor/shared/adapters.ts`
поруч із рештою портів. Якщо будь-який із типів `PublishRecord`,
`PublishStatus`, `PublishTarget`, `PublishRequest` перетинає дріт (а він
перетинає — `PublishRequest` є Zod-схемою тіла роуту, `PublishRecord`
серіалізується у відповідь), його треба **віддзеркалити** у
`client/src/vendor/shared`. Правило з `AGENTS.md`: «Edit the server copy, then
mirror wire-crossing changes into the client copy — never edit only one».

---

### A5. Адаптера `SlackWebhookClient` немає

**Файл:** `container.excerpt.ts:24`
(`import { SlackWebhookClient } from '../adapters/slack/slack.client.js'`)

**Чому проблема.** Директорії `server/src/adapters/slack/` не існує (є
`astgrep, auth, codeindex, depgraph, embedder, git, github, llm, secrets,
tokenizer`). Так само в `AppConfig` немає поля `slackDefaultChannel`, яке
`slack()` читає на рядку 77. Це або файли, які просто забули додати в PR, або
гілка не збирається взагалі — у будь-якому разі це перевіряється до мерджу
(`node scripts/verify.mjs --slice backend`).

---

## B. Тенансі та шар даних

### B1. `listRecent(prIds)` не скоупиться воркспейсом

**Файл:** `repository.ts:90-99`

```ts
async listRecent(prIds: string[]): Promise<PublishRecord[]> {
  const rows = await this.db.select().from(t.publications)
    .where(inArray(t.publications.prId, prIds))   // ← без workspaceId
```

**Чому проблема.** Порушено правило репозиторію зі скіла — «every query scoped
by `workspaceId`» — і тенансі-правило з шапки `server/src/db/schema.ts`: «every
domain table carries `workspace_id` … All queries scope by workspace_id». Усі
чотири сусідні методи в цьому ж файлі скоупляться правильно; цей один — ні.
Метод зараз ніхто не викликає (сервіс його не використовує), тобто це
одночасно й мертвий код, і закладена міжтенантна витік-діра, яка спрацює у
першого ж викликача.

**Як правильно.** Або видалити метод до появи реального споживача, або дати
йому обовʼязковий перший параметр і додати умову:

```ts
async listRecent(workspaceId: string, prIds: string[]): Promise<PublishRecord[]> {
  ... .where(and(eq(t.publications.workspaceId, workspaceId), inArray(t.publications.prId, prIds)))
```

### B2. Таблиці `publications` не існує, міграції немає

**Файл:** `repository.ts:4` (`import * as t from '../../db/schema.js'`) та всі
звернення `t.publications`

**Чому проблема.** У `server/src/db/schema/` (файли `core, repos, pulls,
reviews, skills, agents, knowledge, context, eval, ci, runs, ops, repo-intel`)
таблиці `publications` немає, і барель `schema.ts` її не реекспортує. Тобто
`t.publications` не типізується і репозиторій не збереться. Порожні таблиці для
майбутніх уроків у схемі очікувані — але цієї немає взагалі.

**Як правильно.** Додати `server/src/db/schema/publications.ts`, реекспортувати
з барелю, і згенерувати **нову** міграцію (`pnpm db:generate`). Уже застосовані
`server/src/db/migrations/*.sql` не редагувати — це прямо заборонено в
`AGENTS.md`. Міграції не накочуються на бут: `cd server && pnpm db:migrate`.

### B3. `sqlIncrement()` — заглушка, `attempts` ніколи не зростає

**Файл:** `repository.ts:60` і `repository.ts:102-104`

```ts
.set({ status, error, attempts: sqlIncrement() })
...
function sqlIncrement() {
  return undefined as unknown as number;
}
```

**Чому проблема.** Функція повертає `undefined` під приведенням типу, аби
пройти typecheck. Drizzle викидає `undefined`-поля з `.set()`, тож колонка
`attempts` не оновлюється ніколи. Лічильник спроб, який завжди дорівнює
початковому значенню, — це не просто мертве поле: на ньому мала б триматися
зупинка ретраїв (див. C2).

**Як правильно.** Це рівно те, для чого існує `sql`-темплейт Drizzle:

```ts
import { sql } from 'drizzle-orm';
...
.set({ status, error, attempts: sql`${t.publications.attempts} + 1` })
```

Приведення `as unknown as T` тут маскувало помилку від компілятора — таких
кастів у шарі даних не має бути.

### B4. `markDelivered` впаде на `row!`, якщо рядка немає

**Файл:** `repository.ts:37-49` (також `insertPending`, `repository.ts:29`)

`update ... .returning()` поверне порожній масив, якщо пара
(`workspaceId`, `id`) не збіглася — наприклад, при перегонах або чужому
воркспейсі. `toDto(row!)` у цьому разі кине `TypeError: Cannot read properties
of undefined`, тобто 500 замість осмисленого 404. Краще перевірити явно і
кинути `NotFoundError`.

---

## C. Логіка сервісу

### C1. `isRetryable` читає неіснуюче поле `err.status` — ретраї не працюють

**Файл:** `service.ts:136-139`

```ts
if (err instanceof AppError) return err.status >= 500 || err.code === 'slack_rate_limited';
```

**Чому проблема.** У `server/src/platform/errors.ts:9-19` поле називається
`statusCode`, а не `status`:

```ts
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    ...
```

`err.status` — `undefined`, `undefined >= 500` — `false`. Тобто **жодна**
`AppError` ніколи не буде визнана ретраябельною по статусу; лишається тільки
перевірка коду `slack_rate_limited`. Усі 5xx від Slack потраплять у `failed` і
ніколи не потраплять у `retryFailed`. Тихо, без жодної помилки в логах.

**Як правильно.** `err.statusCode >= 500`. Ще краще — скористатися
`httpStatusOf(err)` з `platform/resilience.ts`, який `errors.ts` уже
використовує саме для цього.

### C2. Ретрай не має верхньої межі спроб і ігнорує `target`

**Файли:** `service.ts:77-100`, `repository.ts:74-88`

Дві окремі проблеми в одному циклі:

- `listRetryable(workspaceId, PUBLISH_RETRY_LIMIT)` передає ліміт у
  `.limit(limit)` — це обмеження **кількості рядків за один прохід**, а не
  кількості спроб на рядок. Умова `attempts < PUBLISH_RETRY_LIMIT` у `where`
  відсутня, а сама колонка й так не інкрементиться (B3). Отже рядок, що падає
  стабільно, ретраїться вічно. Разом з A2 (протухлий токен) це дає нескінченний
  цикл звернень до Slack з відкликаним токеном.
- `service.ts:90` завжди викликає `deliverToSlack(...)`, не дивлячись на
  `row.target`. Публікація з `target: 'markdown'`, якщо вона колись позначиться
  ретраябельною, піде в Slack. Розгалуження за таргетом, яке є в `publish()`
  (рядки 64-67), тут загублене — це та сама логіка, продубльована наполовину.

**Як правильно.** Додати `lt(t.publications.attempts, limit)` у `where`
(і полагодити інкремент), а доставку винести в один приватний метод
`deliver(target, review, title, channel)`, який викликають обидва шляхи.

### C3. Виклики `container.reviewRepo` не збігаються з реальним API

**Файл:** `service.ts:49`, `service.ts:82`, `service.ts:132`

Реальний `ReviewRepository` (`server/src/modules/reviews/repository.ts`):

| Виклик у сервісі | Що є насправді |
|---|---|
| `getPull(workspaceId, prId)` — рядок 49 | `getPull(workspaceId, prId)` — рядок 32 ✔ |
| `getReview(workspaceId, row.reviewId)` — рядок 82 | `getReview(reviewId)` — рядок 69, **один аргумент** |
| `listReviews(workspaceId, prId)` — рядок 132 | такого методу немає; є `reviewsForPull(prId)` — рядок 65 |

**Чому проблема.** `getReview(workspaceId, row.reviewId)` передасть
`workspaceId` як `reviewId` — тобто або не знайде нічого ніколи, або
(з другим аргументом, що просто ігнорується) поверне не той рядок.
`listReviews` не існує взагалі — гілка не збереться. Окремо варто зауважити:
`getReview(reviewId)` **не** скоупиться воркспейсом, тож сервіс не має права
припускати, що скоупінг зроблено за нього, — його треба зробити явно після
читання.

Сам підхід — брати чужий репозиторій із контейнера, а не імпортувати
`../reviews/repository.js` — правильний і відповідає скілу
(«Cross-module repositories live on the container»). Виправляти треба
сигнатури, а не напрямок.

**Як правильно.** Використати `reviewsForPull(prId)` і `getReview(reviewId)`,
а належність до воркспейсу перевірити явно (або, що краще, додати
воркспейс-скоуповані обгортки в `ReviewRepository` — вона вже так робить у
`listRunsForPull`, `deleteReview`).

### C4. `latestReview` не гарантує «останній»

**Файл:** `service.ts:131-134`

```ts
const reviews = await this.container.reviewRepo.listReviews(workspaceId, prId);
return reviews.find((r) => r.kind === 'review') ?? null;
```

`.find()` бере **перший** елемент у порядку, який поверне репозиторій; жодного
`orderBy` тут не декларовано, і метод, на який це має лягти
(`reviewsForPull`), повертає не плоскі записи, а `{ review, findings }[]`. Ім'я
методу обіцяє «найсвіжіший», код цього не забезпечує — при кількох ревʼю
опублікується довільне. Треба або сортувати явно за `createdAt desc`, або
додати в репозиторій ревʼю метод, що повертає останнє.

### C5. Замість `NoProviderKeyError` — саморобний 409 і новий wire-код

**Файл:** `service.ts:106-119` + `SLACK_NOT_CONFIGURED_CODE` у `constants.ts`

**Чому проблема.** У кодовій базі вже є канонічний клас рівно для цього
сценарію — `NoProviderKeyError` (`server/src/platform/errors.ts:54`), і його
докблок пояснює, чому він один на всі фічі: «One class for every LLM feature
… so the code, status and message shape cannot drift per module». Три модулі
використовують його однаково — `conventions/service.ts:113`,
`brief/service.ts:101`, `onboarding/service.ts:109`:

```ts
if (e instanceof ConfigError) throw new NoProviderKeyError(provider, 'extract conventions');
```

Publisher робить те саме руками, зі своїм кодом `SLACK_NOT_CONFIGURED_CODE` і
своїм текстом. Клієнт вимикає дії за відомим кодом `no_provider_key` — новий
код він не розпізнає, тож UI-стан «ключа немає» просто не спрацює.

Там же: локальна функція `summarize()` (`service.ts:142-145`) дублює
`errSummary` з `platform/errors.ts:77`.

**Як правильно.** `throw new NoProviderKeyError('slack', 'publish to Slack')`,
константу прибрати, `summarize` замінити на `errSummary`.

### C6. Валідація таргета продубльована в сервісі

**Файл:** `service.ts:45-47`

```ts
if (!SUPPORTED_TARGETS.includes(target)) {
  throw new AppError('unsupported_target', `Unknown publish target "${target}"`, 422);
}
```

**Чому проблема.** Роут уже декларує `body: PublishRequest`
(`routes.ts:26`), і скіл вимагає: «Parse at the boundary; inside the rings the
data is already trusted». Якщо `PublishRequest.target` — `z.enum([...])`, ця
перевірка недосяжна (мертвий код + фальшиве відчуття захищеності). Якщо ж вона
досяжна, то справжня проблема в тому, що Zod-схема надто вільна, і лагодити
треба схему, а не додавати другий бар'єр у сервісі. Джерелом істини має бути
одна схема; `SUPPORTED_TARGETS` варто виводити з неї
(`PublishTarget.options`), а не тримати окремим списком, який може розійтися.

---

## D. Роути, реєстрація, тести

### D1. Модуль не зареєстровано в `modules/index.ts`

**Файл:** `routes.ts` (плагін є) + `server/src/modules/index.ts` (гілкою не змінений)

Чек-лист нового модуля зі скіла, пункт 5: «One entry in `src/modules/index.ts`.
Registration is static on purpose». Без запису в мапі `modules` плагін ніколи не
монтується — усі три ендпоінти віддадуть 404, а dependency-cruiser додатково
покаже `no-orphans` (severity `warn`) на файл, у який ніхто не імпортить.

**Як правильно.** Один імпорт + один запис `publisher,` у мапі.

### D2. `POST /publications/retry` — без схеми відповіді і без рейт-ліміту

**Файл:** `routes.ts:34-38`

Скіл: «One Zod schema drives request validation **and** response
serialization». Два перші роути мають `params`/`body`, але жоден із трьох не
декларує `response`, і `{ sent }` віддається неcеріалізованим. Окремо: це
воркспейс-широка мутація, що в циклі ходить у зовнішній сервіс, — сусідній
`POST /settings/test-connection` для такого має
`config: { rateLimit: { max: 20, timeWindow: '1 minute' } }`
(`server/src/modules/settings/routes.ts:71`). Тут не завадило б те саме.

Дрібніше: шлях `/publications/retry` випадає зі схеми решти модуля
(`/pulls/:id/publications`) — послідовнішим було б лишити один префікс.

### D3. Тест: неіснуючий хелпер, нетипове розташування, немає Docker-гарда

**Файл:** `publisher.it.test.ts:1-32`

Три окремі проблеми:

1. **`import { makeDb, resetDb, seedWorkspace, seedPull, seedReview } from
   '../../../test/helpers/db.js'`** — такого файлу немає. У
   `server/test/helpers/` є рівно два модулі: `pg.ts` (експортує `PgFixture`,
   `dockerAvailable`, `startPg`) і `runs.ts`. Жодної з п'яти імпортованих
   функцій не існує — тест не збереться.
2. **Розташування.** Усі 13 наявних `*.it.test.ts` лежать у `server/test/`, а
   не всередині `src/modules/**`. Лейни CI розділяються за іменем
   (`vitest run .it.test` проти `--exclude '**/*.it.test.ts'`), тож формально
   файл підхопиться, але конвенцію репозиторію він ламає.
3. **Немає гарда на Docker.** Канонічний патерн — `server/test/reviews.it.test.ts:22-23`:

   ```ts
   const hasDocker = await dockerAvailable();
   const d = hasDocker ? describe : describe.skip;
   ```

   Без нього `scripts/verify.mjs --slice integration` не зможе
   «self-skip without Docker», як обіцяє його ж документація, і лейн падатиме на
   машинах без Docker замість того, щоб пропуститися.

Також `loadConfig()` викликається без аргументів — сусідні інтеграційні тести
роблять `loadConfig({ ...process.env, NODE_ENV: 'test' })`, і це не косметика:
під `NODE_ENV=test` вимикається глобальний рейт-ліміт.

### D4. Тест перевіряє не те, що обіцяє його назва

**Файл:** `publisher.it.test.ts:34-42`

Тест зветься «records the delivery before attempting it», але перевіряє лише
кінцевий стан (`status === 'delivered'`). Головна інваріанта, заради якої
написаний увесь механізм (докблок `service.ts:26-30`: краще рядок у `pending`,
ніж жодного рядка), не перевіряється взагалі — падіння між `insertPending` і
`markDelivered` цим тестом не ловиться. Перевіряти треба, що при краші всередині
доставки рядок у БД лишається (тест на рядку 44 підходить близько, але
перевіряє `retryable`, а не сам факт запису до спроби).

---

## E. Що зроблено правильно (щоб не зламали при виправленні)

- `slack()` — `async` і читає секрет у момент резолву, а не на буті; докблок
  правильно пояснює, чому клієнт лінивий. Це рівно те, чого вимагає скіл, — при
  правках A1/A2 цю властивість треба зберегти.
- Сервіс приймає розвʼязані значення (`workspaceId`, `prId`, `target`,
  `channel`), а не `FastifyRequest`; `fastify` у `service.ts` не імпортується —
  `service-stays-http-agnostic` проходить.
- Роут не торкається Drizzle і делегує в сервіс — `routes-through-service`
  проходить; `getContext` використано так само, як у решті модулів.
- Кросмодульний доступ іде через `container.reviewRepo`, а не імпортом
  `../reviews/repository.js` — `no-cross-module-internals` проходить (лишається
  полагодити сигнатури, C3).
- Рендеринг винесено в `helpers.ts` як чисті функції — саме той поділ, який
  описує чек-лист модуля.

---

## Мінімальний чек-ліст до повторного ревʼю

1. `SlackClient` у `server/src/vendor/shared/adapters.ts` + дзеркало в
   `client/src/vendor/shared` (A4).
2. `server/src/adapters/slack/slack.client.ts` + `slackDefaultChannel` у
   `AppConfig` (A5).
3. `slack?: SlackClient` у `ContainerOverrides`, перевірка overrides **першою**
   в `slack()` (A1).
4. `this._slack = undefined` в `invalidateSecretCaches()` + тест на повторне
   читання секрету (A2).
5. `MockSlackClient` у `adapters/mocks.ts`; `vi.mock` з тесту прибрати,
   підміняти через `new Container(config, db, { slack })` (A3).
6. Таблиця `publications` + **нова** міграція (B2).
7. `err.statusCode` замість `err.status` (C1); `NoProviderKeyError` замість
   саморобного 409 (C5).
8. Сигнатури `reviewRepo` (C3); `attempts` через `sql` + межа спроб (B3, C2).
9. Запис у `src/modules/index.ts` (D1); тест перенести в `server/test/`,
   на реальні хелпери й з Docker-гардом (D3).
10. Прогнати `node scripts/verify.mjs --slice backend` і
    `--slice integration` — dependency-cruiser у бекенд-лейні перевірить
    межі механічно.
