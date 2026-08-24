# Ревʼю гілки `publisher` (модуль `server/src/modules/publisher` + правка платформи)

Скоуп: `container.excerpt.ts`, `mocks.excerpt.ts`, `routes.ts`, `service.ts`, `repository.ts`,
`publisher.it.test.ts` з `.claude/skills/onion-architecture/evals/fixtures/publisher-module/`.
Рядки вказані за файлами фікстури; у дужках — цільовий файл у репозиторії.

**Вердикт: мерджити не можна.** Чотири блокери (порушений seam порту `SlackClient`
+ невичищений кеш секрету) і пʼять функціональних дефектів, з яких два тихі
(не падають, а мовчки роблять не те).

---

## Блокери

### 1. `slack()` не перевіряє `overrides.slack` — порт неможливо підмінити

`container.excerpt.ts:73-79` (→ `server/src/platform/container.ts`)

```ts
async slack(): Promise<SlackClient> {
  if (this._slack) return this._slack;          // ← немає `if (this.overrides.slack) ...`
  const token = await this.secrets.get('SLACK_BOT_TOKEN');
  ...
}
```

Кожен інший стейтфул-геттер у контейнері починається з перевірки оверрайду —
`github()` (`container.excerpt.ts:60`), `llm()` (`:82`), `embedder()` (`:92`),
а в реальному файлі ще `git`, `codeIndex`, `repoIntel`, `projectContext`, `blast`,
`depgraph`, `tokenizer`. Тут її нема.

Чому це проблема: підміна адаптерів через `ContainerOverrides` — це єдиний
дозволений тестовий шов (SKILL.md, «Testing seams»). Геттер, який пропускає свою
перевірку `overrides.<x>`, компілюється, проходить `depcruise` і тихо робить порт
немокабельним — CI цього не бачить, бо це не імпорт, а пропущений рядок. Наслідок
видно одразу нижче, у пункті 4: тест мусив піти в обхід через `vi.mock`.

Як правильно:

```ts
async slack(): Promise<SlackClient> {
  if (this.overrides.slack) return this.overrides.slack;
  if (this._slack) return this._slack;
  const token = await this.secrets.get('SLACK_BOT_TOKEN');
  if (!token) throw new ConfigError('SLACK_BOT_TOKEN is not configured');
  this._slack = new SlackWebhookClient(token, this.config.slackDefaultChannel);
  return this._slack;
}
```

### 2. `ContainerOverrides` не має поля `slack`

`container.excerpt.ts:27-39` (→ `server/src/platform/container.ts`)

В інтерфейсі перелічені `secrets`, `auth`, `github`, `git`, `codeIndex`,
`embedder`, `llm`, `repoIntel`, `projectContext`, `blast` — нового порту нема.

Чому це проблема: навіть якщо виправити пункт 1, підставити мок буде нічим —
`new Container(config, db, { slack: ... })` не пройде типізацію. Це друга з
чотирьох обовʼязкових частин «нового порту» (SKILL.md, «Ports and adapters»:
інтерфейс → адаптер → лінивий геттер + запис у `ContainerOverrides` → мок).

Як правильно — поруч з іншими, з коментарем у тому ж стилі, що й сусіди:

```ts
/** Slack delivery (L06) — tests inject a mock SlackClient. */
slack?: SlackClient;
```

### 3. `invalidateSecretCaches()` не скидає `_slack` — ротований токен не підхоплюється

`container.excerpt.ts:106-110` (→ `server/src/platform/container.ts`)

```ts
invalidateSecretCaches(): void {
  this.llmCache.clear();
  this._github = undefined;
  this._embedder = undefined;
  // this._slack — забули
}
```

Гілка додала кешоване поле `_slack` (`container.excerpt.ts:49`), побудоване з
секрету `SLACK_BOT_TOKEN` (`:75-77`), але не додала його до списку скидання.

Чому це проблема — і чому це найдорожчий дефект у гілці. Список у
`invalidateSecretCaches()` — це **ручний перелік полів, а не обхід**. Його
викликає `server/src/modules/settings/routes.ts` одразу після
`container.secrets.set(...)` у `POST /settings/test-connection`. Тобто:
користувач вставляє новий Slack-токен, UI пише «збережено / OK», а процес до
самого рестарту продовжує ходити в Slack зі старим (можливо, відкликаним)
токеном. Це не стектрейс, це тікет у підтримку. Ані `depcruise`, ані `tsc` цього
не побачать: це пропуск у списку, а не імпорт.

Як правильно:

```ts
invalidateSecretCaches(): void {
  this.llmCache.clear();
  this._github = undefined;
  this._embedder = undefined;
  this._slack = undefined;
}
```

Супутнє, що треба зробити в тій самій гілці, інакше ротація Slack-токена через UI
взагалі не має шляху:

- `SECRET_KEY_BY_PROVIDER` у `server/src/modules/settings/constants.ts` не має
  запису для Slack — зараз токен нічим записати через `test-connection`, а отже й
  `invalidateSecretCaches()` для нього ніхто не викличе;
- `SecretKey` (`server/src/vendor/shared/adapters.ts:274`) варто розширити
  літералом `'SLACK_BOT_TOKEN'` — зараз він проходить лише через хвіст
  `(string & {})`, тобто без будь-якої перевірки друкарської помилки.

### 4. Немає `MockSlackClient` у `adapters/mocks.ts`, і тест мокає шлях модуля

`mocks.excerpt.ts:6-17` — у списку експортів є `MockLLMProvider`, `MockEmbedder`,
`MockGitHubClient`, `MockGitClient`, `MockCodeIndex`, `MockBlast`,
`MockAuthProvider`, `MockSecretsProvider`. Мока для `SlackClient` нема (файл
гілкою не змінювався).

Прямий наслідок — `publisher.it.test.ts:7-13`:

```ts
const postMessage = vi.fn(async () => ({ ts: '1712345678.000100' }));
vi.mock('../../adapters/slack/slack.client.js', () => ({
  SlackWebhookClient: class { postMessage = postMessage; },
}));
```

Чому це проблема:

- `vi.mock` шляху модуля привʼязує тест до **графа імпортів**, а не до порту:
  перейменували/перенесли `adapters/slack/slack.client.ts` — тест зелений, але
  мокає порожнечу і починає ходити в реальний Slack (SKILL.md, «Testing seams»;
  `examples.md` §9 наводить рівно цей антипатерн).
- Це також єдиний імпорт адаптера з-під `src/modules/**` у всьому дереві —
  напрям, який забороняє правило `no-direct-adapter-clients`
  (`server/.dependency-cruiser.cjs`). Те, що `vi.mock('…')` — виклик функції, а не
  `import`, і depcruise його не бачить, робить це гіршим, а не кращим: зелений CI
  тут нічого не гарантує.
- Четвертий крок «нового порту» пропущено, тож жоден інший тест (і жоден
  `test/*.it.test.ts`, який підіймає весь `buildApp`) не має чим підмінити Slack.

Як правильно — додати в `server/src/adapters/mocks.ts` у стилі сусідів
(записувати виклики в масив, щоб тест перевіряв аргументи, а не лічильник):

```ts
export class MockSlackClient implements SlackClient {
  readonly posted: Array<{ channel?: string; blocks: unknown[]; fallbackText: string }> = [];
  constructor(private behaviour: { fail?: Error } = {}) {}
  async postMessage(msg: { channel?: string; blocks: unknown[]; fallbackText: string }) {
    if (this.behaviour.fail) throw this.behaviour.fail;
    this.posted.push(msg);
    return { ts: '1712345678.000100' };
  }
}
```

і переписати підготовку тесту на шов, який архітектура вже дає:

```ts
const slack = new MockSlackClient();
container = new Container(loadConfig(), db, {
  slack,
  secrets: new MockSecretsProvider({ SLACK_BOT_TOKEN: 'xoxb-test' }),
});
```

Це заодно прибирає милицю `as never` у `publisher.it.test.ts:30` — обʼєкт
приводять до `never`, бо він не задовольняє `SecretsProvider`; готовий
`MockSecretsProvider` уже є в `mocks.ts:17`.

---

## Функціональні дефекти

### 5. `err.status` не існує — жодна 5xx-помилка Slack не потрапить у ретрай

`service.ts:137`

```ts
if (err instanceof AppError) return err.status >= 500 || err.code === 'slack_rate_limited';
```

`AppError` (`server/src/platform/errors.ts:9-19`) оголошує поле **`statusCode`**,
не `status`. Тобто `err.status` — `undefined`, `undefined >= 500` → `false`.

Чому це проблема: кожен `AppError` без коду `slack_rate_limited` (у т.ч. будь-яка
502/503 від Slack, обгорнута в `ExternalServiceError`) буде записаний як
`'failed'`, а не `'retryable'`, і `retryFailed` його ніколи не підбере. Це саме
той клас помилок, заради якого писався ретрай. Під `strict` це ще й має впасти на
`tsc` — якщо не впало, значить десь по дорозі загубилася типізація; варто
прогнати `node scripts/verify.mjs --slice backend`.

Як правильно: `err.statusCode >= 500`.

### 6. `attempts` ніколи не інкрементується — ретрай без верхньої межі

`repository.ts:60` і `repository.ts:102-104`

```ts
.set({ status, error, attempts: sqlIncrement() })
...
function sqlIncrement() {
  return undefined as unknown as number;
}
```

Drizzle викидає з `SET` поля зі значенням `undefined`, тож `attempts` назавжди
лишається початковим.

Чому це проблема: `PUBLISH_RETRY_LIMIT` використовується як **ліміт рядків** у
вибірці (`repository.ts:74-85`, `.limit(limit)`), а не як стеля спроб. Тобто
запис, який стабільно валиться (видалений канал, відкликаний токен, забанений
бот), лишається `retryable` вічно і б'є в Slack на кожен `POST
/publications/retry` — довічний хвіст мертвої доставки. Плюс колонка `attempts`
у таблиці існує, але завжди бреше, тож діагностувати це по БД теж не вийде.

Як правильно — справжній SQL-інкремент і відсів вичерпаних спроб:

```ts
import { sql } from 'drizzle-orm';
.set({ status, error, attempts: sql`${t.publications.attempts} + 1` })
```

```ts
.where(and(
  eq(t.publications.workspaceId, workspaceId),
  eq(t.publications.status, 'retryable'),
  lt(t.publications.attempts, PUBLISH_RETRY_LIMIT),
))
```

(`inArray(status, ['retryable'])` з одним елементом — це просто `eq`.)

### 7. `retryFailed` шле в Slack усе підряд, ігноруючи `row.target`

`service.ts:90`

```ts
const result = await this.deliverToSlack(review, pull.title, row.channel ?? undefined);
```

Чому це проблема: `publish` розрізняє таргети (`service.ts:64-67`), а ретрай — ні.
Запис із `target: 'markdown'`, який колись впав, при ретраї піде в Slack (у
дефолтний канал, бо `channel` для markdown завжди `null`) — тобто доставка не в
той канал і не тим способом, який просив користувач. `SUPPORTED_TARGETS` натякає,
що таргетів планується більше двох, тож дефект тільки зростатиме.

Як правильно: винести вибір способу доставки в один приватний метод
(`deliver(row.target, review, title, channel)`) і викликати його з обох місць —
`publish` і `retryFailed` не повинні мати двох різних уявлень про те, що означає
таргет.

### 8. `listRecent` не скоупиться по `workspaceId`

`repository.ts:90-99`

```ts
async listRecent(prIds: string[]): Promise<PublishRecord[]> {
  const rows = await this.db.select().from(t.publications)
    .where(inArray(t.publications.prId, prIds))
    ...
}
```

Чому це проблема: правило репозиторію — **кожен запит скоупиться по
`workspaceId`** (SKILL.md, «New module checklist», п.3). Усі інші методи цього ж
файлу його дотримуються; цей — ні. Достатньо одного виклику з `prId` іншого
воркспейсу (або з масиву, зібраного не з тієї вибірки), щоб віддати чужі
доставки. До того ж метод зараз ніде не викликається — тобто це мертвий код, у
який уже вбудована дірка міжтенантного читання.

Як правильно: або видалити його з гілки, або додати `eq(t.publications.workspaceId,
workspaceId)` першим аргументом `and(...)`, як у сусідніх методах. Ліміт `200`
теж варто зробити параметром, а не літералом усередині data-access.

### 9. Відрендерений markdown нікуди не доїжджає

`service.ts:67` пише `body: renderMarkdown(review, pull.title)` у БД, але
`toDto` (`repository.ts:106-119`) не мапить колонку `body` у `PublishRecord`.

Чому це проблема: `POST /pulls/:id/publications` з `target: 'markdown'` за описом
модуля (`service.ts:24-25`: «rendered Markdown blob the caller can paste
anywhere») має віддати текст клієнту. Зараз він повертає запис зі `status:
'delivered'`, `external_id: null` — і жодного markdown. Фіча формально
«працює», а результат недосяжний. Тест `publisher.it.test.ts:65-72` це пропускає,
бо перевіряє тільки статус і те, що Slack не смикали.

Як правильно: додати `body` у `PublishRecord` (канонічна копія
`server/src/vendor/shared`, потім віддзеркалити у `client/src/vendor/shared` — контракт
перетинає дріт) і в `toDto`; тест має асертити сам вміст.

### 10. «Остання» рецензія обирається без сортування

`service.ts:131-134`

```ts
const reviews = await this.container.reviewRepo.listReviews(workspaceId, prId);
return reviews.find((r) => r.kind === 'review') ?? null;
```

Чому це проблема: метод називається `latestReview`, але «найновіша» тут — це
просто перший елемент у порядку, який вирішив віддати чужий репозиторій. Без
`ORDER BY` Postgres не гарантує нічого; варто комусь додати індекс або змінити
запит у модулі `reviews` — і publisher почне публікувати торішню рецензію, мовчки.

Як правильно: або `listReviews` повертає впорядковано і це зафіксовано в його
контракті, або тут беруться дані через метод, який явно віддає останню
(`reviewRepo.latestReview(workspaceId, prId, 'review')`), а сортування живе в
SQL, а не у `find`.

---

## Розбіжності з платформою, які треба перевірити до мерджу

### 11. `container.reviewRepo` викликається методами, яких у ньому немає

`service.ts:82`, `service.ts:132`

```ts
await this.container.reviewRepo.getReview(workspaceId, row.reviewId);
await this.container.reviewRepo.listReviews(workspaceId, prId);
```

У `server/src/modules/reviews/repository.ts` на сьогодні: `getReview(reviewId)` —
**один** аргумент, без скоупу воркспейсу; `listReviews` не існує взагалі (є
`reviewsForPull(prId)`). Якщо гілка ці методи додає — їх нема в наданій вирізці, і
ревʼювати нема чого; якщо не додає — модуль не збереться.

Сам підхід правильний: брати чужі дані через репозиторій на контейнері, а не
імпортом `../reviews/repository.js` і не інлайновим запитом до `t.reviews` через
`container.db` — обидва варіанти зробили б чужу таблицю вашою (SKILL.md, «Blind
spots» §4). Але зміну треба показати в діффі: якщо `getReview` тепер приймає
`workspaceId`, це правка публічної поверхні, якою користуються інші модулі.
Заодно варто виправити те, що поточний `getReview(reviewId)` не скоупиться по
воркспейсу.

### 12. Порт `SlackClient` не показаний, реєстрація модуля — теж

- `SlackClient` імпортується з `@devdigest/shared` (`container.excerpt.ts:17`), але
  в `server/src/vendor/shared/adapters.ts` його зараз немає. Канонічна копія —
  серверна; якщо тип перетинає дріт, віддзеркалити у `client/src/vendor/shared`
  (AGENTS.md: правити обидві, не одну).
- `server/src/modules/index.ts` у вирізці відсутній. Без одного імпорту й одного
  запису в `modules` реєстр роутів не зареєструється взагалі — модуль стане
  сиротою (`no-orphans` у depcruise це помітить як warning, але 404 помітять
  раніше).
- Таблиці `publications` у `server/src/db/schema.ts` зараз немає. Вона має
  приїхати **новою** міграцією — уже застосовані `src/db/migrations/*.sql` не
  чіпаємо, і `pnpm db:migrate` вручну (на буті міграції не застосовуються).

---

## Роути та валідація

### 13. Немає `response`-схем

`routes.ts:19-38`

Обидва `/pulls/:id/publications` і `/publications/retry` оголошують `params`/`body`,
але не `response`. Конвенція репозиторію тут явна й записана в
`server/src/modules/_shared/schemas.ts:14-22`: `schema.response[200]` не
декорація — серіалізатор валідує те, що **виходить** із процесу, тож хендлер,
який почне повертати сирий рядок Drizzle (`workspaceId`, внутрішні таймстемпи),
падає голосно, а не тихо розширює публічний API. Живий приклад поруч —
`server/src/modules/brief/routes.ts:41-53`.

Як правильно:

```ts
{ schema: { params: IdParams, response: { 200: z.array(PublishRecord) } } }
{ schema: { params: IdParams, body: PublishRequest, response: { 200: PublishRecord } } }
{ schema: { response: { 200: z.object({ sent: z.number().int() }) } } }
```

### 14. Перевірка таргета продубльована в сервісі

`service.ts:45-47`

```ts
if (!SUPPORTED_TARGETS.includes(target)) {
  throw new AppError('unsupported_target', `Unknown publish target "${target}"`, 422);
}
```

Чому це проблема: валідація належить краю — `PublishRequest` на роуті
(`routes.ts:26`) має описувати `target` як `z.enum([...])`, і тоді невалідне
значення 422-иться **до** хендлера, а всередині кілець дані вже довірені
(SKILL.md, «Validation at the edge»). Якщо `PublishRequest` це вже робить —
код у сервісі недосяжний; якщо не робить — його треба виправити там, а не
дублювати перевірку на два рівні глибше (два джерела правди для одного enum
розʼїдуться).

Якщо перевірка все ж лишиться (напр. як захист для викликів із джоби), то це
`ValidationError` — готовий підклас із кодом `validation_error` і статусом 422
(`server/src/platform/errors.ts:26-30`), а не свіжий `AppError` з власним рядковим
кодом.

### 15. Дрібніші зауваження по краю

- `routes.ts:24-32`: `POST /pulls/:id/publications` робить зовнішній мережевий
  виклик. Прецедент репозиторію — вішати `config: { rateLimit: ... }` на такі
  роути (`brief/routes.ts:53`, `reviews/routes.ts:149-156`). Тут ліміту немає, і
  ретрай-роут (`routes.ts:34`) теж без нього, хоча він за один запит може
  відправити пачку повідомлень.
- `service.ts:110-119`: код `SLACK_NOT_CONFIGURED_CODE` — новий рядковий код для
  ситуації «ключ не налаштовано». У платформі для цього вже є
  `NO_PROVIDER_KEY_CODE` / `NoProviderKeyError`
  (`server/src/platform/errors.ts:44-62`), на який клієнт зав'язує блокування
  кнопок. Або перевикористати його, або свідомо задокументувати, чому Slack —
  окремий випадок, і додати новий код у клієнтську обробку.
- `routes.ts:20,28,35`: `getContext(app.container, req)` — сусідні модулі
  деструктурують `const { container } = app` один раз на плагін
  (`settings/routes.ts:28`, `brief/routes.ts:37`). Косметика.

---

## Тест

### 16. Розташування, відсутній Docker-gate і неіснуючий хелпер

`publisher.it.test.ts` (усі 73 рядки)

- **Розташування.** Судячи з імпортів (`../../../test/helpers/db.js`,
  `../../platform/container.js`), файл лежить у `src/modules/publisher/`. Усі 14
  наявних інтеграційних тестів живуть у `server/test/`. Лейни CI розʼїжджаються
  по глобу `*.it.test.ts` (`scripts/verify.mjs`, `.github/workflows/server-*.yml`),
  тож запуститися він запуститься — але потрапляє під дію правил depcruise для
  `^src/modules/`, що й дало пункт 4.
- **Немає Docker-gate.** `const db = makeDb()` на рівні модуля, без
  `dockerAvailable()` / `describe.skip`. Конвенція інтеграційного лейну —
  «self-skips without Docker» (`scripts/verify.mjs:31`), і всі наявні
  `*.it.test.ts` починаються з `const hasDocker = await dockerAvailable(); const d
  = hasDocker ? describe : describe.skip;` (напр. `test/reviews.it.test.ts:22-23`).
  У такому вигляді тест валить лейн на будь-якій машині без Docker замість того,
  щоб пропуститися.
- **`test/helpers/db.ts` не існує.** Наявні хелпери — `test/helpers/pg.ts`
  (`startPg`, `dockerAvailable`, `PgFixture`) і `test/helpers/runs.ts`. Функцій
  `makeDb`, `resetDb`, `seedWorkspace`, `seedPull`, `seedReview` немає ніде;
  наявні тести піднімають БД через `startPg()` + `seed()` із `src/db/seed.ts`.
  Якщо гілка додає новий хелпер — його теж треба показати й ревʼюнути (це нова
  спільна поверхня для всіх майбутніх тестів).

### 17. Покриття не бачить найдорожчого

Чотири кейси перевіряють щасливий шлях і один ретрай, але жоден не перевіряє те,
що в цій гілці найлегше зламати:

- ротацію токена: `secrets.set('SLACK_BOT_TOKEN', …)` → `invalidateSecretCaches()`
  → наступний `container.slack()` мусить побачити **новий** токен (пункт 3 — це
  саме той тест, який його б і зловив);
- вичерпання спроб: `attempts` росте, і після `PUBLISH_RETRY_LIMIT` рядок
  перестає підбиратися `listRetryable` (пункт 6);
- ретрай markdown-запису не має ходити в Slack (пункт 7);
- `AppError` зі `statusCode >= 500` має стати `retryable` (пункт 5); зараз
  `'fetch failed'` — це звичайний `Error`, який ловиться другою гілкою
  `isRetryable`, тому баг у першій гілці лишається невидимим.

---

## Що зроблено правильно

Щоб не потонуло серед зауважень: розшарування модуля відповідає onion —
`routes.ts` тільки парсить, дістає контекст і делегує; сервіс приймає розвʼязані
значення (`workspaceId`, `prId`, `target`), а не `FastifyRequest`; репозиторій —
єдине місце, що торкається `publications`; рендеринг винесений у чистий
`helpers.ts`, літерали — у `constants.ts`; чужі дані беруться через
`container.reviewRepo`, а не інлайновим запитом до `t.reviews`; `slack()` зроблено
лінивим і `async`, бо він читає секрет на момент resolve, а не на буті —
рівно як `github()` та `llm()`. Патерн «пишемо `pending` до спроби, оновлюємо
після» і коментар, який пояснює **чому** (краще рядок у `pending`, ніж жодного),
— саме те, що варто мати в такому модулі.

Основна вада гілки не в розшаруванні, а в тому, що новий порт додали на три
чверті: інтерфейс і адаптер є, а запис в `ContainerOverrides`, перевірка
оверрайду, мок і рядок в `invalidateSecretCaches()` — ні. Жодну з цих чотирьох
дірок не видно ні `tsc`, ні `depcruise`: усі вони — пропуски, а не імпорти.
