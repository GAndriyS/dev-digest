# Ревʼю гілки `publisher` (модуль `server/src/modules/publisher`)

Перевірено проти skill `onion-architecture` v1.0.0 та проти фактичного коду в репозиторії
(`server/src/platform/container.ts`, `server/src/modules/reviews/repository.ts`,
`server/src/modules/settings/*`, `server/src/db/schema/**`, `server/test/helpers/**`,
`server/.dependency-cruiser.cjs`).

Шляхи у фікстурі відповідають гілковим файлам так:

| Файл у фікстурі | Файл у гілці |
|---|---|
| `routes.ts` | `server/src/modules/publisher/routes.ts` |
| `service.ts` | `server/src/modules/publisher/service.ts` |
| `repository.ts` | `server/src/modules/publisher/repository.ts` |
| `publisher.it.test.ts` | `server/src/modules/publisher/publisher.it.test.ts` |
| `container.excerpt.ts` | вирізка з `server/src/platform/container.ts` |
| `mocks.excerpt.ts` | список експортів `server/src/adapters/mocks.ts` |

**Вердикт: мерджити не можна.** Вісім блокерів, з них три — це порушення архітектурного
шва (порт Slack підключено наполовину), один — витік даних між воркспейсами, і один —
тихий баг з протухлим секретом, який неможливо полагодити без рестарту процесу.

---

## Блокери

### B1. Порт `SlackClient` підключено наполовину — тестовий шов зламано

**Файли/рядки:**
- `container.excerpt.ts:27-39` — в `ContainerOverrides` немає поля `slack?: SlackClient`
- `container.excerpt.ts:73-79` — геттер `slack()` не перевіряє `this.overrides.slack`
- `mocks.excerpt.ts:6-17` — у `server/src/adapters/mocks.ts` немає `MockSlackClient`

**Чому це проблема.** Skill, розділ «Ports and adapters», формулює це як цілісний набір з
чотирьох кроків: «New port → interface in `vendor/shared` (server copy is canonical),
adapter in `adapters/`, lazy getter + `ContainerOverrides` entry in `container.ts`, mock in
`adapters/mocks.ts`. **All four, or the seam is broken.**» Тут зроблено два з чотирьох:
інтерфейс + адаптер + геттер, але без запису в `ContainerOverrides` і без мока.

Порівняйте з сусіднім геттером у тому самому файлі — `github()`, `container.excerpt.ts:59-66`:

```ts
async github(): Promise<GitHubClient> {
  if (this.overrides.github) return this.overrides.github;   // ← overrides ПЕРШИМИ
  if (this._github) return this._github;
  ...
}
```

а `slack()` починається одразу з кешу:

```ts
async slack(): Promise<SlackClient> {
  if (this._slack) return this._slack;                        // ← overrides взагалі немає
  const token = await this.secrets.get('SLACK_BOT_TOKEN');
  ...
}
```

Skill, «The composition root»: «Lazy getter with `??=` caching; `overrides.<x>` checked
**first** so tests win». Тут тести програють — і наслідок видно прямо в тесті гілки (B3).

Це той самий шаблон, який у реальному контейнері вже застосовано до всіх без винятку
залежностей: `github()`, `llm()`, `embedder()`, `git`, `codeIndex`, `repoIntel`,
`projectContext`, `blast`, `depgraph`, `tokenizer` — у кожного `overrides` перевіряється
першим рядком. `slack()` — єдиний виняток на гілці.

**Як правильно.** Три правки, всі механічні:

```ts
// server/src/platform/container.ts
export interface ContainerOverrides {
  ...
  /** Slack delivery (L06) — tests inject a MockSlackClient. */
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

```ts
// server/src/adapters/mocks.ts
export class MockSlackClient implements SlackClient {
  readonly posted: Array<{ channel?: string; blocks: unknown[]; fallbackText: string }> = [];
  constructor(private ts = '1712345678.000100') {}
  async postMessage(input: { channel?: string; blocks: unknown[]; fallbackText: string }) {
    this.posted.push(input);
    return { ts: this.ts };
  }
}
```

Також переконайтеся, що інтерфейс `SlackClient` доданий у **канонічну** копію
`server/src/vendor/shared/adapters.ts` (зараз у ній його немає — див. S6).

---

### B2. `invalidateSecretCaches()` не скидає закешований Slack-клієнт

**Файл/рядки:** `container.excerpt.ts:106-110` (у гілці — `server/src/platform/container.ts`,
метод `invalidateSecretCaches`).

```ts
invalidateSecretCaches(): void {
  this.llmCache.clear();
  this._github = undefined;
  this._embedder = undefined;
  // ← this._slack НЕ скинуто
}
```

Поле `_slack` оголошено на `container.excerpt.ts:49` і заповнюється на `:77` значенням,
похідним від секрету `SLACK_BOT_TOKEN` (`:75`). Тобто це такий самий secret-derived кеш, як
`_github` і `llmCache` — але з інвалідизації випав.

**Чому це проблема.** Контракт методу задекларований у його ж докблоці на
`container.excerpt.ts:102-105`: «Drop cached provider clients so the next resolve picks up
changed secrets. Call after persisting a new API key/PAT via `SecretsProvider.set`». Гілка
додала четвертий кешований клієнт і не виконала цей контракт. Skill, «The composition root»:
«Anything needing a secret is `async` (`github()`, `llm()`, `embedder()`) — the key is read
through `SecretsProvider` **at resolve time, not at boot**». Сенс «at resolve time» саме в
тому, що ротація ключа має підхопитися без рестарту; закешований клієнт це скасовує.

Єдиний реальний виклик — `server/src/modules/settings/routes.ts:84`, одразу після
`container.secrets.set(...)`.

**Ланцюжок наслідків** (чому це не косметика):

1. Користувач ротує Slack-токен. Старий токен відкликано.
2. `container.slack()` віддає закешований `SlackWebhookClient` зі **старим** токеном — і так до
   перезапуску процесу.
3. Slack відповідає `invalid_auth` / 401.
4. `PublisherService.isRetryable` (`service.ts:136-139`) для 401 повертає `false`
   (`err.status >= 500` не спрацьовує).
5. `service.ts:71` та `:94` пишуть статус `'failed'`, а не `'retryable'`.
6. `repository.ts:74-88` (`listRetryable`) вибирає лише `'retryable'` → `POST /publications/retry`
   ці рядки **вже ніколи не підбере**.

Тобто одна пропущена лінійка в інвалідизації перетворює тимчасову проблему з токеном на
безповоротно втрачені публікації, які не рятує навіть явний ретрай користувача. Симптом при
цьому виглядає як «Slack зламався», а не як «токен старий», — діагностувати важко.

**Як правильно.**

```ts
invalidateSecretCaches(): void {
  this.llmCache.clear();
  this._github = undefined;
  this._embedder = undefined;
  this._slack = undefined;   // ← додати
}
```

**Ширша проблема, яку варто закрити тут же.** Цей метод — ручний список, який мовчки
розсинхронізовується з кожним новим secret-derived геттером; гілка `publisher` це щойно й
продемонструвала. Два варіанти, будь-який краще за поточний:

- звести всі secret-derived клієнти в одну `Map<string, unknown>`, тоді інвалідизація —
  один `clear()` і забути про неї неможливо;
- або додати юніт-тест у `server/test/`, який після заповнення всіх кешів викликає
  `invalidateSecretCaches()` і перевіряє, що **жодне** приватне поле, похідне від секрету,
  не лишилось визначеним. Тест не потребує контейнера з БД і коштує десять рядків.

Мінімум — коментар над списком приватних полів: «додав secret-derived кеш → додай його в
`invalidateSecretCaches`».

---

### B3. Із B2 тягнеться друга половина: `SLACK_BOT_TOKEN` неможливо задати через Settings

**Файли/рядки:** `service.ts:112-117` проти `server/src/modules/settings/constants.ts:8-13`
і `server/src/modules/settings/routes.ts:83`.

Сервіс віддає користувачеві повідомлення:

```ts
'No Slack token configured — add one in Settings to publish to Slack.'
```

Але єдиний шлях запису секрету в застосунку — `POST /settings/test-connection`
(`settings/routes.ts:76-84`), а він пише лише ключі з мапи
`SECRET_KEY_BY_PROVIDER` (`settings/constants.ts:8-13`):

```ts
export const SECRET_KEY_BY_PROVIDER: Record<ConnTestProvider, SecretKey> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  github: 'GITHUB_TOKEN',
};
```

`SLACK_BOT_TOKEN` у ній відсутній. Тобто:

- повідомлення користувачеві вказує на UI, у якому потрібного поля немає — фактично
  неправдива інструкція;
- єдиний спосіб задати токен — вручну відредагувати `~/.devdigest/secrets.json`;
- при такому редагуванні `invalidateSecretCaches()` **взагалі не викликається** — тож навіть
  після виправлення B2 перший успішний резолв закешує клієнт, а зміна файлу повз API
  залишиться непоміченою.

**Як правильно.** Або додати `slack` у `SECRET_KEY_BY_PROVIDER` і в `ConnTestProvider`, щоб
запис секрету йшов тим самим шляхом (а отже й через `invalidateSecretCaches()`), або
переписати текст помилки так, щоб він відповідав дійсності. Перше — краще: воно ж закриває
B2 остаточно.

---

### B4. Тест мокає шлях модуля адаптера замість підміни порту

**Файл/рядки:** `publisher.it.test.ts:9-13`

```ts
vi.mock('../../adapters/slack/slack.client.js', () => ({
  SlackWebhookClient: class { postMessage = postMessage; },
}));
```

**Чому це проблема.** Skill, «Testing seams», перше правило: «Substitute adapters via
`new Container(config, db, { github: mockGitHub })` — **not `vi.mock` of a module path**.
Module-mocking couples the test to the import graph; `ContainerOverrides` couples it to the
port». Той самий приклад у `examples.md` #9 — у графі «❌» стоїть буквально
`vi.mock('../../adapters/github/octokit.js', ...)`.

Практичні наслідки: тест ламається від перейменування чи переїзду файлу адаптера; він
підміняє **конструктор класу**, а не реалізацію інтерфейсу, тож розходження з `SlackClient`
компілятор не спіймає; і він валідує саме той шлях, яким продакшн-код ходити не повинен.

Це прямий наслідок B1 — автор не мав чим підмінити порт, бо `ContainerOverrides.slack` і
`MockSlackClient` не існують. Виправлення B1 знімає й це.

**Як правильно:**

```ts
const slack = new MockSlackClient();
container = new Container(loadConfig(), db, { slack });
...
expect(slack.posted).toHaveLength(1);
```

Додатково, `publisher.it.test.ts:26-30`:

```ts
container = new Container(loadConfig(), db, {
  secrets: { get: async (key: string) => ... } as never,
});
```

`as never` глушить перевірку типів на межі, для якої мок уже існує —
`MockSecretsProvider` (`mocks.excerpt.ts:17`). Використайте його: підпис `SecretsProvider`
тоді перевіряється компілятором, а не касттом. І після виправлення B1 інʼєкція секрету
взагалі стає непотрібною — підміняється сам `slack`.

---

### B5. Тест імпортує неіснуючі хелпери, не має Docker-гейта і лежить не там

**Файл/рядок:** `publisher.it.test.ts:2`

```ts
import { makeDb, resetDb, seedWorkspace, seedPull, seedReview } from '../../../test/helpers/db.js';
```

Три окремі проблеми:

1. **Модуля не існує.** У `server/test/helpers/` є рівно два файли: `pg.ts` і `runs.ts`.
   Ані `db.ts`, ані жодного з пʼяти імпортованих символів у репозиторії немає. Тест не
   скомпілюється.
2. **Немає Docker-гейта.** Усі чотирнадцять інтеграційних тестів у `server/test/*.it.test.ts`
   підіймають Postgres через `startPg`/`dockerAvailable` з `test/helpers/pg.ts` і
   гейтяться рядком `const d = hasDocker ? describe : describe.skip;` (див.
   `server/test/reviews.it.test.ts:25-26`). Цей тест викликає `describe` напряму — на машині
   чи в лейні без Docker він не пропуститься, а впаде.
3. **Розташування.** Тест лежить у `server/src/modules/publisher/`, тоді як усі
   `*.it.test.ts` у проєкті — в `server/test/`. Це не косметика: `vitest.config.ts:15`
   включає `src/**/*.test.ts`, а `server/.dependency-cruiser.cjs` крузить дерево `src`
   цілком — тобто продакшн-дерево тепер має файл, що імпортує тестові хелпери й
   `vitest` (devDependency). Це вилазить у `not-to-dev-dep` (`severity: 'error'`,
   `.dependency-cruiser.cjs:148-150`) і, ймовірно, у `no-orphans`.

**Як правильно.** Перенести у `server/test/publisher.it.test.ts`, використати `startPg` /
`dockerAvailable` з `./helpers/pg.js` і гейт `describe.skip`, як у сусідніх файлах. Ім'я
`*.it.test.ts` — правильне (skill: «DB-backed tests must be named `*.it.test.ts`; the unit
and integration CI lanes split on exactly that glob»), питання лише в теці.

---

### B6. Сервіс викликає методи `reviewRepo`, яких не існує / з іншим підписом

**Файл/рядки:** `service.ts:82` і `service.ts:132`

```ts
const review = await this.container.reviewRepo.getReview(workspaceId, row.reviewId);   // :82
const reviews = await this.container.reviewRepo.listReviews(workspaceId, prId);        // :132
```

Фактичний `ReviewRepository` (`server/src/modules/reviews/repository.ts`):

- `getReview(reviewId: string)` — **один** аргумент, `:69`. Виклик на `service.ts:82`
  передає `workspaceId` там, де очікується `reviewId`, а `row.reviewId` — зайвим другим
  аргументом. У кращому разі це помилка компіляції; якщо її десь заглушили — метод шукатиме
  ревʼю за id воркспейсу і завжди повертатиме `undefined`, після чого
  `service.ts:85` позначить кожен рядок як `'failed'` з текстом «review or pull disappeared».
  Тобто ретрай перетворюється на масове списання рядків у безповоротний `failed`.
- `listReviews` — **методу немає взагалі**. Найближчий — `reviewsForPull(prId)` (`:65`), який
  приймає лише `prId` і повертає `{ review, findings }[]`, а не `ReviewRecord[]`.

`getPull(workspaceId, prId)` (`service.ts:49`, `:83`) — єдиний із трьох, що збігається з
реальним підписом (`repository.ts:32`).

**Чому це проблема.** Крім того, що гілка не збирається: `service.ts:131-134` типізує
результат як `ReviewRecord` (контракт із `@devdigest/shared`), а репозиторій віддає
Drizzle-рядок `ReviewRow`. Це різні форми, і різницю зараз ніхто не ловить.

**Як правильно.** Або користуватися наявним `reviewsForPull(prId)` і мапити рядок у
`ReviewRecord` на місці, або — якщо `publisher` дійсно потребує workspace-скоупленого
`getReview` — додати його в `ReviewRepository` (він живе на контейнері саме для
міжмодульного вжитку) із явним підписом `getReview(workspaceId, reviewId)`. Другий варіант
чистіший, бо workspace-скоуп на крос-модульному ретрай-шляху потрібен обовʼязково.

---

### B7. `listRecent` не скоупиться по `workspaceId` — читання через межу воркспейсу

**Файл/рядки:** `repository.ts:90-99`

```ts
async listRecent(prIds: string[]): Promise<PublishRecord[]> {
  const rows = await this.db
    .select()
    .from(t.publications)
    .where(inArray(t.publications.prId, prIds))   // ← жодного workspaceId
    .orderBy(desc(t.publications.createdAt))
    .limit(200);
  return rows.map(toDto);
}
```

**Чому це проблема.** Skill, «New module checklist», п. 3: «`repository.ts` — the only place
that touches its tables; **every query scoped by `workspaceId`**». Решта методів у цьому ж
файлі скоуп тримають (`:46`, `:61`, `:68`, `:79-82`) — випадає рівно один, і саме той, що
приймає масив id ззовні. Достатньо, щоб викликач передав чужий `prId` — і повернуться
публікації іншого воркспейсу разом із `channel` та `external_id`.

Обтяжливо ще й те, що метод зараз, судячи з фікстури, ніким не викликається: тобто це
незавершений мертвий код, який вийде в мердж уже дірявим і буде виглядати як готовий до
вжитку API репозиторію.

**Як правильно.** Додати `workspaceId` першим параметром і в `and(...)`, як у сусідніх
методах:

```ts
async listRecent(workspaceId: string, prIds: string[], limit = RECENT_LIMIT) {
  ...
  .where(and(eq(t.publications.workspaceId, workspaceId), inArray(t.publications.prId, prIds)))
```

Якщо викликача немає — видалити метод до моменту, коли він знадобиться.

---

### B8. `sqlIncrement()` — заглушка, що робить лічильник спроб фікцією

**Файл/рядки:** `repository.ts:60` і `repository.ts:102-104`

```ts
.set({ status, error, attempts: sqlIncrement() })      // :60
...
function sqlIncrement() {
  return undefined as unknown as number;               // :102-104
}
```

**Чому це проблема.** Функція не інкрементує нічого — вона повертає `undefined`, замаскований
під `number` подвійним кастом. У Drizzle `.set({ attempts: undefined })` просто **не включає**
колонку в `UPDATE`. Тобто `attempts` назавжди лишається початковим значенням, а подвійний каст
існує рівно для того, щоб компілятор про це не сказав.

Наслідок разом із B2: рядок зі статусом `'retryable'` не має жодного лічильника, а
`retryFailed` (`service.ts:77-100`) ніде не звіряється з межею спроб. Кожен виклик
`POST /publications/retry` знову бере всі `retryable`-рядки і знову шле їх у Slack. При
стабільній помилці (протухлий токен, видалений канал, rate limit) це нескінченний цикл
доставок без верхньої межі — рівно те, від чого лічильник спроб мав захищати.

**Як правильно** — інкремент на боці SQL:

```ts
import { sql } from 'drizzle-orm';
.set({ status, error, attempts: sql`${t.publications.attempts} + 1` })
```

і фільтр по межі в `listRetryable`:

```ts
.where(and(
  eq(t.publications.workspaceId, workspaceId),
  eq(t.publications.status, 'retryable'),
  lt(t.publications.attempts, PUBLISH_RETRY_LIMIT),
))
```

Окремо: `as unknown as number` — це саме той шаблон, який ховає баг від CI. Якщо потрібен
тимчасовий заглушений код — краще `throw new Error('not implemented')`, він падає гучно.

---

### B9. `retryFailed` шле в Slack і ті рядки, у яких `target === 'markdown'`

**Файл/рядки:** `service.ts:81-97`, ключовий рядок `service.ts:90`

```ts
for (const row of rows) {
  ...
  const result = await this.deliverToSlack(review, pull.title, row.channel ?? undefined);
```

**Чому це проблема.** `publish` (`service.ts:64-67`) чесно розгалужується по `target`:
`'slack'` → `deliverToSlack`, інакше → `renderMarkdown`. `retryFailed` цю розгалуженість
губить і безумовно йде в Slack, хоча `row.target` доступний прямо тут, а
`SUPPORTED_TARGETS` (`constants.ts`) явно допускає більш ніж одне значення.

Наслідки два, обидва погані: markdown-публікація, яка колись впала, при ретраї піде
повідомленням у Slack-канал (`row.channel` для неї, найімовірніше, `null` → підставиться
дефолтний канал із конфігу — тобто чужий канал отримає чужий контент); а якщо Slack не
налаштований, `deliverToSlack` кине 409 `SLACK_NOT_CONFIGURED_CODE` і markdown-рядок
позначиться `'failed'` через відсутність інтеграції, до якої він не мав стосунку.

**Як правильно.** Винести вибір транспорту в приватний метод і викликати його з обох шляхів:

```ts
private deliver(target: PublishTarget, review: ReviewRecord, title: string, channel?: string) {
  return target === 'slack'
    ? this.deliverToSlack(review, title, channel)
    : Promise.resolve({ externalId: null, body: renderMarkdown(review, title) });
}
```

Тоді `publish` і `retryFailed` не можуть розійтися. Зверніть увагу, що тест
`publisher.it.test.ts:54-63` перевіряє ретрай лише для `'slack'` — саме тому баг не видно.

---

## Суттєві зауваження

### S1. Роути не декларують `response`-схеми

**Файл/рядки:** `routes.ts:19`, `routes.ts:24-26`, `routes.ts:34`

Skill, «Validation at the edge»: «One Zod schema drives request validation **and** response
serialization». У репозиторії це оформлено як явна конвенція — див. докблок у
`server/src/modules/_shared/schemas.ts`:

> «Declaring `schema.response[200]` is not decoration: the serializer validates what leaves
> the process, so a handler that starts returning a raw Drizzle row (with `workspaceId`,
> internal timestamps, …) fails loudly instead of silently widening the public API.»

Ризик тут не гіпотетичний: усі три хендлери повертають напряму те, що віддав сервіс, а
сервіс — те, що віддав `toDto` (`repository.ts:106-119`). Варто комусь додати поле в
`toDto` — і воно мовчки поїде в публічний API. `response`-схема це ловить.

Модулі `brief`, `blast`, `onboarding`, `smart-diff` уже так роблять — беріть за взірець.

```ts
app.get('/pulls/:id/publications',
  { schema: { params: IdParams, response: { 200: z.array(PublishRecord) } } },
  ...
);
```

### S2. `POST /publications/retry` без схеми і без обмеження

**Файл/рядок:** `routes.ts:34-38`

Роут не має ані `body`, ані `response`-схеми, ані `config.rateLimit`. Це ендпойнт, який
запускає N зовнішніх HTTP-викликів у Slack і не є ідемпотентним — його подвійний клік
означає подвійну доставку. Порівняйте з `POST /settings/test-connection`
(`settings/routes.ts:73-75`), де саме через зовнішній виклик стоїть
`config: { rateLimit: { max: 20, timeWindow: '1 minute' } }`.

Як мінімум — `response: { 200: z.object({ sent: z.number().int() }) }` і rate limit.

### S3. Non-null assertion там, де рядка може не бути

**Файл/рядки:** `repository.ts:29` (`toDto(inserted!)`), `repository.ts:49` (`toDto(row!)`)

`markDelivered` фільтрує по `workspaceId AND id` (`:46`). Якщо id належить іншому воркспейсу
(або рядок уже видалено), `.returning()` віддасть порожній масив, і `row!` вилетить
`TypeError: Cannot read properties of undefined` → 500 замість 404. Skill, «Validation at the
edge»: «Throw `AppError` (or a subclass: `NotFoundError`, `ConfigError`) for anything with a
status».

```ts
if (!row) throw new NotFoundError('Publication not found');
```

Для `insertPending` `!` виправданіший (INSERT завжди повертає рядок), але тоді краще явний
коментар, ніж мовчазний `!`.

### S4. Валідація `target` продубльована в сервісі

**Файл/рядки:** `service.ts:45-47` проти `routes.ts:26` (`body: PublishRequest`)

Якщо `PublishRequest` описує `target` як `z.enum([...])` — а мав би, — то перевірка
`SUPPORTED_TARGETS.includes(target)` у сервісі недосяжна: невалідне значення 422-иться на
межі ще до хендлера. Skill: «Parse at the boundary; inside the rings the data is already
trusted».

Якщо ж `PublishRequest` описує `target` як вільний `z.string()` — то проблема інша й гірша:
парсинг стоїть не там, де треба. Перевірте контракт; правильна відповідь — enum у Zod-схемі
та `SUPPORTED_TARGETS` як джерело для цього enum, щоб два списки не розʼїхались.

### S5. `latestReview` покладається на порядок, якого репозиторій не обіцяє

**Файл/рядки:** `service.ts:131-134`

```ts
const reviews = await this.container.reviewRepo.listReviews(workspaceId, prId);
return reviews.find((r) => r.kind === 'review') ?? null;
```

Назва методу — `latestReview`, але «найсвіжість» тут забезпечується виключно тим, що
репозиторій *випадково* сортує за спаданням. Це неявна залежність між двома модулями: зміна
`ORDER BY` в `modules/reviews` мовчки почне публікувати старе ревʼю. Оскільки метод
`listReviews` усе одно доведеться створити або замінити (B6) — задайте порядок явно, або
поверніть із репозиторію одразу «останнє ревʼю виду `review`» окремим запитом.

### S6. Контракти `Publish*` і порт `SlackClient` — перевірити обидві копії `vendor/shared`

Ані `PublishRequest`/`PublishRecord`/`PublishTarget`/`PublishStatus`, ані `SlackClient`
зараз не існують у `server/src/vendor/shared/` (перевірено grep-ом по
`adapters.ts` і `contracts/`), ані в `client/src/vendor/shared/`. У фікстурі цих файлів
немає, тож перевірте на самій гілці:

- `SlackClient` — це **порт**; він належить у `server/src/vendor/shared/adapters.ts` і
  **не** дзеркалиться в клієнт (клієнту порт не потрібен);
- `PublishRecord` / `PublishRequest` / `PublishTarget` / `PublishStatus` — це **контракти,
  що перетинають дріт** (їх повертають роути `routes.ts:21`, `:30`). Skill і `AGENTS.md`:
  «`@devdigest/shared` exists twice … Edit the server copy, then mirror wire-crossing changes
  into the client copy — **never edit only one**».

Якщо клієнтську копію не оновлено — це окремий блокер; з фікстури це не видно.

### S7. Таблиця `publications` — потрібна нова міграція, і в ній колонка `attempts`

`repository.ts:24` і далі звертаються до `t.publications`, але в `server/src/db/schema/`
такої таблиці немає в жодному з файлів (`core`, `pulls`, `repos`, `reviews`, `runs`, `ops`,
`agents`, `context`, `knowledge`, `eval`, `ci`, `repo-intel`). Перевірте, що гілка додала:

- `server/src/db/schema/<файл>.ts` з `publications` (колонки, які використовує код:
  `id`, `workspaceId`, `prId`, `reviewId`, `target`, `channel`, `status`, `externalId`,
  `body`, `error`, `attempts`, `createdAt`, `deliveredAt`);
- **нову** міграцію в `server/src/db/migrations/` — наявні `.sql` вже застосовані й
  редагуванню не підлягають (`AGENTS.md`, «Do not touch»);
- індекс по `(workspace_id, status)` — `listRetryable` (`repository.ts:74-88`) фільтрує саме
  по цій парі;
- `attempts` з `.notNull().default(0)` — інакше правильний інкремент із B8
  (`attempts + 1`) на `NULL` дасть `NULL`.

Нагадування: міграції не застосовуються на буті — `cd server && pnpm db:migrate`.

### S8. Реєстрація модуля та відсутні у фікстурі файли

- `server/src/modules/index.ts` наразі не містить `publisher` (перевірено в репозиторії).
  Skill, чеклист п. 5: «One entry in `src/modules/index.ts`. Registration is static on
  purpose». Без цього запису роути просто не піднімуться, а `depcruise` дасть `no-orphans`
  (`.dependency-cruiser.cjs:43-46`: «Unreachable module — dead code, or a missing
  registration in modules/index.ts»).
- `service.ts:10` імпортує `./helpers.js` (`renderSlackBlocks`, `renderMarkdown`,
  `truncateForSlack`), `service.ts:11-16` — `./constants.js` (`MAX_BLOCKS_PER_MESSAGE`,
  `PUBLISH_RETRY_LIMIT`, `SLACK_NOT_CONFIGURED_CODE`, `SUPPORTED_TARGETS`). Обох файлів у
  фікстурі немає. Розподіл правильний за скілом (чисті трансформації в `helpers.ts`,
  літерали в `constants.ts`), але вміст не переглянутий — зокрема `renderSlackBlocks` варто
  перевірити на екранування та на те, що вона справді чиста (skill: «A pure function …
  needs no container at all»).
- `server/src/adapters/slack/slack.client.ts` — адаптер теж не переглянутий; перевірте, що
  він `implements SlackClient` і що нічого з `src/modules/` не імпортує
  (`infrastructure-points-inward`, `.dependency-cruiser.cjs:101-107`).

### S9. `PUBLISH_RETRY_LIMIT` використано як розмір сторінки, а не як межу спроб

**Файл/рядки:** `service.ts:78` → `repository.ts:74`, `:85`

```ts
const rows = await this.repo.listRetryable(workspaceId, PUBLISH_RETRY_LIMIT);
...
.limit(limit);
```

Назва константи каже «скільки разів повторювати одну доставку», а вжита вона як «скільки
рядків узяти за раз». Якщо `PUBLISH_RETRY_LIMIT === 3`, то `POST /publications/retry`
мовчки обробить лише три найсвіжіші рядки й поверне `sent: 3`, залишивши решту черги
невидимою для викликача — при тому, що жодного сигналу «є ще» відповідь не містить.

Розділіть на дві константи (`PUBLISH_RETRY_LIMIT` — межа спроб для B8, `RETRY_BATCH_SIZE` —
розмір пачки) і поверніть із роута щось на кшталт `{ sent, remaining }`.

---

## Дрібні зауваження

- `repository.ts:81` — `inArray(t.publications.status, ['retryable'])` з одним елементом;
  `eq(t.publications.status, 'retryable')` читабельніше і дешевше для планувальника.
- `repository.ts:96` — `.limit(200)` магічним числом усередині репозиторію; літерали за
  конвенцією живуть у `constants.ts`.
- `repository.ts:112`, `:116` — `row.target as PublishTarget` / `row.status as PublishStatus`:
  касти замість того, щоб задати `text('target', { enum: [...] })` у Drizzle-схемі, як це
  зроблено для `reviews.kind` (`server/src/db/schema/reviews.ts:20`). Тоді типи зійдуться самі.
- `service.ts:142-145` — `summarize` лежить у файлі сервісу як вільна функція. Вона чиста;
  за чеклистом скіла її місце — `helpers.ts`, поруч із рештою чистих трансформацій.
- `service.ts:136-139` — `isRetryable` вирішує долю рядка регуляркою по тексту помилки
  (`/ETIMEDOUT|ECONNRESET|fetch failed/`). Крихко: адаптер Slack мав би віддавати
  типізовану помилку (`ExternalServiceError` вже є в `platform/errors.ts:33`), а сервіс —
  дивитися на її тип, а не на текст. Плюс `429` (rate limit) тут ловиться лише через
  строковий код `'slack_rate_limited'` — переконайтеся, що адаптер його справді ставить.
- `container.excerpt.ts:77` — `this.config.slackDefaultChannel`: поля немає в поточному
  `AppConfig` (`server/src/platform/config.ts:52+`), тож гілка його додає. Це нормально —
  канал не секрет, а конфіг; головне не додати сам токен у `AppConfig` (докблок
  `config.ts:5-13` це прямо забороняє: секрети йдуть тільки через `SecretsProvider`).
- `publisher.it.test.ts:44-52` — тест «leaves a retryable row» перевіряє `history[0]`, тобто
  спирається на порядок сортування репозиторію. Надійніше шукати рядок за `id`, який
  повернув `publish`.

---

## Що зроблено правильно (щоб не зламали при виправленні)

Перелічую свідомо — кілька з цих рішень легко зіпсувати, поспішаючи з правками вище.

- **Роут — це транспорт.** `routes.ts:15-39`: `getContext` → сервіс → серіалізація, жодного
  Drizzle. `routes-through-service` (`.dependency-cruiser.cjs:52-58`) чистий.
- **Сервіс бере resolved values, не `FastifyRequest`.** `service.ts:39-44`, `:77`, `:102` —
  `workspaceId`, `prId`, `target`, `channel` як аргументи. Такий сервіс викличеться з джоби
  чи CLI без HTTP; `service-stays-http-agnostic` чистий.
- **Крос-модульний доступ через контейнер.** `service.ts:49`, `:82`, `:83`, `:132` ходять у
  `this.container.reviewRepo`, а не імпортують `modules/reviews/repository.js`. Це саме те,
  для чого існує геттер `reviewRepo` (`container.ts:110-112`), і саме це рятує від
  `no-cross-module-internals`. Підписи методів — окрема історія (B6), але напрямок правильний.
- **Сервіс будує свій репозиторій із `container.db`.** `service.ts:35-37` — рівно шаблон
  `modules/repos/service.ts`, на який посилається skill.
- **Ледачий `slack()` із `ConfigError`.** `container.excerpt.ts:73-79` не падає на буті, коли
  токена немає; докблок `:68-72` це пояснює. Правильно й добре задокументовано — бракує лише
  `overrides` та інвалідизації.
- **Ledger-first запис доставки.** `service.ts:55-61` пише `pending` до спроби, `:69`/`:72`
  оновлює після. Докблок `:26-30` пояснює, чому «можливо надіслано» і «точно не надіслано» —
  різні стани. Це саме та логіка, яка виправдовує існування сервісного шару.
- **Розділення pure/impure.** Рендеринг у `helpers.ts`, літерали в `constants.ts`, рішення в
  сервісі — структура модуля відповідає чеклисту скіла.

---

## Чекліст перед мерджем

1. `slack?: SlackClient` у `ContainerOverrides`, перевірка `overrides` першим рядком у
   `slack()`, `MockSlackClient` у `adapters/mocks.ts` **(B1)**.
2. `this._slack = undefined` у `invalidateSecretCaches()` + тест/рефактор, що робить
   пропуск наступного кешу неможливим **(B2)**.
3. Шлях запису `SLACK_BOT_TOKEN` через Settings — або чесний текст помилки **(B3)**.
4. Прибрати `vi.mock`, підміняти порт через `ContainerOverrides`; прибрати `as never` **(B4)**.
5. Перенести тест у `server/test/`, підключити `startPg`/`dockerAvailable` **(B5)**.
6. Привести виклики `reviewRepo` до реальних підписів **(B6)**.
7. `workspaceId` у `listRecent` — або видалити метод **(B7)**.
8. Справжній SQL-інкремент `attempts` + перевірка межі спроб **(B8)**.
9. `retryFailed` має шанувати `row.target` **(B9)**.
10. `publisher` у `src/modules/index.ts`; міграція для `publications`; контракти `Publish*`
    у **обох** копіях `vendor/shared` **(S6-S8)**.
11. Після правок:
    `node scripts/verify.mjs --slice backend` та
    `cd server && pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs`.
