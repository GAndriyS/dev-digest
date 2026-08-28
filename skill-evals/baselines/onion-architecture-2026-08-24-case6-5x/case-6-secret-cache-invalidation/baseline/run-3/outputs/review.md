# Ревʼю гілки `publisher` — модуль `server/src/modules/publisher`

Скоуп: `routes.ts`, `service.ts`, `repository.ts`, `publisher.it.test.ts` +
правка платформи (`server/src/platform/container.ts`). Перевірено проти
`onion-architecture` та реального стану репозиторію на `main`.

Шляхи в заголовках знахідок — цільові шляхи гілки; рядки відповідають файлам
у `.claude/skills/onion-architecture/evals/fixtures/publisher-module/`.

**Вердикт: не мерджити.** Гілка не пройде `tsc` (п. 5, 6), ламає seam для
підміни адаптера (п. 1, 3, 4) і містить баг з кешем секрету, який робить
UX-підказку самого модуля неправдивою (п. 2).

---

## Блокери

### 1. `container.ts:73-79` — `slack()` не перевіряє `overrides`, і в `ContainerOverrides` немає `slack`

```ts
async slack(): Promise<SlackClient> {
  if (this._slack) return this._slack;          // ← немає overrides-гілки
  const token = await this.secrets.get('SLACK_BOT_TOKEN');
```

Порівняйте з `github()` на рядку 59-66 — там `if (this.overrides.github) return
this.overrides.github;` стоїть **першим**, до перевірки кешу, саме щоб тест
вигравав у закешованого клієнта. У `slack()` цієї гілки немає, а в
`ContainerOverrides` (рядки 27-39) немає поля `slack?: SlackClient`.

Чому це проблема: правило порту в скілі вимагає **чотирьох** кроків — інтерфейс
у `vendor/shared`, адаптер у `adapters/`, лінивий геттер + запис у
`ContainerOverrides`, мок у `adapters/mocks.ts`. Тут пропущено половину
третього і весь четвертий. Наслідок не косметичний: підмінити Slack через
контейнер неможливо, і саме тому тест звалився на `vi.mock` (п. 4). Це причина,
а не збіг — виправлення п. 1 автоматично розблоковує п. 4.

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

### 2. `container.ts:106-110` — `invalidateSecretCaches()` не скидає `_slack`

```ts
invalidateSecretCaches(): void {
  this.llmCache.clear();
  this._github = undefined;
  this._embedder = undefined;
  // this._slack — забули
}
```

Гілка додала нове поле `_slack` (рядок 49), що кешує клієнт, побудований з
секрету (рядок 77), але не додала його в метод, чия єдина робота — скинути
кеші після зміни секрету. Метод не декоративний: він викликається з
`server/src/modules/settings/routes.ts:84` одразу після персисту секрету.

Чому це проблема, і чому вона гірша, ніж виглядає. Перше збереження токена
працює: без токена `slack()` кидає `ConfigError` до присвоєння `_slack`, тож
кеш лишається порожнім. Ламається саме **ротація**: користувач вводить
протухлий/помилковий `SLACK_BOT_TOKEN`, публікація падає з 401 від Slack —
але клієнт уже закешований у `_slack`. Користувач іде в Settings, вводить
правильний токен, `invalidateSecretCaches()` відпрацьовує, і `_slack` як був,
так і лишається зі старим токеном — до рестарту процесу.

І замикає коло `service.ts:112-117`: модуль сам показує користувачу
`'No Slack token configured — add one in Settings to publish to Slack.'` —
тобто UX веде рівно в той шлях, який ця гілка щойно поламала. Симптом ззовні
виглядає як «я ввів правильний токен, а воно каже, що токен неправильний»,
і ніщо в коді публікації на кеш контейнера не вказує — діагностика дорога.

Як правильно — один рядок:

```ts
invalidateSecretCaches(): void {
  this.llmCache.clear();
  this._github = undefined;
  this._embedder = undefined;
  this._slack = undefined;
}
```

І правило на майбутнє, яке варто зафіксувати коментарем біля методу: **кожне
нове ліниве поле `_x`, що будується з секрету, зобовʼязане зʼявитись і тут**.
Зараз звʼязок між «додав async-геттер із `secrets.get`» і «додай рядок в
invalidateSecretCaches» тримається лише на памʼяті автора; наступний порт із
секретом наступить на ті самі граблі. Дешевший структурний варіант — тримати
кеші адаптерів у `Map<string, unknown>` (як уже зроблено для `llmCache`) і
чистити мапу цілком, тоді забути фізично нема що.

### 3. `adapters/mocks.ts` — немає `MockSlackClient`

`mocks.excerpt.ts` (рядки 6-17) перелічує 12 експортів: LLM, Embedder, GitHub,
Git, CodeIndex, Blast, Auth, Secrets. Slack серед них немає, і файл гілкою не
змінювався.

Це четвертий, пропущений крок чекліста порту. Без мока навіть після фікса п. 1
тестам нема чим заповнювати `overrides.slack` — доведеться писати анонімний
обʼєкт з кастом у кожному файлі.

Як правильно — за зразком `MockNotifier` зі скіла: клас, що імплементує
`SlackClient`, і публічне поле-журнал, за яким тест перевіряє відправлене:

```ts
export class MockSlackClient implements SlackClient {
  readonly posted: Array<{ channel?: string; blocks: unknown[]; fallbackText: string }> = [];
  constructor(private ts = '1712345678.000100') {}
  async postMessage(msg: { channel?: string; blocks: unknown[]; fallbackText: string }) {
    this.posted.push(msg);
    return { ts: this.ts };
  }
}
```

### 4. `publisher.it.test.ts:9-13` — `vi.mock` конкретного адаптера замість `ContainerOverrides`

```ts
vi.mock('../../adapters/slack/slack.client.js', () => ({
  SlackWebhookClient: class { postMessage = postMessage; },
}));
```

Це дослівний анти-патерн зі скіла («substitute at the boundary the architecture
already provides», не `vi.mock` шляху модуля). Три конкретні наслідки:

- тест прикріплений до графа імпортів — переїзд `slack.client.ts` мовчки
  зламає його, хоча архітектурно нічого не змінилось;
- мокається **конкретний клас**, а не порт, тож тест не перевіряє те, що
  насправді варто перевірити — що сервіс резолвить Slack через контейнер;
- підмінений конструктор ігнорує аргументи, тому реальне звʼязування
  `new SlackWebhookClient(token, this.config.slackDefaultChannel)` (container.ts:77)
  не покрите нічим: і токен, і дефолтний канал можна передати неправильно, тест
  лишиться зеленим.

Як правильно (після п. 1 і п. 3):

```ts
const slack = new MockSlackClient();
container = new Container(loadConfig(), db, { slack });
// …
expect(slack.posted).toHaveLength(1);
expect(slack.posted[0]!.channel).toBe('#reviews');
```

Плюс зникає потреба в `secrets`-заглушці (п. 20) — з `overrides.slack` секрет
взагалі не читається.

### 5. `service.ts:82` та `service.ts:132` — виклики методів `reviewRepo`, яких не існує

```ts
const review = await this.container.reviewRepo.getReview(workspaceId, row.reviewId); // :82
const reviews = await this.container.reviewRepo.listReviews(workspaceId, prId);      // :132
```

У `server/src/modules/reviews/repository.ts`:

- `getReview(reviewId: string)` — **один** аргумент (рядок 69), не два;
- `listReviews` не існує взагалі; найближче — `reviewsForPull(prId)` (рядок 65),
  яка повертає `{ review, findings }[]`, а не `ReviewRow[]`.

Гілка не збереться. Сам напрямок обраний правильно (ходити в чужий репозиторій
через `container.reviewRepo`, а не імпортувати `../reviews/repository.js` —
це саме те, для чого `reviewRepo` живе на контейнері), але API вигаданий.
Якщо гілка додає ці методи в `reviews/repository.ts` — цієї правки немає в
наданому наборі, і вона мусить бути в діффі та в ревʼю окремо.

Окремо зверніть увагу: `getReview(reviewId)` **не скоупиться по workspace** —
там немає такого параметра. Тобто якщо додавати метод, додавайте
workspace-скоуповану перегрузку, інакше `retryFailed` тягне ревʼю чужого
воркспейсу за `row.reviewId`.

### 6. `publisher.it.test.ts:2` — імпорт неіснуючого хелпера

```ts
import { makeDb, resetDb, seedWorkspace, seedPull, seedReview } from '../../../test/helpers/db.js';
```

У `server/test/helpers/` є лише `pg.ts` (експортує `PgFixture`,
`dockerAvailable`, `startPg`) і `runs.ts`. Модуля `db.ts` немає, жодного з
пʼяти імпортованих символів не існує. Подивіться, як це роблять решта 14
`*.it.test.ts` у `server/test/`, і використайте той самий фікстур —
інтеграційна лейна self-skip'иться без Docker саме через `dockerAvailable()`.

### 7. `repository.ts:60, 102-104` — `sqlIncrement()` бреше типам, `attempts` ніколи не росте

```ts
.set({ status, error, attempts: sqlIncrement() })   // :60
// …
function sqlIncrement() {
  return undefined as unknown as number;            // :103
}
```

`undefined as unknown as number` — це каст, який гасить помилку компілятора,
не роблячи роботу. Drizzle викидає `undefined`-поля з `SET`, тож `attempts`
залишається на початковому значенні назавжди.

Наслідок системний, а не косметичний: `retryFailed` (`service.ts:77-100`)
відбирає рядки лише за `status = 'retryable'` (`repository.ts:78-83`) і не
дивиться на `attempts`. Рядок, що падає стабільно (мертвий канал, відкликаний
токен), буде переattempt'итись на кожен виклик `POST /publications/retry`
вічно. `PUBLISH_RETRY_LIMIT` тут використаний як `.limit()` (рядок 85), тобто
«скільки рядків за раз» — це суперечить його імені й нічого не обмежує.

Як правильно — справжній SQL-інкремент (прецедент у репо:
`src/modules/repo-intel/repository.ts:408`) і фільтр за спробами:

```ts
import { sql, lt } from 'drizzle-orm';

.set({ status, error, attempts: sql`${t.publications.attempts} + 1` })

// listRetryable:
.where(and(
  eq(t.publications.workspaceId, workspaceId),
  eq(t.publications.status, 'retryable'),
  lt(t.publications.attempts, PUBLISH_RETRY_LIMIT),
))
```

Функцію `sqlIncrement` видалити. Якщо десь ще зʼявиться `as unknown as`, це
сигнал, що тип каже правду, а код — ні.

### 8. `repository.ts:90-99` — `listRecent(prIds)` не скоупиться по `workspaceId`

```ts
async listRecent(prIds: string[]): Promise<PublishRecord[]> {
  const rows = await this.db.select().from(t.publications)
    .where(inArray(t.publications.prId, prIds))
    .limit(200);
```

Порушує і правило скіла («every query scoped by `workspaceId`»), і tenancy-правило
з шапки `server/src/db/schema.ts:3-6`. З підібраним `prId` метод віддає
публікації чужого воркспейсу. До того ж його ніхто не викликає — сервіс
використовує `listForPull` і `listRetryable`.

Як правильно: видалити (мертвий код найпростіше не мати), а якщо потрібен —
першим параметром `workspaceId` і `eq(t.publications.workspaceId, workspaceId)`
у `and(...)`, як у решті методів файлу.

### 9. `service.ts:90` — `retryFailed` завжди шле в Slack, ігноруючи `row.target`

```ts
const result = await this.deliverToSlack(review, pull.title, row.channel ?? undefined);
```

`publish()` розгалужується за таргетом (рядки 64-67: `slack` → Slack,
інакше → `renderMarkdown`), а `retryFailed` — ні. Рядок із `target: 'markdown'`,
що з якоїсь причини опинився в `retryable`, буде відправлений у Slack-канал.
Це не гіпотетично: `isRetryable` (рядок 136-139) ловить будь-який
`AppError` зі `status >= 500`, а `renderMarkdown` теж може кинути.

Як правильно: винести розгалуження в приватний `deliver(review, prTitle, target,
channel)` і викликати його з обох місць — тоді дві дороги не зможуть розʼїхатись.

### 10. `db/schema` — таблиці `publications` не існує

`repository.ts` звертається до `t.publications` у пʼяти місцях. У
`server/src/db/schema.ts` та в жодному файлі `server/src/db/schema/*` цієї
таблиці немає. Гілка мусить додати домен-файл під `src/db/schema/` + реекспорт
у барелі **і нову міграцію** — застосовані `.sql` у `src/db/migrations/` не
чіпати. Міграції не накатуються на бут: `cd server && pnpm db:migrate`.

Поки таблиці немає, `toDto` (рядок 106) типізується через
`typeof t.publications.$inferSelect`, тобто файл не компілюється.

### 11. `src/modules/index.ts` — немає запису `publisher`

Реєстрація модулів статична і в одному місці (`src/modules/index.ts`, 15
записів). Без `import publisher from './publisher/routes.js'` і рядка в
`modules` роути не піднімаються, а `routes.ts` стає недосяжним модулем —
це впіймає правило `no-orphans` у dependency-cruiser
(`.dependency-cruiser.cjs:43-46`, «Unreachable module — dead code, or a missing
registration in modules/index.ts»).

---

## Середні

### 12. `service.ts:45-47` — валідація таргета всередині кільця

```ts
if (!SUPPORTED_TARGETS.includes(target)) {
  throw new AppError('unsupported_target', `Unknown publish target "${target}"`, 422);
}
```

`routes.ts:26` уже оголошує `body: PublishRequest`. Далі одне з двох, і обидва
погані:

- якщо `PublishRequest.target` — `z.enum([...])`, перевірка мертва (недосяжна
  гілка, яку `tsc` мав би звузити до `never`);
- якщо це `z.string()`, то валідація протекла з краю всередину: сервіс
  повертає 422 — суто HTTP-код — за форму даних, які мали бути розібрані на
  межі. Скіл на цьому категоричний: parse at the boundary, всередині кілець
  дані вже довірені.

Як правильно: звузити `PublishRequest.target` до `z.enum(SUPPORTED_TARGETS)`
у `vendor/shared` і прибрати перевірку із сервісу. Тоді невалідний таргет
422'иться до входу в хендлер, а `SUPPORTED_TARGETS` лишається єдиним джерелом.

### 13. `service.ts:131-134` — `latestReview` покладається на чуже сортування

```ts
private async latestReview(...) {
  const reviews = await this.container.reviewRepo.listReviews(workspaceId, prId);
  return reviews.find((r) => r.kind === 'review') ?? null;
}
```

Метод називається `latestReview`, але «latest» тут — побічний ефект `ORDER BY`
у репозиторії **чужого** модуля. Зміна сортування в `reviews/repository.ts`
тихо змінить, який саме ревʼю публікується — без падіння тесту й без згадки в
діффі publisher'а. Публікація не того ревʼю в командний канал помітна не одразу.

Як правильно: або метод на `reviewRepo` з контрактною гарантією
(`latestReviewForPull(workspaceId, prId)` з явним `orderBy(desc(createdAt))`),
або явна сортувальна логіка тут з `createdAt` у типі. Порядок має бути
записаний десь як вимога, а не як звичка.

### 14. `repository.ts:29, 49` — `inserted!` / `row!` перетворюють 404 на 500

`markDelivered` з чужим `workspaceId` (або з уже видаленим рядком) поверне
`[]`, `row!` буде `undefined`, і `toDto(row!)` впаде на `row.id` — клієнт
отримає 500 замість 404. Скіл: сервіси кидають доменні помилки, роути їх не
мапять руками, отже помилка має бути правильною з самого початку.

Як правильно:

```ts
if (!row) throw new NotFoundError('Publication not found');
return toDto(row);
```

### 15. `service.ts:106-119` — `ConfigError` перепаковується за типом винятку

```ts
try { slack = await this.container.slack(); }
catch (err) {
  if (err instanceof ConfigError) { throw new AppError(SLACK_NOT_CONFIGURED_CODE, '…', 409); }
```

Сам напрямок правильний (сервіс кидає доменну помилку, роут її не мапить), але
контракт крихкий: сервіс залежить від того, який саме підклас кине контейнер.
Змінить `slack()` тип винятку — і 409 тихо стане 500. Плюс `ConfigError` уже є
підкласом `AppError` зі своїм статусом (`platform/errors.ts:39`), тож
перепаковка дублює те, що вже вирішено в одному місці.

Варіант краще: питати про налаштованість явно (`await this.container.secrets.get(...)`
через окремий метод, або `container.isSlackConfigured()`), а не через `catch`
по типу.

### 16. `publisher.it.test.ts:26-30` — `as never` в override секретів

```ts
secrets: { get: async (key: string) => (key === 'SLACK_BOT_TOKEN' ? 'xoxb-test' : undefined) } as never,
```

`as never` глушить те, що обʼєкт не задовольняє `SecretsProvider`. У
`adapters/mocks.ts` уже є `MockSecretsProvider` (`mocks.excerpt.ts:17`) саме
для цього. Після фікса п. 1+3 цей override взагалі не потрібен — з
`overrides.slack` секрет не читається.

### 17. `publisher.it.test.ts` лежить у `src/modules/publisher/`

Не поломка: лейни розділені за глобом імені (`--exclude '**/*.it.test.ts'` в
`server-unit.yml:106`, фільтр `.it.test` в `server-integration.yml:65`), а
`vitest.config.ts:14` включає і `src/**/*.test.ts` — тож файл потрапить куди
треба. Але всі 14 наявних `*.it.test.ts` живуть у `server/test/`. Розхожість
на рівному місці: наступний, хто шукатиме інтеграційні тести, дивитиметься в
`test/`. Перенести в `server/test/publisher.it.test.ts`.

### 18. Контракти й порт: перевірити `vendor/shared` по обидва боки

- У `server/src/vendor/shared/adapters.ts` на `main` сім портів
  (`LLMProvider`, `Embedder`, `GitHubClient`, `GitClient`, `CodeIndex`,
  `AuthProvider`, `SecretsProvider`) — `SlackClient` серед них немає. Гілка має
  його додати саме туди (серверна копія канонічна), а не в `adapters/slack/`.
- `PublishRecord` перетинає провід: `GET /pulls/:id/publications`
  (`routes.ts:19`) віддає його клієнту. Отже `PublishRecord`, `PublishTarget`,
  `PublishStatus`, `PublishRequest` мусять бути **віддзеркалені** в
  `client/src/vendor/shared`. Зараз там нічого Publish-подібного немає.
  Правило: редагуємо серверну копію, потім дзеркалимо все, що йде по проводу —
  ніколи не одну з двох.
- `SlackClient` по проводу не ходить (це порт, не DTO) — його дзеркалити не треба.

### 19. `routes.ts:34-38` — `POST /publications/retry` без схем

```ts
app.post('/publications/retry', async (req) => {
  const { workspaceId } = await getContext(app.container, req);
  const sent = await service.retryFailed(workspaceId);
  return { sent };
});
```

Немає `schema` взагалі. Тіла тут справді нема, але правило «одна Zod-схема
драйвить і валідацію, і серіалізацію» стосується й відповіді: `{ sent }` зараз
серіалізується як анонімний обʼєкт, тип у клієнта не виводиться, і випадкове
додавання поля в майбутньому нічим не обмежене. Оголосіть
`response: { 200: z.object({ sent: z.number().int() }) }`.

### 20. `repository.ts:81` — `inArray(status, ['retryable'])` з одним елементом

Дрібниця, але `eq(t.publications.status, 'retryable')` читабельніше і краще
лягає на індекс. Якщо масив передбачався розширюваним — винесіть його
константою в `constants.ts` поруч із `PUBLISH_RETRY_LIMIT`.

---

## Що зроблено правильно (щоб не зламали при виправленні)

- `routes.ts` — чиста межа: Zod-схеми на `params`/`body`, `getContext` резолвить
  workspace, хендлери делегують у сервіс і не торкаються Drizzle. Правило
  `routes-through-service` пройде.
- `service.ts:35-37` — `constructor(private container: Container)` і власний
  репозиторій із `container.db`: рівно форма `modules/repos/service.ts`.
- Сервіс і репозиторій приймають резолвлені значення (`workspaceId`, `prId`,
  `target`), а не `FastifyRequest` — `service-stays-http-agnostic` пройде.
- Рендеринг винесений у `helpers.ts` як чисті функції (`renderSlackBlocks`,
  `renderMarkdown`, `truncateForSlack`) — їх можна тестувати без контейнера.
- Сервіс ніде не робить `new SlackWebhookClient(...)` — ходить через
  `container.slack()`. `no-direct-adapter-clients` пройде; уся проблема з
  Slack-сімʼю зосереджена в контейнері й моках, а не в модулі.
- Крос-модульний доступ іде через `container.reviewRepo`, а не імпортом
  `../reviews/repository.js` — `no-cross-module-internals` пройде (окремо від
  того, що самі методи вигадані, п. 5).
- Коментар у `service.ts:18-31` пояснює, **чому** доставка пишеться в БД до
  спроби, а не після — саме той рід рішення, який варто фіксувати в коді.

---

## Порядок виправлення

1. п. 10, 11, 5, 6 — без них гілка не збирається і не запускається.
2. п. 1 → п. 3 → п. 4 — одним заходом; це один seam, розірваний у трьох файлах.
3. п. 2 — один рядок, але саме він дає баг, який користувач побачить у проді.
4. п. 7, 8, 9 — логіка ретраїв і скоупінг.
5. Решта — до мержу, але без блокування ревʼю.

Локальна перевірка перед пушем:
`node scripts/verify.mjs --slice backend` і `--slice integration`.
