# Ревʼю гілки `publisher` — перед мерджем

Скоуп: `server/src/modules/publisher/{routes,service,repository}.ts`,
`publisher.it.test.ts`, плюс правка `server/src/platform/container.ts`.
Джерела фікстур:
`/Users/andriigorbatiuk/Documents/dev-digest/.claude/skills/onion-architecture/evals/fixtures/publisher-module/`.
Правила: `.claude/skills/onion-architecture/SKILL.md`,
`server/.dependency-cruiser.cjs`, `AGENTS.md`.

**Вердикт: мерджити не можна.** 4 блокери, 7 багів коректності, 5 порушень
конвенцій, 5 позицій, які не сходяться з деревом репозиторію (гілка або
неповна, або не збирається).

Найважливіше: `depcruise` на цій гілці, найімовірніше, **зелений**. Жодна з
чотирьох головних проблем не є імпортом — це пропуски у списках і в
іменах полів. Саме про це «сліпі зони» у `SKILL.md:151-192`.

---

## A. Блокери

### A1. `slack()` не чиститься при ротації секрету — тихо працює зі старим токеном

**Файл:** `container.excerpt.ts:106-110` (реально —
`server/src/platform/container.ts:260-264`)

```ts
invalidateSecretCaches(): void {
  this.llmCache.clear();
  this._github = undefined;
  this._embedder = undefined;
}
```

`_slack` оголошено на `container.excerpt.ts:49` і кешується назавжди на
`container.excerpt.ts:77`, але у списку інвалідації його немає.

**Чому це проблема.** `invalidateSecretCaches()` — це **hardcoded перелік
полів, а не sweep**. Його викликає `server/src/modules/settings/routes.ts:85`
одразу після `container.secrets.set(...)`. Сценарій відмови:

1. Slack-токен відкликали, користувач вставляє новий у Settings.
2. `secrets.set('SLACK_BOT_TOKEN', …)` записує його на диск, UI показує «ОК».
3. `invalidateSecretCaches()` чистить LLM/GitHub/embedder — `_slack` лишається.
4. Кожен наступний `POST /pulls/:id/publications` йде у Slack **відкликаним**
   токеном, доки хтось не рестартне процес.

Це не стектрейс, а тікет у підтримку: ключ «збережено», публікації «не
працюють», у логах — 401 від Slack із токеном, якого вже немає в UI. Ні CI, ні
`depcruise` цього не бачать — це пропуск рядка у списку, а не імпорт
(`SKILL.md:172-183`).

**Як правильно.** Додати `_slack` до списку:

```ts
invalidateSecretCaches(): void {
  this.llmCache.clear();
  this._github = undefined;
  this._embedder = undefined;
  this._slack = undefined;
}
```

Правило, яке варто зафіксувати разом із фіксом: **кожен новий ледачий геттер,
побудований зі значення `SecretsProvider`, має два обовʼязкові доми** —
конструювання і `invalidateSecretCaches()`. JSDoc над методом
(`container.excerpt.ts:102-105`) уже це декларує («Call after persisting a new
API key/PAT»), і саме тому пропуск тут особливо дорогий.

---

### A2. `slack()` не перевіряє `overrides` — порт неможливо підмінити

**Файл:** `container.excerpt.ts:73-79` і `container.excerpt.ts:27-39`

```ts
async slack(): Promise<SlackClient> {
  if (this._slack) return this._slack;          // ← немає overrides.slack
  const token = await this.secrets.get('SLACK_BOT_TOKEN');
  ...
}
```

Порівняйте з сусідами в тому ж файлі: `github()` (рядок 60),
`llm()` (рядок 82), `embedder()` (рядок 92) — усі починають із
`if (this.overrides.X) return this.overrides.X;`. І в
`ContainerOverrides` (рядки 27-39) немає поля `slack?: SlackClient`.

**Чому це проблема.** `SKILL.md:70` вимагає: `overrides.<x>` перевіряється
**першим**, щоб тести вигравали. Без цього `SlackClient` перестає бути портом
у будь-якому корисному сенсі — це просто внутрішній клієнт `Container`. Код
компілюється, `depcruise` зелений, а seam мовчки зламано
(`SKILL.md:181-183`). Прямий наслідок видно нижче в A4: тест не мав іншого
виходу, крім `vi.mock`.

**Як правильно.**

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

### A3. Немає `MockSlackClient` — чек-лист нового порту виконано на 3/4

**Файл:** `mocks.excerpt.ts:6-17`

У `server/src/adapters/mocks.ts` є `MockLLMProvider`, `MockEmbedder`,
`MockGitHubClient`, `MockGitClient`, `MockCodeIndex`, `MockBlast`,
`MockAuthProvider`, `MockSecretsProvider` — і **жодного** `MockSlackClient`.

**Чому це проблема.** `SKILL.md:54-56`: новий порт = інтерфейс у
`vendor/shared` + адаптер у `adapters/` + ледачий геттер і запис у
`ContainerOverrides` + мок у `adapters/mocks.ts`. «Усі чотири, або seam
зламано». Тут не зроблено кроків 3 (частково) і 4. Практичний наслідок ширший
за цей модуль: будь-який майбутній тест — інтеграційний тест іншого модуля,
`test/integration.it.test.ts` — не має чим підмінити Slack і або піде в
мережу, або повторить той самий `vi.mock`.

**Як правильно.** Мок за зразком інших у файлі — накопичувач викликів, а не
заглушка:

```ts
export class MockSlackClient implements SlackClient {
  readonly posted: Array<{ channel?: string; blocks: unknown[]; fallbackText: string }> = [];
  constructor(private behaviour: { fail?: Error } = {}) {}
  async postMessage(msg: { channel?: string; blocks: unknown[]; fallbackText: string }) {
    if (this.behaviour.fail) throw this.behaviour.fail;
    this.posted.push(msg);
    return { ts: `171000000.${String(this.posted.length).padStart(6, '0')}` };
  }
}
```

---

### A4. Тест мокає шлях модуля замість того, щоб підмінити порт

**Файл:** `publisher.it.test.ts:7-13`

```ts
vi.mock('../../adapters/slack/slack.client.js', () => ({
  SlackWebhookClient: class { postMessage = postMessage; },
}));
```

**Чому це проблема.** `SKILL.md:109-112` і `examples.md` (приклад 9) називають
це прямо: підміняти треба через `new Container(config, db, { slack: … })`, а не
`vi.mock` шляху модуля. `vi.mock` привʼязує тест до **графа імпортів**:
перейменували `slack.client.ts`, перенесли адаптер у підпапку, змінили ім'я
експортованого класу — і мок мовчки перестає діяти, тест іде в реальну мережу
й вішається на таймауті (той самий клас відмов, що описаний у
`server/INSIGHTS.md:266-286` про немокнутий LLM-слот). `ContainerOverrides`
привʼязує тест до **порту**, який і є контрактом.

Плюс друга біда: клас-заглушка в моку не `implements SlackClient`, тож
розходження сигнатури `postMessage` не спіймає навіть `tsc`.

Це не окрема помилка автора тесту — це **симптом A2**. Поки `slack()` не
перевіряє `overrides.slack`, іншого способу написати цей тест немає. Фіксити
треба A2, і тоді тест стає:

```ts
const slack = new MockSlackClient();
container = new Container(loadConfig(), db, {
  slack,
  secrets: new MockSecretsProvider({ SLACK_BOT_TOKEN: 'xoxb-test' }),
});
```

---

## B. Баги коректності (перевірено по коду репозиторію)

### B1. `err.status` не існує — жодна помилка ніколи не стане `retryable`

**Файл:** `service.ts:137`

```ts
if (err instanceof AppError) return err.status >= 500 || err.code === 'slack_rate_limited';
```

У `server/src/platform/errors.ts:9-19` поле називається **`statusCode`**, не
`status`. `err.status` — `undefined`, `undefined >= 500` → `false`. Отже гілка
`AppError` завжди повертає `false` (крім точного збігу коду
`slack_rate_limited`).

**Наслідок.** `ExternalServiceError` (502, `errors.ts:33-37`) — канонічний
«зовнішній сервіс упав» цього репозиторію — класифікується як `failed`, а не
`retryable`, і `POST /publications/retry` його ніколи не підбере. Тобто
центральна фіча гілки не працює саме для того випадку, заради якого існує.

TypeScript це не ловить, бо `AppError` — клас без index-signature, але
`err.status` на звуженому типі має дати помилку компіляції; якщо не дає —
значить `strict`/`noImplicitAny` тут обійдено, що саме по собі варто перевірити.

**Як правильно:** `err.statusCode >= 500`. І винести `'slack_rate_limited'` у
`constants.ts` поруч із `SLACK_NOT_CONFIGURED_CODE` — зараз це «магічний»
рядок посеред логіки.

---

### B2. `reviewRepo.getReview()` викликано з неправильною сигнатурою

**Файл:** `service.ts:82`

```ts
const review = await this.container.reviewRepo.getReview(workspaceId, row.reviewId);
```

Реальна сигнатура — `server/src/modules/reviews/repository.ts:69`:

```ts
getReview(reviewId: string): Promise<ReviewRow | undefined>
```

Один аргумент. Тут у нього передається `workspaceId`, а справжній `reviewId`
просто відкидається.

**Наслідок.** `getReview` шукає ревʼю з id, рівним id воркспейсу → завжди
`undefined` → гілка `if (!review || !pull)` на `service.ts:84` спрацьовує
**для кожного** рядка, і `retryFailed` замість повторної відправки помічає всі
записи як `failed` з текстом `'review or pull disappeared'`. Дані виглядають
загубленими, хоча вони на місці.

Тест `publisher.it.test.ts:54-63` цього не ловить лише тому, що працює проти
неіснуючих хелперів (див. D1) — тобто зараз він не виконується взагалі.

**Як правильно:** `getReview(row.reviewId)`, а перевірку належності до
воркспейсу робити явно (`review.workspaceId !== workspaceId → failed`), або
додати workspace-scoped перевантаження в `ReviewRepository` — це його файл,
там така зміна доречна.

---

### B3. `reviewRepo.listReviews()` не існує

**Файл:** `service.ts:132`

```ts
const reviews = await this.container.reviewRepo.listReviews(workspaceId, prId);
return reviews.find((r) => r.kind === 'review') ?? null;
```

У `ReviewRepository` немає методу `listReviews`. Найближчий —
`reviewsForPull(prId)` (`reviews/repository.ts:66-68`), і він повертає
**`{ review, findings }[]`**, а не `ReviewRow[]`, тож `r.kind` на елементі
цього масиву не існує.

Додатково: метод називається `latestReview`, але «найновіший» ніде не
забезпечено — `find()` бере перший елемент у порядку, який задає чужий
репозиторій. `reviewsForPull` документований як «newest first», проте
покладатися на це мовчки, з іменем `latestReview`, — це майбутній регрес при
першій же зміні `ORDER BY` в модулі `reviews`. Або сортуйте явно, або
попросіть у `ReviewRepository` метод із гарантією в назві.

---

### B4. `attempts` ніколи не інкрементується — «нескінченно retryable» рядок

**Файл:** `repository.ts:60` і `repository.ts:102-104`

```ts
.set({ status, error, attempts: sqlIncrement() })
...
function sqlIncrement() {
  return undefined as unknown as number;
}
```

Drizzle **викидає `undefined`** з `.set()`, тож колонка не оновлюється взагалі.
`attempts` вічно `0`.

**Наслідок.** `PUBLISH_RETRY_LIMIT` (`service.ts:78`) обмежує лише **скільки
рядків** береться за один прохід, а не скільки разів конкретний рядок уже
пробували. Публікація, яка падає детерміновано (видалений канал, забанений
бот), назавжди лишається `retryable` і йде в Slack при **кожному** виклику
`POST /publications/retry` — і назавжди займає місце в ліміті, витісняючи
свіжі записи. Плюс `listRetryable` не має ніякого фільтра по `attempts`
(`repository.ts:74-88`), тож стеля не застосовується ніде.

Окремо: `undefined as unknown as number` — це подвійний каст, який існує
винятково щоб збрехати компілятору. Такий каст у репозиторії — сигнал, що
типи кажуть правду, а код — ні.

**Як правильно:**

```ts
import { sql } from 'drizzle-orm';
.set({ status, error, attempts: sql`${t.publications.attempts} + 1` })
```

і додати в `listRetryable` умову `lt(t.publications.attempts, maxAttempts)`.

---

### B5. `retryFailed` ігнорує `row.target` і шле все у Slack

**Файл:** `service.ts:90`

```ts
const result = await this.deliverToSlack(review, pull.title, row.channel ?? undefined);
```

`publish()` (рядки 64-67) розгалужується за `target`, а `retryFailed()` — ні.
Будь-який рядок із `target: 'markdown'`, який опинився в статусі `retryable`,
при ретраї піде повідомленням у Slack — у канал `null`, тобто в дефолтний
канал воркспейсу. Публікація в чужий/загальний канал через ретрай — це
видима користувачу відмова, і без A2/A3 її нічим накрити тестом.

**Як правильно:** винести розгалуження за `target` в один приватний
`deliver(row, review, pull)`, який використовують обидва шляхи. Зараз логіка
вибору транспорту продубльована й уже розʼїхалася.

---

### B6. `listRecent()` без фільтра по `workspaceId` — міжтенантний витік

**Файл:** `repository.ts:90-99`

```ts
async listRecent(prIds: string[]): Promise<PublishRecord[]> {
  const rows = await this.db.select().from(t.publications)
    .where(inArray(t.publications.prId, prIds))   // ← жодного workspaceId
    .orderBy(desc(t.publications.createdAt)).limit(200);
```

Усі інші п'ять методів цього ж файлу коректно скоуплені. Цей — ні.

**Чому це проблема.** `SKILL.md:120-121`, пункт 3 чек-листа нового модуля:
репозиторій — єдине місце, що торкається своїх таблиць, і **кожен запит
скоуплений `workspaceId`**. Метод приймає `prId[]` ззовні; достатньо одного
виклику з id чужого PR — і історія публікацій іншого воркспейсу, разом із
`channel` та `error`, виїде назовні. Одна незаскоуплена вибірка в репозиторії
достатня, щоб мультитенантність перестала бути гарантією й стала звичкою.

Додатково: у гілці немає жодного виклику `listRecent` — це мертвий код. Мертвий
код із дірою в скоупінгу — найгірша комбінація: ревʼю його пропускає («ним ніхто
не користується»), а наступний автор бере його як готовий і правильний.

**Як правильно:** або видалити до появи споживача, або
`and(eq(t.publications.workspaceId, workspaceId), inArray(...))` з
`workspaceId` першим аргументом, як у решті файлу.

---

### B7. `row!` після workspace-скоупленого `UPDATE` дає 500 замість 404

**Файл:** `repository.ts:49` (і той самий патерн на рядку 29)

```ts
.where(and(eq(...workspaceId, workspaceId), eq(...id, id)))
.returning();
return toDto(row!);
```

Якщо `id` існує, але належить іншому воркспейсу (або рядок уже видалено),
`UPDATE` зачепить 0 рядків, `.returning()` дасть `[]`, `row` — `undefined`, і
`toDto(undefined!)` впаде на `row.id` як `TypeError`. Клієнт отримає 500 і
`internal_error` там, де коректна відповідь — `NotFoundError` (404). `!` тут
глушить рівно ту перевірку, заради якої `workspaceId` і додано в `WHERE`.

**Як правильно:** `if (!row) throw new NotFoundError('Publication not found');`

---

## C. Шари й конвенції

### C1. У жодного роуту немає `schema.response`

**Файл:** `routes.ts:19-38`

Усі три роути оголошують `params`/`body`, але жоден не оголошує
`response[200]`.

**Чому це проблема.** Це не косметика — `server/src/modules/_shared/schemas.ts:14-23`
пояснює навіщо: серіалізатор валідує те, що **виходить** із процесу, і
хендлер, який почав повертати сирий Drizzle-рядок (з `workspaceId`,
внутрішніми таймстемпами), падає голосно замість того, щоб мовчки розширити
публічний API. `SKILL.md:88` формулює те саме: одна Zod-схема веде і валідацію
запиту, і серіалізацію відповіді.

Тут ризик конкретний: `toDto` (`repository.ts:106-119`) — єдиний бар'єр між
таблицею і мережею, і його легко обійти майбутнім `return rows` без мапи.

`POST /publications/retry` (рядок 34) не має `schema` взагалі і повертає
неописаний `{ sent }`.

**Як правильно:** `schema: { params: IdParams, response: { 200: PublishRecord } }`
з DTO-схемами з `@devdigest/shared`, і `OkResponse`-подібна схема для `retry`.

---

### C2. Власний код помилки дублює наявну таксономію `NoProviderKeyError`

**Файл:** `service.ts:106-119`, константа `SLACK_NOT_CONFIGURED_CODE`

Сервіс ловить `ConfigError` і вручну перепаковує його в
`AppError(SLACK_NOT_CONFIGURED_CODE, 'No Slack token configured — add one in
Settings to publish to Slack.', 409)`.

У `platform/errors.ts:44-62` це вже є — і клас, і формулювання:

```ts
export const NO_PROVIDER_KEY_CODE = 'no_provider_key';
export class NoProviderKeyError extends AppError {
  constructor(provider: string, action: string) {
    super(NO_PROVIDER_KEY_CODE, `No API key configured for provider "${provider}" — add one in Settings to ${action}.`, 409, { provider });
  }
}
```

Коментар над ним прямо каже, чому клас один на всі LLM-фічі: «щоб код, статус
і форма повідомлення не могли розʼїхатися по модулях». Ця гілка створює другий
wire-код для рівно того самого UI-стану. Клієнт вимикає свої кнопки за
`no_provider_key` — `slack_not_configured` він не знає, і кнопка «Publish»
поводитиметься інакше, ніж усі інші кнопки з тим самим змістом.

**Як правильно:** `throw new NoProviderKeyError('slack', 'publish to Slack')`
і видалити `SLACK_NOT_CONFIGURED_CODE`. Якщо Slack принципово не «provider» —
це зміна таксономії в `platform/errors.ts`, а не приватна константа модуля.

---

### C3. Помилка доставки летить назовні сирою — 500 замість 502

**Файл:** `service.ts:70-74`

```ts
} catch (err) {
  ...
  throw err;   // ← `Error('fetch failed')`, не AppError
}
```

Обрив мережі до Slack виходить із сервісу звичайним `Error` і доїжджає до
`app.setErrorHandler` (`server/src/app.ts:129`) як невідома помилка → 500
`internal_error`. Але «зовнішній сервіс недоступний» — це не наша поломка, і
для неї в репозиторії вже є `ExternalServiceError` (502, `errors.ts:33-37`).
`SKILL.md:89-90`: сервіси кидають доменні помилки зі статусом, роути не мапають
їх руками — саме тому статус має призначатися тут.

**Як правильно:** у `catch` перепакувати не-`AppError` у
`new ExternalServiceError(...)` перед `throw` (зберігши оригінал у `details`).
Заодно зникає B1-подібна плутанина: `isRetryable` тоді читає `statusCode` з
власної, а не з чужої помилки.

---

### C4. `POST /publications/retry` — воркспейс-широкий фан-аут без rate limit

**Файл:** `routes.ts:34-38`

Роут без `params`, без `body`, без обмежень розсилає до `PUBLISH_RETRY_LIMIT`
повідомлень у Slack за один HTTP-виклик. У цьому ж репозиторії
`POST /settings/test-connection` (`settings/routes.ts:70-73`) несе
`config: { rateLimit: { max: 20, timeWindow: '1 minute' } }` — а він робить
рівно один зовнішній виклик. Тут доречно щонайменше те саме; Slack за флуд
відповідає 429, і без B4 (лічильник спроб) це самопідсилювана петля.

---

### C5. Тест лежить усередині `src/modules/`, а не в `server/test/`

**Файл:** `publisher.it.test.ts` (шлях `src/modules/publisher/`)

Усі 12 наявних `*.it.test.ts` живуть у `server/test/` (`test/brief.it.test.ts`,
`test/integration.it.test.ts`, …). `vitest.config.ts` включає
`src/**/*.test.ts`, а CI-фільтр `vitest run .it.test`
(`.github/workflows/server-integration.yml:65`) — підрядковий, тож файл таки
запуститься. Але є друга причина, крім однорідності: `src/modules/publisher/`
потрапляє під `from: { path: '^src/modules/' }` правила
`no-direct-adapter-clients`. Зараз `vi.mock('…/adapters/slack/…')` проходить
лише тому, що це рядковий аргумент, а не імпорт — dependency-cruiser читає
імпорти. Перший же рефактор мока в нормальний `import` зламає збірку
несподівано для автора.

---

## D. Тест: чому він зараз не є доказом

### D1. Імпортує хелпери, яких не існує

**Файл:** `publisher.it.test.ts:2`

```ts
import { makeDb, resetDb, seedWorkspace, seedPull, seedReview } from '../../../test/helpers/db.js';
```

У `server/test/helpers/` є лише `pg.ts` і `runs.ts`. Модуля `db.ts` немає;
жодного з пʼяти імен у репозиторії немає. Реальний фікстур-API —
`startPg()`, `dockerAvailable()`, `type PgFixture` (`test/helpers/pg.ts`), а
сідування інші тести роблять через `seed()` з `src/db/seed.ts` та прямі
вставки в Drizzle.

Тобто **тест не компілюється й не виконується**. Усі чотири `it(...)` — зелені
на папері й нульові за доказовістю; саме тому B2 і B3 доїхали до ревʼю.

### D2. Немає Docker-гейта, обовʼязкового для інтеграційної смуги

Канонічний патерн (`test/brief.it.test.ts:13-20`):

```ts
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
```

`scripts/verify.mjs:31` описує integration-смугу як таку, що **self-skips
without Docker**. Без гейта `node scripts/verify.mjs --slice integration` на
машині без Docker впаде замість того, щоб пропустити — тобто зламає локальний
воркфлоу всім, а не лише авторові.

### D3. `secrets` підмінено кастом `as never` замість наявного мока

**Файл:** `publisher.it.test.ts:26-30`

```ts
container = new Container(loadConfig(), db, {
  secrets: { get: async (key) => (key === 'SLACK_BOT_TOKEN' ? 'xoxb-test' : undefined) } as never,
});
```

`as never` глушить перевірку відповідності порту `SecretsProvider` — зокрема
відсутність `set`, від якої залежить `settings/routes.ts`. У
`adapters/mocks.ts` для цього є `MockSecretsProvider` (`mocks.excerpt.ts:17`).
Каст у тесті — та сама втрата seam-у, що й A4, лише на іншому порту.

### D4. Тести не перевіряють те, що заявляють у назві

- `'records the delivery before attempting it'` (рядок 34) перевіряє **фінальний**
  стан `delivered`. Гарантія «рядок `pending` існує **до** спроби» — головна
  теза докблоку сервісу (`service.ts:27-30`) — не спостерігається взагалі.
  Щоб її перевірити, треба зупинити виконання всередині `postMessage` і
  прочитати таблицю.
- Немає жодного тесту на шлях `ConfigError → 409` (`service.ts:106-119`) — а це
  єдиний шлях, який ловить «Slack не налаштовано».
- Немає тесту на `unsupported_target` (`service.ts:45-47`).
- **Немає тесту на A1** — і його неможливо написати, поки не зроблено A2.
  Після фіксу він тривіальний і має бути в цій же гілці: підмінити секрет,
  викликати `slack()`, викликати `invalidateSecretCaches()`, викликати
  `slack()` знову, перевірити, що другий виклик прочитав нове значення. Саме
  такий тест зробив би A1 неможливим у майбутньому.

---

## E. Не сходиться з деревом репозиторію — перевірити перед мерджем

Перевірено на `L06-Evals` (`git log -1` → `4765abc`). Це або неповна вирізка
фікстур, або гілка справді не збирається; у другому випадку кожен пункт —
блокер.

| # | Чого бракує | Де перевірено |
|---|---|---|
| E1 | Таблиці `publications` немає в `server/src/db/schema.ts`, і в інвентарі гілки немає міграції. `AGENTS.md`: міграції не застосовуються на бутi (`pnpm db:migrate`), і **додається нова**, а не правиться застосована `db/migrations/*.sql`. | `grep -rn publications server/src/db/` → порожньо |
| E2 | Порту `SlackClient` немає в `server/src/vendor/shared/adapters.ts` (є `LLMProvider`, `Embedder`, `GitHubClient`, `GitClient`, `CodeIndex`, `AuthProvider`, `SecretsProvider`). `container.excerpt.ts:17` імпортує його з `@devdigest/shared`. | `grep -n '^export interface' server/src/vendor/shared/adapters.ts` |
| E3 | Адаптера `server/src/adapters/slack/slack.client.ts` немає; `container.excerpt.ts:24` його імпортує. Немає й `config.slackDefaultChannel` у `platform/config.ts`, хоч `container.excerpt.ts:77` його читає. | `grep -rni slack server/src/` → один нерелевантний збіг |
| E4 | `publisher` не зареєстровано в `server/src/modules/index.ts`. Без одного імпорту + одного запису роути просто не існують у застосунку, а модуль ловить `no-orphans` (warn). Реєстрація статична навмисне — `SKILL.md:125-126`. | `grep -n publisher server/src/modules/index.ts` → порожньо |
| E5 | `helpers.ts` і `constants.ts` імпортуються сервісом (`service.ts:10-16`), але їх немає в інвентарі гілки («routes, service, repository, інтеграційний тест»). Без них `tsc` падає. | `service.ts:10-16` |
| E6 | Контракти `PublishRequest`, `PublishRecord`, `PublishTarget`, `PublishStatus` перетинають мережу (body роуту + відповідь), отже мають бути продубльовані в `client/src/vendor/shared`. `AGENTS.md`: «Edit the server copy, then mirror wire-crossing changes into the client copy — never edit only one». `SKILL.md:57`. | немає в жодній із двох копій |

---

## F. Що зроблено правильно (не змінювати при фіксах)

- `routes.ts` — чистий edge: `getContext` → сервіс → повернення. Жодного
  Drizzle, жодного `Schema.parse(req.body)` руками. `routes-through-service`
  дотримано.
- `service.ts:39-44`, `102` — сервіс приймає **розвʼязані значення**
  (`workspaceId`, `prId`, `target`), а не `FastifyRequest` — навіть як тип
  (`SKILL.md:164-170`). Його можна викликати з джоби.
- `service.ts:35-37` — конструктор бере `Container` і будує власний репозиторій
  із `container.db`, точно як `modules/repos/service.ts` (`SKILL.md:76-78`).
- `service.ts:49`, `82-83` — чужі дані беруться через `container.reviewRepo`, а
  не інлайновим запитом до `t.reviews` і не імпортом `../reviews/repository.js`
  (`SKILL.md:185-192`). Сигнатури зламані (B2, B3), але **напрямок правильний**.
- `repository.ts` — єдине місце, що торкається `publications`; 5 із 6 методів
  скоуплені `workspaceId`; `toDto` тримає wire-форму (`snake_case`) окремо від
  форми рядка.
- Ім'я `publisher.it.test.ts` відповідає глобу, за яким CI ділить смуги
  (`AGENTS.md`, `server-unit.yml:106` / `server-integration.yml:65`).
- Рішення «записати доставку до спроби» (`service.ts:27-30`) — правильне і
  правильно пояснене в докблоці. Шкода лише, що воно ніде не перевірене (D4).

---

## G. Порядок робіт

1. **A2 → A3 → A4 → A1** саме в цьому порядку: без `overrides.slack` неможливо
   написати тест ані на мок, ані на інвалідацію кешу. A1 — однорядковий фікс,
   але його цінність зʼявляється лише разом із тестом, який його утримає.
2. **B1, B2, B3, B4** — без них фіча ретраїв не працює в жодному сценарії.
3. **B6, B7** — скоупінг і `!`; дешево, ризик високий.
4. **D1, D2** — привести тест до реального фікстур-API (`startPg`,
   `dockerAvailable`) і додати гейт; лише після цього решта тестів взагалі
   щось доводить.
5. **E1-E6** — підтвердити, що гілка містить міграцію, порт, адаптер,
   `helpers/constants`, запис у `modules/index.ts` і дзеркало контрактів у
   клієнті. Прогнати `node scripts/verify.mjs --slice backend` і
   `--slice integration`.
6. **C1-C4** — схеми відповідей, таксономія помилок, rate limit.

Нагадування на майбутнє: `depcruise` тут майже напевно зелений. Він читає
імпорти — а A1, A2, A3 і B6 імпортів не створюють. Зелений CI на цій гілці не
є висловлюванням про її архітектуру.
