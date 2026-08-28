# Ревʼю гілки `publisher` — перед мерджем

Скоуп: `server/src/modules/publisher/{routes,service,repository}.ts`,
`server/src/modules/publisher/publisher.it.test.ts` та правка
`server/src/platform/container.ts`.

Матеріал: `.claude/skills/onion-architecture/evals/fixtures/publisher-module/`.
Номери рядків нижче — з файлів фікстури; для `container.excerpt.ts` та
`mocks.excerpt.ts` це вирізки з `server/src/platform/container.ts` і
`server/src/adapters/mocks.ts` відповідно.

**Вердикт: не мерджити.** Шар routes → service → repository розкладено правильно,
сервіс бере resolved-значення (`workspaceId`, `prId`), а не `FastifyRequest`,
крос-модульних імпортів немає (дані reviews беруться через `container.reviewRepo`).
Але новий порт `SlackClient` заведено наполовину: шов для тестів зламано, кеш
секрету не інвалідовується, і гілка в поточному вигляді не компілюється.

Окремо зверну увагу: **жодну з проблем 1–5 і 10–12 `depcruise` не побачить.**
Це не імпорти, це пропуски в списках і в сигнатурах. Зелений CI тут нічого не
доводить.

---

## Блокери — порт `SlackClient` заведено неповно

### 1. `container.slack()` не перевіряє `overrides.slack` — порт неможливо підмінити

**Файл:** `server/src/platform/container.ts` (`container.excerpt.ts:73–79`)

```ts
async slack(): Promise<SlackClient> {
  if (this._slack) return this._slack;          // ← override не перевіряється
  const token = await this.secrets.get('SLACK_BOT_TOKEN');
  ...
}
```

**Чому проблема.** Кожен інший резолвер у цьому ж файлі починається з overrides:
`github()` (`:60`), `llm()` (`:82`), `embedder()` (`:92`), і в реальному
`container.ts` так само `git`, `codeIndex`, `repoIntel`, `projectContext`,
`blast`. Тут цей рядок просто відсутній. Це не стиль — це єдина причина, чому
працює підстановка з `adapters/mocks.ts`. Гетер, що пропускає свою перевірку
`overrides.<x>`, компілюється, проходить depcruise і тихо робить порт
немокабельним. Наслідок видно одразу нижче, у пункті 5: тест мусив піти в
`vi.mock` файлу адаптера, бо іншого входу йому не лишили.

**Як правильно.**

```ts
async slack(): Promise<SlackClient> {
  if (this.overrides.slack) return this.overrides.slack;
  if (this._slack) return this._slack;
  ...
}
```

### 2. `_slack` не скидається в `invalidateSecretCaches()` — ротація токена не діє

**Файл:** `server/src/platform/container.ts` (`container.excerpt.ts:106–110`,
кеш оголошено на `:49`, заповнюється на `:77`)

```ts
invalidateSecretCaches(): void {
  this.llmCache.clear();
  this._github = undefined;
  this._embedder = undefined;
  // _slack тут немає
}
```

**Чому проблема.** Це найдорожча помилка гілки. Метод — не sweep, а **захардкоджений
перелік полів**, який чиститься руками; його викликає
`server/src/modules/settings/routes.ts:84` після того, як користувач зберіг новий
ключ. Кешований у `_slack` клієнт побудований з `SLACK_BOT_TOKEN`, отже після
ротації токена процес до рестарту продовжить ходити відкликаним. Це не падіння
зі стектрейсом, а тікет у підтримку: користувач вставляє робочий токен, UI
підтверджує «збережено», публікації далі валяться з 401, і нічого в логах не
вказує на кеш. Ні typecheck, ні depcruise, ні тест цього не бачать — пропуск у
списку не є імпортом.

**Як правильно.** Додати `this._slack = undefined;` у `invalidateSecretCaches()`.
Правило просте: **будь-який кешований гетер, побудований зі значення
`SecretsProvider`, має два місця — сам гетер і цей метод.** Варто прикрити це
тестом на самому контейнері: `slack()` → `invalidateSecretCaches()` → `slack()`
має двічі покликати `secrets.get`.

### 3. `SLACK_BOT_TOKEN` ніде не зареєстровано як секрет — ротувати його нема де

**Файл:** `server/src/platform/container.ts` (`container.excerpt.ts:75`),
`server/src/vendor/shared/adapters.ts:274–279`,
`server/src/modules/settings/constants.ts:11–12`

**Чому проблема.** `SecretKey` — union з `(string & {})` на кінці, тому
`secrets.get('SLACK_BOT_TOKEN')` компілюється, але ключ не входить ні в перелік
`SecretKey`, ні в `SECRET_KEY_BY_PROVIDER`, через який `POST
/settings/test-connection` записує BYO-ключі. Тобто ввести або замінити токен
через UI неможливо в принципі — а сервіс при цьому кидає повідомлення «add one in
Settings to publish to Slack» (`service.ts:112–116`), яке відсилає користувача на
екран без такого поля. Пункт 2 у цьому світлі ще гірший: ротація не працює навіть
не через кеш, а тому що ротувати ніде.

**Як правильно.** Додати `'SLACK_BOT_TOKEN'` у `SecretKey` (канонічна серверна
копія `vendor/shared`, потім дзеркалити в `client/src/vendor/shared`), завести
`slack` у `SECRET_KEY_BY_PROVIDER` і поле в налаштуваннях.

### 4. З чотирьох кроків нового порту зроблено півтора

**Файли:** `container.excerpt.ts:17` (імпорт типу), `:27–39` (`ContainerOverrides`),
`mocks.excerpt.ts` (весь)

Чек-лист нового порту — інтерфейс у `vendor/shared`, адаптер у `adapters/`,
lazy-гетер **плюс запис у `ContainerOverrides`**, мок у `adapters/mocks.ts`.
Стан гілки:

| Крок | Стан |
|---|---|
| `interface SlackClient` у `server/src/vendor/shared/adapters.ts` | **немає** — імпортується з `@devdigest/shared` (`container.excerpt.ts:17`), але у файлі його не існує; гілка не типчекнеться |
| `server/src/adapters/slack/slack.client.ts` (`SlackWebhookClient`) | у гілці не бачу (імпорт на `container.excerpt.ts:24`) |
| `slack?: SlackClient` у `ContainerOverrides` (`:27–39`) | **немає** |
| `MockSlackClient` у `adapters/mocks.ts` | **немає** (див. `mocks.excerpt.ts` — 12 експортів, жодного slack) |

**Чому проблема.** Пропуск будь-якого з чотирьох ламає шов. Тут пропущено три, і
пункти 1 та 5 — прямий наслідок. Якщо `SlackClient` (або `PublishRecord`)
перетинає дріт до клієнта — віддзеркалити в `client/src/vendor/shared`, інакше
копії розʼїдуться.

### 5. Тест мокає шлях модуля замість того, щоб підмінити порт

**Файл:** `server/src/modules/publisher/publisher.it.test.ts:9–13`, `:26–30`

```ts
vi.mock('../../adapters/slack/slack.client.js', () => ({
  SlackWebhookClient: class { postMessage = postMessage; },
}));
```

**Чому проблема.** Це буквально анти-приклад із `examples.md` §9. `vi.mock`
привʼязує тест до графа імпортів: перейменують файл адаптера — тест мовчки
почне ганяти справжній клієнт у мережу. `ContainerOverrides` привʼязує до порту,
а порт не рухається. Плюс `secrets: { get: … } as never` (`:27–30`) — `as never`
глушить типізацію замість того, щоб узяти готовий `MockSecretsProvider`, який уже
є в `adapters/mocks.ts`.

**Як правильно** (після виправлення 1 і 4):

```ts
const slack = new MockSlackClient();
container = new Container(loadConfig(), db, {
  slack,
  secrets: new MockSecretsProvider({ SLACK_BOT_TOKEN: 'xoxb-test' }),
});
```

---

## Блокери — помилки, які не про архітектуру, але не пускають у мердж

### 6. `err.status` на `AppError` не існує — ретраї 5xx мертві

**Файл:** `server/src/modules/publisher/service.ts:137`

```ts
if (err instanceof AppError) return err.status >= 500 || err.code === 'slack_rate_limited';
```

У `server/src/platform/errors.ts:10–18` поле зветься **`statusCode`**, не
`status`. `undefined >= 500` → `false`, отже для будь-якої `AppError` умова
зводиться до `code === 'slack_rate_limited'`. Slack віддав 502/503 → рядок
позначається `failed`, а не `retryable`, і `retryFailed` його вже не підбере.
Fix: `err.statusCode >= 500`. Заразом: для збоїв зовнішнього сервісу в таксономії
вже є `ExternalServiceError` (502) — краще кидати її, ніж голу `AppError`.

### 7. `sqlIncrement()` — заглушка, `attempts` не інкрементиться ніколи

**Файл:** `server/src/modules/publisher/repository.ts:60`, `:102–104`

```ts
function sqlIncrement() {
  return undefined as unknown as number;
}
```

`undefined` у `.set()` означає, що Drizzle просто не покладе колонку в UPDATE.
`attempts` вічно нуль. Приведення через `as unknown as number` тут глушить
рівно ту помилку, яку компілятор мав показати. Fix:

```ts
.set({ status, error, attempts: sql`${t.publications.attempts} + 1` })
```

### 8. `retryFailed` ніколи не дивиться на `attempts` — нескінченний цикл ретраїв

**Файл:** `server/src/modules/publisher/service.ts:77–100`,
`repository.ts:74–88`

`PUBLISH_RETRY_LIMIT` передається в `listRetryable(workspaceId, limit)` як
SQL-`limit`, тобто це **розмір батчу**, а не ліміт спроб — попри назву. Разом із
пунктом 7 рядок, що падає стабільно (напр. видалений канал), лишається
`retryable` назавжди і б'є в Slack на кожен виклик `POST /publications/retry`.
Fix: фільтрувати `attempts < PUBLISH_RETRY_LIMIT` у `listRetryable`, а після
досягнення межі переводити в `failed`; batch size винести окремою константою.

### 9. `retryFailed` завжди йде в Slack, ігноруючи `row.target`

**Файл:** `server/src/modules/publisher/service.ts:90`

```ts
const result = await this.deliverToSlack(review, pull.title, row.channel ?? undefined);
```

`listRetryable` (`repository.ts:74–88`) фільтрує лише за статусом, не за target.
Рядок з `target: 'markdown'`, що потрапив у `retryable`, буде відправлений постом
у Slack — або впаде на відсутньому токені й запише безглузду помилку. Fix:
винести диспатч по `target` у приватний метод і кликати його з обох місць
(`publish` і `retryFailed`), щоб гілки не розʼїжджалися.

### 10. `toDto` губить `body` — markdown-публікація повертає порожнечу

**Файл:** `server/src/modules/publisher/repository.ts:106–119`

Для `target: 'markdown'` уся корисна навантага — це `body` (`service.ts:67`,
`renderMarkdown(...)`). Він пишеться в БД (`markDelivered`, `:37–49`), але в
`toDto` не мапиться. `POST /pulls/:id/publications` з markdown віддає
`status: 'delivered'`, `external_id: null` і нічого, що можна вставити. Тест на
`publisher.it.test.ts:65–72` перевіряє лише статус, тому дірку не ловить —
його треба доповнити перевіркою `record.body`.

### 11. `container.reviewRepo` викликається з сигнатурами, яких немає

**Файл:** `server/src/modules/publisher/service.ts:82`, `:132`

- `getReview(workspaceId, row.reviewId)` — у
  `server/src/modules/reviews/repository.ts:69–71` це `getReview(reviewId)`,
  **один** аргумент;
- `listReviews(workspaceId, prId)` — такого методу немає взагалі; найближче
  `reviewsForPull(prId)` (`:64–66`), і вона повертає
  `{ review, findings }[]`, а не `ReviewRecord[]`.

Гілка не компілюється. Напрямок сам по собі правильний (брати чужі дані з
контейнера, а не імпортувати `../reviews/repository.js`) — але якщо потрібного
методу на контейнерному репозиторії немає, то саме його додати й треба, а не
підганяти виклик.

Дві супутні речі, коли будете виправляти:

- `reviewsForPull(prId)` **не скоупить workspace** (скоуп там enforced через PR).
  `publish` уже перевірив PR через `getPull(workspaceId, prId)` (`service.ts:49`),
  тож у `publish` це коректно; у `retryFailed` (`:82`) `reviewId` приходить із
  рядка `publications` — там скоуп треба перевірити явно.
- `latestReview` (`service.ts:131–134`) через `reviews.find(r => r.kind === 'review')`
  мовчки покладається на порядок сортування чужого репозиторію. «Найновіший»
  має бути явним (`orderBy created_at desc` + `[0]`), інакше зміна сортування в
  `reviews` тихо змінить, що саме публікується.

### 12. `listRecent(prIds)` без `workspaceId` — крос-воркспейсний витік

**Файл:** `server/src/modules/publisher/repository.ts:90–99`

Єдиний метод репозиторію без скоупу воркспейса, з захардкодженим `.limit(200)`.
Правило репозиторію: **кожен запит скоупиться `workspaceId`**. Зараз будь-хто,
хто знає чужий `prId`, дістане чужі доставки. До того ж метод, схоже, нізвідки не
викликається — якщо він не потрібен, найпростіший фікс це видалити його.

---

## Середні

### 13. Модуль не зареєстровано

**Файл:** `server/src/modules/index.ts`

Немає ні `import publisher from './publisher/routes.js'`, ні запису в `modules`.
Роутів просто не існуватиме в застосунку. Реєстрація тут статична навмисне —
динамічний `import()` `.ts` не переносний між tsx, бандлером і vitest.
`no-orphans` це помітить, але з `severity: 'warn'`, тобто CI не впаде.

### 14. Немає таблиці, міграції та контрактів

- `publications` немає в `server/src/db/schema.ts`, нової міграції в
  `server/src/db/migrations/` теж (нагадаю: застосовані `.sql` не редагуються —
  додається нова);
- `PublishRequest`, `PublishRecord`, `PublishTarget`, `PublishStatus` немає в
  `server/src/vendor/shared/` (ані в client-копії), хоча імпортуються з
  `@devdigest/shared` у `routes.ts:3`, `service.ts:1–6`, `repository.ts:2`;
- `config.slackDefaultChannel` (`container.excerpt.ts:77`) у
  `server/src/platform/config.ts` відсутній.

Або їх забули покласти в гілку, або excerpt їх приховує — але в тому вигляді, що
є, ні `pnpm db:migrate`, ні typecheck не пройдуть. Перевірити перед мерджем:
`node scripts/verify.mjs --slice backend`.

### 15. `helpers.ts` і `constants.ts` не входять у гілку

`service.ts:10–16` імпортує `renderSlackBlocks`, `renderMarkdown`,
`truncateForSlack`, `MAX_BLOCKS_PER_MESSAGE`, `PUBLISH_RETRY_LIMIT`,
`SLACK_NOT_CONFIGURED_CODE`, `SUPPORTED_TARGETS` — самих файлів серед файлів
модуля немає. Розкладка при цьому правильна (рендер — чистий, у `helpers.ts`;
`constants.ts`/`types.ts` — публічна поверхня модуля), просто файли треба
докласти.

### 16. Тест лежить не там і не має Docker-гейта

**Файл:** `server/src/modules/publisher/publisher.it.test.ts`

- Ім'я `*.it.test.ts` — правильне, лейни діляться саме по цьому глобу
  (`scripts/verify.mjs:117` і `:131`), і `vitest.config.ts` включає
  `src/**/*.test.ts`, тож файл підхопиться. Але всі 14 інших `*.it.test.ts`
  лежать у `server/test/` — тримайте конвенцію.
- **Немає Docker-гейта.** Порівняйте з `server/test/blast.it.test.ts:21–22`:
  `const hasDocker = await dockerAvailable(); const d = hasDocker ? describe :
  describe.skip;`. Інтеграційний лейн має самоскіпатись без Docker
  (`scripts/verify.mjs:31`), інакше він падатиме там, де мав мовчати.
- **`test/helpers/db.js` не існує** (`:2`). У `server/test/helpers/` є лише
  `pg.ts` (`startPg`, `dockerAvailable`, `PgFixture`) і `runs.ts`. Ні `makeDb`,
  ні `resetDb`, ні `seedWorkspace/seedPull/seedReview` в репозиторії немає — або
  їх треба додати в гілці, або переписати сетап під `startPg`.

---

## Дрібні

### 17. Немає response-схем

**Файл:** `server/src/modules/publisher/routes.ts:19`, `:24`, `:34`

Одна Zod-схема має живити і валідацію запиту, і серіалізацію відповіді. Тут є
`params`/`body`, але немає `response` — тобто відповідь не серіалізується
контрактом, і зайві поля рядка БД можуть просочитися назовні.
`POST /publications/retry` (`:34`) не має схеми взагалі, хоча повертає `{ sent }`.

### 18. `inArray` на одному значенні

**Файл:** `server/src/modules/publisher/repository.ts:81–82` —
`inArray(t.publications.status, ['retryable'])` це просто `eq(...)`.

### 19. `POST /publications/retry` без rate-limit

**Файл:** `server/src/modules/publisher/routes.ts:34`

Ендпоінт у циклі стукає в зовнішню мережу без обмежень. Поруч є взірець:
`server/src/modules/settings/routes.ts:71` — `config: { rateLimit: { max: 20,
timeWindow: '1 minute' } }`.

---

## Що в гілці зроблено правильно

Щоб не читалося як суцільний розгром — межі, які depcruise таки перевіряє,
дотримані:

- `routes.ts` не торкається Drizzle і делегує в сервіс (`routes-through-service`);
- сервіс і репозиторій не знають про Fastify, беруть `workspaceId`/`prId`/`target`
  як значення, а не `FastifyRequest` (`service-stays-http-agnostic`) — сервіс
  можна викликати з джоби;
- модуль не імпортує нічого з `../reviews/`, а бере `container.reviewRepo`
  (`no-cross-module-internals`);
- валідація на краю, `IdParams`/`PublishRequest` через `schema`, без
  ручного `Schema.parse(req.body)` у хендлері;
- сервіс кидає доменні помилки (`NotFoundError`, `AppError` з 422/409), а роут їх
  руками не мапить;
- рендер винесено в чисті функції `helpers.ts`;
- рішення писати рядок `pending` **до** спроби доставки (`service.ts:55–61`)
  задокументоване й правильне.

Тобто структурно модуль онійний. Ламається він рівно там, де конфіг сліпий:
у неповному заведенні порту (1–5) і в списку інвалідації кешу секрету (2).
