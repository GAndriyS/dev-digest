# Ревʼю гілки `publisher` перед мерджем

Перевірено за скіл-снапшотом `onion-architecture` 1.0.0 (правило залежностей, порти й
адаптери, композиційний корінь, валідація на краю, тестові шви, чек-ліст нового модуля)
та звірено з реальним кодом у репозиторії.

Файли з фікстури `.claude/skills/onion-architecture/evals/fixtures/publisher-module/`
нижче названо їхніми цільовими шляхами на гілці:

| фікстура | шлях на гілці |
|---|---|
| `routes.ts` | `server/src/modules/publisher/routes.ts` |
| `service.ts` | `server/src/modules/publisher/service.ts` |
| `repository.ts` | `server/src/modules/publisher/repository.ts` |
| `publisher.it.test.ts` | `server/src/modules/publisher/publisher.it.test.ts` |
| `container.excerpt.ts` | `server/src/platform/container.ts` |
| `mocks.excerpt.ts` | `server/src/adapters/mocks.ts` |

**Вердикт: не мерджити.** Порт `SlackClient` доданий лише наполовину — з чотирьох
обовʼязкових кроків зроблено два, тому тестовий шов зламаний, а кеш секрету не
скидається. Плюс два дефекти даних у сервісі/репозиторії, які роблять
`POST /publications/retry` непрацездатним.

---

## Блокери

### B1. `invalidateSecretCaches()` не скидає `_slack` — старий токен живе до рестарту

`server/src/platform/container.ts`, рядки 73–79 (`slack()`) і 102–110
(`invalidateSecretCaches()`).

`slack()` читає `SLACK_BOT_TOKEN` через `SecretsProvider` і кешує готовий клієнт у
`this._slack`. Але метод скидання кешу чистить лише три поля:

```ts
invalidateSecretCaches(): void {
  this.llmCache.clear();
  this._github = undefined;
  this._embedder = undefined;
}
```

`_slack` там немає.

**Чому це проблема.** Скіл прямо формулює контракт лінивих геттерів: «Anything needing
a secret is `async` … the key is read through `SecretsProvider` at resolve time, not at
boot». Інвалідація кешу — друга половина цього ж контракту, без неї «at resolve time»
перетворюється на «at first resolve, назавжди». `invalidateSecretCaches()` викликається
у `server/src/modules/settings/routes.ts:84` одразу після `container.secrets.set(...)`,
тобто рівно в той момент, коли користувач через Settings міняє протухлий чи помилковий
ключ. Після цього виклику `github()`, `llm()` і `embedder()` перебудуються з новим
ключем, а `slack()` і далі віддаватиме `SlackWebhookClient`, зібраний зі старим
токеном. Симптом на проді неприємно тихий: користувач вставив новий токен, Settings
відповів «ОК», а публікації далі падають з 401 — і так до перезапуску сервера. Ще
гірший різновид тієї ж баги: якщо `slack()` уперше викликали, коли токена ще не було,
у `_slack` нічого не осіло (кинуто `ConfigError`), але позитивний кеш і негативний
шлях розійшлися — поведінка залежить від того, в якому порядку користувач натискав
кнопки.

**Як правильно.** Додати поле в метод скидання і тримати список повним разом із
кожним новим кешованим клієнтом секрету:

```ts
invalidateSecretCaches(): void {
  this.llmCache.clear();
  this._github = undefined;
  this._embedder = undefined;
  this._slack = undefined;   // ← кожен клієнт, зібраний із секрету
}
```

Правило, яке варто закріпити в ревʼю: **якщо в контейнері зʼявилося приватне поле
`_x`, яке заповнюється значенням із `SecretsProvider.get()`, то в тому ж коміті воно
має зʼявитися в `invalidateSecretCaches()`.** Ці два місця не можна лишати
неузгодженими — вони описують один і той самий життєвий цикл.

Окремо варто дотягнути й другий бік: у `settings/routes.ts` мапа
`SECRET_KEY_BY_PROVIDER` покриває GitHub і LLM-провайдерів, Slack у ній немає. Поки
Slack-токен не можна зберегти через Settings, баг лише «спить»; будь-який інший
викликач `secrets.set(...)` + `invalidateSecretCaches()` його розбудить. Виправляти
все одно треба зараз, у контейнері, а не тоді, коли зʼявиться UI.

---

### B2. Порт `SlackClient` доданий наполовину: немає `ContainerOverrides.slack` і `overrides` не перевіряється першим

`server/src/platform/container.ts`, рядки 27–39 (`ContainerOverrides`) і 73–79
(`slack()`).

Скіл описує додавання порту як чотири нерозривні кроки: інтерфейс у
`vendor/shared/adapters.ts` → адаптер у `adapters/` → **лінивий геттер + запис у
`ContainerOverrides`** у `container.ts` → **мок у `adapters/mocks.ts`**. І далі:
«All four, or the seam is broken». Тут зроблено крок 1 і 2, а кроки 3 і 4 — ні.

Порівняйте з сусідами в тому ж файлі. `github()` (рядки 59–66):

```ts
if (this.overrides.github) return this.overrides.github;   // ← тести виграють
if (this._github) return this._github;
```

`slack()` (рядки 73–79) починається одразу з `if (this._slack)`. Перевірки
`this.overrides.slack` немає, бо й самого поля `slack?: SlackClient` в
`ContainerOverrides` немає — інтерфейс на рядках 27–39 перелічує `secrets`, `auth`,
`github`, `git`, `codeIndex`, `embedder`, `llm`, `repoIntel`, `projectContext`,
`blast`, і на цьому все.

**Чому це проблема.** Скіл каже про порядок перевірок буквально: «Lazy getter with
`??=` caching; `overrides.<x>` checked **first** so tests win». Це не стилістика.
`ContainerOverrides` — єдиний передбачений архітектурою шов підміни: «Substitute
adapters via `new Container(config, db, { github: mockGitHub })` — not `vi.mock` of a
module path». Прибравши цей шов для Slack, гілка змусила тест шукати обхід — і він
його знайшов (див. B3). Наслідок ширший за тести: будь-який майбутній сценарій, де
Slack треба підмінити (dry-run, локальна розробка без воркспейсу, e2e), доведеться
розвʼязувати через мокання шляхів імпорту.

**Як правильно** — привести `slack()` до форми решти геттерів:

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

---

### B3. Немає `MockSlackClient`, і тому інтеграційний тест мокає шлях модуля

`server/src/adapters/mocks.ts` (рядки 6–17 витягу) і
`server/src/modules/publisher/publisher.it.test.ts`, рядки 9–13 та 26–30.

Список експортів `mocks.ts` повний і Slack-дубля в ньому немає: `MockLLMProvider`,
`MockEmbedder`, `MockGitHubClient`, `MockGitClient`, `MockCodeIndex`, `MockBlast`,
`MockAuthProvider`, `MockSecretsProvider`. Це невиконаний крок 4 з чек-ліста порту.

Прямий наслідок — у тесті:

```ts
vi.mock('../../adapters/slack/slack.client.js', () => ({
  SlackWebhookClient: class {
    postMessage = postMessage;
  },
}));
```

**Чому це проблема.** Скіл забороняє саме цю конструкцію: «not `vi.mock` of a module
path. Module-mocking couples the test to the import graph; `ContainerOverrides` couples
it to the port». Тут це не абстрактна шкода, а три конкретні:

1. Тест прибитий до шляху `adapters/slack/slack.client.js`. Перейменування файлу або
   переїзд адаптера — і `vi.mock` тихо перестане підміняти що-небудь; тест піде в
   мережу або впаде з незрозумілою помилкою замість того, щоб зламатися на
   компіляції.
2. Анонімний клас-заглушка не має `implements SlackClient`. Компілятор більше не
   стежить, чи дубль відповідає порту: розширите інтерфейс — тест і далі
   «зеленітиме» на застарілій формі.
3. Щоб продертися крізь справжній `slack()`, тесту довелося підсунути фейковий
   `SecretsProvider` із приведенням `as never` (рядки 26–30):

   ```ts
   secrets: { get: async (key: string) => (key === 'SLACK_BOT_TOKEN' ? 'xoxb-test' : undefined) } as never
   ```

   `as never` — це вимкнений тайпчекер. І він тут зайвий двічі: у `mocks.ts` уже є
   готовий `MockSecretsProvider` (рядок 17 витягу), а після B2 токен узагалі не
   знадобиться, бо override перехопить резолв раніше.

**Як правильно.** Додати в `server/src/adapters/mocks.ts` дубль, який реалізує порт і
записує виклики, за зразком `MockNotifier` зі скіла:

```ts
export class MockSlackClient implements SlackClient {
  readonly posted: Array<{ channel?: string; blocks: unknown[]; fallbackText: string }> = [];
  async postMessage(msg: { channel?: string; blocks: unknown[]; fallbackText: string }) {
    this.posted.push(msg);
    return { ts: '1712345678.000100' };
  }
}
```

і переписати підготовку тесту так, щоб `vi.mock` і `as never` зникли обидва:

```ts
const slack = new MockSlackClient();
container = new Container(loadConfig(), db, { slack });
```

Сценарій «Slack впав» тоді теж виражається через порт (кинути з `postMessage`
всередині дубля), а не через `postMessage.mockRejectedValueOnce` на модульному моку.

---

### B4. `retryFailed()` читає з DTO поля, яких у ньому немає — ретрай не працює взагалі

`server/src/modules/publisher/service.ts`, рядки 82–83 і 90; мапер
`server/src/modules/publisher/repository.ts`, рядки 106–119.

`listRetryable()` оголошено як `Promise<PublishRecord[]>`, а `toDto()` будує
`PublishRecord` у snake_case — це форма для дроту:

```ts
return {
  id: row.id,
  pr_id: row.prId,
  review_id: row.reviewId,
  // …
};
```

Сервіс же читає з тих самих рядків camelCase-поля:

```ts
const review = await this.container.reviewRepo.getReview(workspaceId, row.reviewId);
const pull   = await this.container.reviewRepo.getPull(workspaceId, row.prId);
```

`row.reviewId` і `row.prId` у `PublishRecord` не існують.

**Чому це проблема.** У найкращому разі це помилка компіляції і гілка просто не
збереться. У гіршому (якщо `PublishRecord` десь послаблено індексною сигнатурою або
приведенням) обидва вирази дадуть `undefined`, `getReview`/`getPull` повернуть
порожньо, спрацює гілка `if (!review || !pull)` — і **кожен** ретраєбл-рядок буде
позначено `failed` з текстом `'review or pull disappeared'`, хоча і ревʼю, і PR на
місці. `POST /publications/retry` при цьому чесно поверне `{ sent: 0 }`, тобто
відмова буде мовчазною: дані рядків затираються статусом, який не відповідає
дійсності, і повторити доставку вже не вийде. Зверніть увагу, що тест
«re-sends everything marked retryable» (рядки 54–63) стверджує `sent === 1`, тож
одне з двох: або гілка не проходить власний тест, або `PublishRecord` насправді має
іншу форму, ніж її будує `toDto` — і тоді помилка в маперy. Розібратися треба до
мерджу, наосліп це не пройде.

**Як правильно** — і тут корінь глибший за одруківку. Репозиторій не повинен був
взагалі мапити в дротовий DTO. У цьому кодбейсі шар даних віддає **row-типи**: див.
`server/src/db/rows.ts` з його коментарем про те, що рядкові типи живуть поруч зі
схемою, і `PullRow`, `FindingRow`, `AgentRunRow` там саме такі — camelCase-виводи
Drizzle. Жоден інший `modules/*/repository.ts` не тримає власного `toDto`.

Тому:

- `listRetryable()` і `listForPull()` для внутрішніх викликачів мають повертати
  `PublicationRow` (`typeof t.publications.$inferSelect`, оголошений у `db/rows.ts`),
  а не `PublishRecord`;
- перетворення в snake_case — це турбота краю. Або окрема Zod-схема відповіді на
  маршруті, або явний мапер у `helpers.ts`, який викликає `routes.ts`.

Зараз форма дроту протекла на два кільця всередину, і `retryFailed()` — перша
жертва цієї протічки, але не остання: будь-яка зміна назв полів у контракті
ламатиме тіло сервісу.

---

## Серйозні зауваження

### S1. `attempts` ніколи не інкрементується, і ретраї нескінченні

`server/src/modules/publisher/repository.ts`, рядок 60 і рядки 102–104.

```ts
.set({ status, error, attempts: sqlIncrement() })
// …
function sqlIncrement() {
  return undefined as unknown as number;
}
```

Функція називається «інкремент», а повертає `undefined`, замаскований під `number`.
Drizzle викидає `undefined`-поля з `SET`, тож колонка `attempts` не змінюється
ніколи. Приведення `as unknown as number` — це не деталь реалізації, а причина, з
якої дефект пройшов компілятор: тип збрехали навмисно.

Далі це складається з другою половиною: `listRetryable()` (рядки 74–88) фільтрує
рядки лише за `status`, обмеження за кількістю спроб немає, а `PUBLISH_RETRY_LIMIT`
використано як `.limit(limit)` — тобто як **розмір сторінки**, а не як стелю спроб
(`service.ts:78`). Разом: публікація, що падає з постійної причини (видалений канал,
відкликаний токен), лишається `retryable` довіку і б'є у Slack на кожен виклик
`POST /publications/retry`. Це прямий шлях до рейт-ліміту й до нескінченного циклу
відмов.

Як правильно: справжній SQL-інкремент і стеля спроб у запиті —

```ts
.set({ status, error, attempts: sql`${t.publications.attempts} + 1` })
```

```ts
.where(and(
  eq(t.publications.workspaceId, workspaceId),
  eq(t.publications.status, 'retryable'),
  lt(t.publications.attempts, PUBLISH_MAX_ATTEMPTS),
))
```

Заодно розділіть у `constants.ts` дві різні величини: `PUBLISH_MAX_ATTEMPTS`
(скільки разів пробувати один рядок) і `PUBLISH_RETRY_BATCH` (скільки рядків брати
за прохід). Зараз одна константа грає обидві ролі, і назва не відповідає жодній.

Дрібниця в тому ж запиті: `inArray(t.publications.status, ['retryable'])` з одним
елементом — це `eq`. Читається як недописаний код.

### S2. `listRecent()` не скоупиться за `workspaceId`

`server/src/modules/publisher/repository.ts`, рядки 90–99.

```ts
.where(inArray(t.publications.prId, prIds))
```

Чек-ліст нового модуля в скілі формулює це без винятків: «`repository.ts` — the only
place that touches its tables; **every query scoped by `workspaceId`**». Решта
методів у цьому ж файлі скоуп тримають — цей один випадає. Достатньо, щоб викликач
передав `prId` з чужого воркспейсу (або щоб id колись стали вгадуваними), і метод
поверне чужі публікації разом із текстами доставок. Ізоляція воркспейсів — це
інваріант шару даних; вона не має залежати від дисципліни викликача.

Додатково: метод зараз нічим не викликається — сервіс його не використовує. Мертвий
код із дірою в ізоляції — найгірша комбінація: `no-orphans` у dependency-cruiser
ловить недосяжні *модулі*, а не невикористані методи, тож само воно не спливе.
Або приберіть до мерджу, або одразу додайте параметр:

```ts
async listRecent(workspaceId: string, prIds: string[]): Promise<PublicationRow[]> {
  // and(eq(t.publications.workspaceId, workspaceId), inArray(t.publications.prId, prIds))
}
```

### S3. `retryFailed()` ігнорує `row.target` і завжди шле в Slack

`server/src/modules/publisher/service.ts`, рядок 90.

```ts
const result = await this.deliverToSlack(review, pull.title, row.channel ?? undefined);
```

У `publish()` (рядки 64–67) є розгалуження за `target`: `slack` → `deliverToSlack`,
інакше → `renderMarkdown`. У `retryFailed()` цього розгалуження немає — рядок із
`target === 'markdown'` під час ретраю піде в Slack. Перевірки `SUPPORTED_TARGETS`
теж немає: вона стоїть лише у `publish()` (рядок 45), тож рядок зі старим або
вилученим таргетом (міграція, зміна списку) на ретраї мовчки доставиться не туди.

Як правильно: винести диспетч за таргетом в один приватний метод і викликати його з
обох місць — щоб «як доставляти» було описано рівно один раз:

```ts
private async deliver(review: ReviewRecord, prTitle: string, target: PublishTarget, channel?: string) {
  if (!SUPPORTED_TARGETS.includes(target)) {
    throw new AppError('unsupported_target', `Unknown publish target "${target}"`, 422);
  }
  return target === 'slack'
    ? this.deliverToSlack(review, prTitle, channel)
    : { externalId: null, body: renderMarkdown(review, prTitle) };
}
```

### S4. `latestReview()` не бере найновіше ревʼю

`server/src/modules/publisher/service.ts`, рядки 131–134.

```ts
private async latestReview(workspaceId: string, prId: string): Promise<ReviewRecord | null> {
  const reviews = await this.container.reviewRepo.listReviews(workspaceId, prId);
  return reviews.find((r) => r.kind === 'review') ?? null;
}
```

`find` повертає **перший** елемент, що підійшов. Ніщо в сигнатурі `listReviews` не
обіцяє сортування за спаданням дати, а докстрінг класу (рядки 25–30) саме на цьому
вибір і будує: «which review counts as the one to publish». Якщо репозиторій колись
поверне порядок вставки — у Slack поїде найстаріше ревʼю, і помітять це не одразу:
результат виглядатиме валідним, просто застарілим.

Неявні гарантії порядку не мають перетинати межу шарів. Або впорядкуйте явно тут
(`[...reviews].sort((a, b) => b.createdAt - a.createdAt)[0]`), або додайте в
репозиторій метод із порядком у назві (`latestReviewForPull`) і `orderBy(desc(...))`
у самому запиті. Другий варіант кращий: сортування біля даних, а не в памʼяті.

### S5. Виклики `container.reviewRepo` не сходяться з реальним `ReviewRepository`

`server/src/modules/publisher/service.ts`, рядки 49, 82–83, 132.

Сам підхід правильний: скіл каже, що крос-модульні репозиторії живуть на контейнері
(`container.agentsRepo`, `container.reviewRepo`), і лізти в чужу теку за
`repository.ts` — порушення межі. Тут узято саме з контейнера — добре. Проблема в
сигнатурах. У поточному `server/src/modules/reviews/repository.ts`:

- рядок 69: `getReview(reviewId: string)` — **один** аргумент, без скоупу за
  воркспейсом. Сервіс кличе `getReview(workspaceId, row.reviewId)` — два.
- методу `listReviews(workspaceId, prId)` немає взагалі; найближче —
  `reviewsForPull(prId)` (рядок 65), теж без воркспейсу.
- `getPull(workspaceId, prId)` (рядок 32) — збігається.

Отже, або гілка міняє ще й `ReviewRepository` (в описі гілки цього немає, у витягах
теж), або вона не компілюється. Це треба показати ревʼюеру явно. Якщо
`getReview`/`listReviews` таки додаються — зверніть увагу, що вони мають бути
скоупнуті за `workspaceId` **у запиті**, а не просто приймати зайвий параметр:
інакше публікація зможе витягнути чуже ревʼю за вгаданим id.

---

## Дрібні зауваження

### D1. Модуль, схоже, не зареєстровано в `modules/index.ts`

Пункт 5 чек-ліста нового модуля: «One entry in `src/modules/index.ts`». У поточному
`server/src/modules/index.ts` `publisher` відсутній, а в описі гілки правка цього
файлу не згадана — перелічено лише модуль і «правку платформи». Якщо запису справді
немає, `routes.ts` стає недосяжним і CI впаде на правилі `no-orphans`
(severity `error`) ще до будь-яких тестів. Потрібні рівно два рядки: імпорт і запис
у мапу `modules`.

### D2. Контракти треба віддзеркалити в клієнтський `vendor/shared`

`PublishRequest` (`routes.ts:3`), `PublishRecord`, `PublishTarget`, `PublishStatus`
(`service.ts:1–6`, `repository.ts:2`) у поточному `server/src/vendor/shared` не
існують — гілка їх додає. `PublishRequest` — це тіло запиту, `PublishRecord` —
відповідь маршруту, тобто обидва перетинають дріт. За `AGENTS.md` і скілом
серверна копія канонічна, а зміни, що перетинають дріт, треба продублювати в
`client/src/vendor/shared` — «never edit only one». У витягах цього не видно,
перевірте на гілці.

Зворотний бік того ж правила: `SlackClient` — це **порт**, він дротом не ходить і в
клієнтську копію потрапити не повинен.

### D3. `POST /publications/retry` без схеми й без рейт-ліміту

`server/src/modules/publisher/routes.ts`, рядки 34–38.

Маршрут мутуючий, віялом ходить у зовнішній API — і не має ні `schema`, ні
`config.rateLimit`. Порівняйте з `server/src/modules/settings/routes.ts:70`, де на
маршрут із зовнішнім викликом навішано `rateLimit: { max: 20, timeWindow: '1 minute' }`.
Разом із S1 (нескінченні ретраї) відсутність ліміту означає, що будь-хто може
рознести rate-limit Slack-воркспейсу циклом із curl.

### D4. Немає схем відповіді на маршрутах

`routes.ts`, рядки 19, 24, 34. Скіл: «One Zod schema drives request validation **and**
response serialization». Жоден із трьох маршрутів не оголошує `response`. Кодбейс тут
непослідовний (`brief/routes.ts:43`, `onboarding/routes.ts:30` оголошують,
`blast/routes.ts` свідомо ні), тож це не блокер — але саме тут схема відповіді
принесла б користь: вона зафіксувала б snake_case-форму `PublishRecord` на краю і
зробила б протічку з B4 неможливою.

### D5. `POST /pulls/:id/publications` завжди віддає 200

`routes.ts`, рядки 24–32. Створення доставки — це створення ресурсу; у цьому
кодбейсі є прецедент явного коду статусу (`repos/routes.ts`:
`reply.status(created ? 201 : 200)`). Дрібниця, але клієнт не може відрізнити
створену публікацію від будь-чого іншого.

### D6. `row!` у репозиторії ховає промах `WHERE` за TypeError

`repository.ts`, рядки 29 і 49. `markDelivered()` робить
`.returning()` і одразу `toDto(row!)`. Якщо `WHERE` нічого не знайшов (чужий
воркспейс, рядок видалено паралельно), `row` буде `undefined`, а `toDto` впаде на
`row.id` з `TypeError` — у логах це виглядатиме як баг рантайму, а не як «нема
такого». Скіл: «Throw `AppError` (or a subclass: `NotFoundError`, `ConfigError`) for
anything with a status». Перевірте явно і киньте `NotFoundError`.

### D7. Тест «records the delivery before attempting it» цього не перевіряє

`publisher.it.test.ts`, рядки 34–42. Тест стверджує порядок «спочатку запис,
потім спроба», а перевіряє лише кінцевий стан: `status === 'delivered'`,
`external_id`, факт виклику. Порядок операцій — заявлений інваріант сервісу
(докстрінг, `service.ts:26–30`: краще лишити рядок у `pending`, ніж не лишити
нічого), і саме він не покритий. Перевірити його можна тільки зсередини дубля
порту — ще один аргумент за B3: маючи `MockSlackClient`, легко зробити
`postMessage`, який спершу зазирне в БД і переконається, що `pending`-рядок уже
там.

---

## Що зроблено правильно

Щоб не загубилося серед зауважень:

- Розкладка `routes / service / repository` відповідає чек-лісту, шар сервісу є —
  на відміну від grandfathered-модулів `polling/pulls/settings/workspace`.
- `routes.ts` — справжній край: `getContext`, Zod `params`/`body` у `schema`,
  делегування в сервіс. Ручного `Schema.parse(req.body)` немає, SQL у маршрутах
  немає — `routes-through-service` пройде.
- Сервіс приймає розвʼязані значення (`workspaceId`, `prId`, `target`, `channel`),
  `FastifyRequest` усередину не тече — `service-stays-http-agnostic` пройде.
- Конкретні адаптери в модулі не конструюються: `SlackWebhookClient` створюється
  лише в `container.ts`, сервіс ходить через `await this.container.slack()` —
  `no-direct-adapter-clients` пройде.
- Крос-модульний доступ до ревʼю — через `container.reviewRepo`, а не імпортом
  `../reviews/repository.js`; `no-cross-module-internals` пройде (за винятком
  сигнатур із S5).
- Рендеринг винесений у чистий `helpers.ts`, літерали — у `constants.ts`.
- Доменні помилки кидає сервіс (`AppError`, `NotFoundError`), маршрут їх руками не
  мапить; `ConfigError` від контейнера конвертується в осмислений 409 з кодом.
- Тест названо `publisher.it.test.ts` — правильний глоб для інтеграційної лінії CI.
- `slack()` зроблено `async` і лінивим, з поясненням у коментарі, чому саме так —
  правильне рішення (біда лише в тому, що інвалідація за ним не поспіла).

---

## Чек-ліст перед повторним ревʼю

1. `_slack = undefined` у `invalidateSecretCaches()` (B1).
2. `slack?: SlackClient` у `ContainerOverrides`; `overrides` перевіряється першим у
   `slack()` (B2).
3. `MockSlackClient implements SlackClient` у `adapters/mocks.ts`; з тесту зникають
   `vi.mock` і `as never`, підміна йде через конструктор `Container` (B3).
4. `retryFailed()` читає наявні поля; репозиторій віддає row-тип, snake_case
   мапиться на краю (B4).
5. Справжній SQL-інкремент `attempts` + стеля спроб у `listRetryable`; дві окремі
   константи замість однієї (S1).
6. `listRecent()` скоупнуто за `workspaceId` або видалено (S2).
7. Диспетч за `target` спільний для `publish` і `retryFailed` (S3).
8. `latestReview` упорядковано явно — краще `orderBy(desc(...))` у запиті (S4).
9. Сигнатури `reviewRepo.getReview` / `listReviews` зведено з реальним
   `ReviewRepository`, обидва скоупнуті за воркспейсом (S5).
10. `publisher` зареєстровано в `modules/index.ts` (D1).
11. Дротові контракти віддзеркалено в `client/src/vendor/shared`; `SlackClient` —
    ні (D2).
12. `pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs`
    із `server/` — зелений, і жодного нового запису в `pathNot` (скіл: «shrink them,
    never append»).
