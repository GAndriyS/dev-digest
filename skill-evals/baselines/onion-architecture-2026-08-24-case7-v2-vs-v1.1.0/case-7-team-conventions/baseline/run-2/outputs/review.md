# Ревʼю гілки `annotations` (L06) — перед мерджем

Перевірено 5 файлів із `.claude/skills/onion-architecture/evals/fixtures/annotations-branch/`:
`0043_review_annotations.sql`, `schema.excerpt.ts`, `routes.ts`, `service.ts`, `repository.ts`.
Звірено з реальним кодом репозиторію (`server/src/db/schema/**`, `server/src/db/migrations/**`,
`server/src/modules/reviews/**`, `server/src/platform/**`, `server/src/vendor/shared/**`),
з `AGENTS.md` / `server/AGENTS.md` і зі скілом onion-architecture.

**Вердикт: не мерджити.** Є 6 блокерів (гілка не збереться, міграція не застосується,
є ризик втрати даних і дірка в безпеці вкладень) плюс 8 суттєвих і ~15 дрібніших зауважень.

Окремо: `depcruise` на цій гілці буде **зелений**. Найважча проблема (п.5) — це не імпорт,
а inline-запит до чужої таблиці, тобто рівно та сліпа зона, яку конфіг не бачить. Зелена CI
тут нічого не доводить.

---

## Що зроблено правильно (щоб не переробляли)

- Розкладка `routes / service / repository` відповідає анатомії модуля з `server/AGENTS.md`.
- Сервіс приймає **резолвнуті значення** (`workspaceId`, `userId`, `reviewId`, розпарсене тіло),
  а не `FastifyRequest` — `service-stays-http-agnostic` не порушено (`service.ts:23-28`).
- Репозиторій будується з `container.db` у конструкторі сервіса (`service.ts:19-21`) — так само,
  як у `modules/repos/service.ts`.
- `getContext(app.container, req)` викликається в кожному хендлері — тенансі не забуто на еджі.
- Zod `params` / `body` оголошені на маршрутах, а не `Schema.parse(req.body)` у хендлері.
- Wire-контракти в snake_case (`review_id`, `file_name`, `annotated_at`) — узгоджено з
  `server/src/vendor/shared/contracts/review-api.ts:14-36`.

---

## Блокери

### 1. `schema.excerpt.ts:5-9` — імпорти вказують на файли, яких не існує

```ts
import { workspaces } from './workspaces.js';
import { pullRequests } from './pull-requests.js';
import { users } from './users.js';
import { now } from './_shared.js';
```

**Чому проблема.** У репозиторії немає ні `schema/workspaces.ts`, ні `schema/pull-requests.ts`,
ні `schema/users.ts`. Реальний `server/src/db/schema/reviews.ts:1-5` імпортує так:

```ts
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';
```

`workspaces` **і** `users` живуть у `schema/core.ts`, `pullRequests` — у `schema/pulls.ts`.
Плюс усередині `db/schema/**` розширення `.js` не пишуть — на відміну від `src/modules/**`.
Тобто це не «косметика»: гілка не тайпчекнеться.

**Як правильно.**
```ts
import { now } from './_shared';
import { workspaces, users } from './core';
import { pullRequests } from './pulls';
```

### 2. `0043_review_annotations.sql` — міграція написана руками і не застосується

**Чому проблема.** Три речі одразу:

1. **Номер.** Останній файл у `server/src/db/migrations/` — `0017_shallow_swordsman.sql`.
   Наступний вільний номер — `0018`, а не `0043`.
2. **Немає запису в журналі.** `server/src/db/migrations/meta/_journal.json` закінчується на
   `"idx": 17`. Drizzle-мігратор іде **по журналу**, а не по вмісту теки: файл без запису
   `pnpm db:migrate` просто не побачить. Мігрувати нема чого — і ніхто цього не помітить,
   поки перший запит не впаде на «column annotation_text does not exist».
3. **Немає снапшота** `meta/0018_snapshot.json`. Без нього наступний `pnpm db:generate`
   порівняє схему зі станом на 0017 і згенерує ці ж колонки вдруге.

Плюс формат: усі згенеровані міграції розділяють стейтменти маркером `--> statement-breakpoint`
(`0017_shallow_swordsman.sql:1-3`, `0014_conventions_tenant_index.sql:1-2`) і **не** використовують
`IF NOT EXISTS` — ідемпотентність забезпечує журнал, а не SQL-гарди.

`server/AGENTS.md`: «Migrations: `pnpm db:migrate` explicitly, never on boot; a new one via
`pnpm db:generate`.»

**Як правильно.** Видалити `0043_*.sql`, привести `schema/reviews.ts` (і/або новий
`schema/annotations.ts`) до бажаного стану, виконати `cd server && pnpm db:generate` — він сам
дасть `0018_*.sql`, снапшот і рядок у `_journal.json`. Руками правити тільки коментарі.

### 3. `0043_review_annotations.sql:8` проти `schema.excerpt.ts:28-30` — розʼїхались FK

Міграція:
```sql
ALTER TABLE "reviews" ADD COLUMN "annotation_author_id" uuid;
```
Схема:
```ts
annotationAuthorId: uuid('annotation_author_id').references(() => users.id, { onDelete: 'cascade' }),
```

**Чому проблема.** У БД колонка буде **без** foreign key, а Drizzle вважатиме, що FK є. Наслідки:
у таблиці спокійно опиняться `annotation_author_id`, яких немає в `users`, а наступний
`pnpm db:generate` згенерує «несподівану» `ADD CONSTRAINT`, яка впаде на вже наявних смітникових
рядках. Порівняйте з `0043:13-14`, де для нової таблиці FK **прописано** — тобто розбіжність
випадкова, не свідома.

**Як правильно.** Не тримати SQL і схему синхронними вручну — генерувати SQL зі схеми (п.2).

### 4. `schema.excerpt.ts:28-30` — `onDelete: 'cascade'` на авторі нотатки видаляє ревʼю

```ts
annotationAuthorId: uuid('annotation_author_id').references(() => users.id, { onDelete: 'cascade' }),
```

**Чому проблема.** Це колонка на таблиці `reviews`. `ON DELETE CASCADE` тут означає: видалили
користувача — **зникло все ревʼю разом із findings** (вони каскадяться з `reviews`,
`schema/reviews.ts:28-31`). Людина пішла з команди → з історії щезли ревʼю агента, до яких вона
колись лишила нотатку. Це протилежність меті фічі, як її описує сам коментар у
`service.ts:11-14` («шість тижнів по тому нотатка — єдине місце, де ця відповідь збереглася»).

У репозиторії вже є прецедент для саме такого випадку — `schema/ci.ts:15-17`:
```ts
ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, { onDelete: 'set null' }),
```

**Як правильно.** `{ onDelete: 'set null' }`. Колонка й так nullable, `toAnnotation`
(`repository.ts:104`) уже віддає `author_id` як nullable — код до цього готовий.

### 5. `repository.ts:24-68` — модуль пише в чужу таблицю (сліпа зона depcruise)

`AnnotationsRepository` робить `select` і два `update` по `t.reviews`:
- `getReview` — `repository.ts:25-31`
- `saveAnnotation` — `repository.ts:39-47`
- `getAnnotation` — `repository.ts:53-60`
- `clearAnnotation` — `repository.ts:64-67`

**Чому проблема.** `reviews` — таблиця модуля `reviews`. Це не здогад, це записано в його ж
репозиторії, `server/src/modules/reviews/repository.ts:5-8`:

> «A2 — review data-access. The **ONLY** layer touching the DB for the review domain. Owns
> `reviews`, `findings`, `pr_intent`…»

І він уже виставлений на композиційному корені як `container.reviewRepo`
(`server/src/platform/container.ts:111-113`) саме для того, щоб у чужу теку не лізли.

`import '../reviews/repository.js'` упав би на `no-cross-module-internals` голосно. Той самий
запит, написаний inline через `container.db`, імпортує лише `db/schema` — і проходить усі
правила. Звʼязаність та сама: форма чужої таблиці тепер ваша, і ламати її теж вам. Різниця
тільки в тому, що збірка залишається зеленою.

Практичний наслідок уже видно: `reviewsForPull` у модулі `reviews`
(`modules/reviews/repository/review.repo.ts`) робить `select()` по `reviews` і мапить рядок у
`ReviewRecord`. Три нові колонки він не мапить — тож обіцянка з `0043:4-5` («нотатка їде з ревʼю
всюди, де ревʼю показують») просто не виконується. Дві команди тепер редагують один рядок.

**Як правильно** (бажаний варіант перший):

- **A.** Винести нотатку у власну таблицю модуля — `review_annotations (review_id PK →
  reviews.id ON DELETE CASCADE, workspace_id, text, author_id, annotated_at)`. Тоді модуль
  `annotations` володіє **своїми** таблицями, `reviews` не чіпає взагалі, один-до-одного
  забезпечує PK, а `DELETE` нотатки стає справжнім `DELETE`, а не «занулити три колонки».
- **B.** Якщо колонки все ж мають лишитися на `reviews` — методи `getReview` / `saveAnnotation` /
  `getAnnotation` / `clearAnnotation` переїжджають у `ReviewRepository`, а сервіс бере його з
  контейнера: `this.container.reviewRepo`. Свій `AnnotationsRepository` лишається тільки для
  `annotation_attachments`.

### 6. `routes.ts:41-54` + `service.ts:46-70` — вкладення без порту зберігання; ліміт і ключ приходять від клієнта

```ts
const { name, content_type, bytes, storage_key } = req.body;
return service.attach(workspaceId, req.params.id, { name, contentType: content_type, bytes, storageKey: storage_key });
```

**Чому проблема.** Файл насправді нікуди не завантажується — ендпоінт лише записує рядок у БД
з тим, що надіслав клієнт. З цього випливає три різні біди:

1. **`bytes` — це заявка клієнта, не факт.** Перевірка `file.bytes > MAX_ATTACHMENT_BYTES`
   (`service.ts:54-56`) обходиться відправкою `bytes: 1`. Ліміт не існує.
2. **`storage_key` — теж від клієнта.** Нічим не обмежений рядок, який стане ключем до обʼєкта
   в сховищі. Можна вказати ключ чужого воркспейсу і прочитати/перезаписати його вміст через
   свій `review_id`. `sanitizeFileName` (`service.ts:65`) чистить `fileName`, але **не**
   `storageKey` — тобто санітизують те поле, яке потім ніде не використовується як шлях.
3. **Порту немає взагалі.** У `server/src/vendor/shared/adapters.ts` є `LLMProvider`, `Embedder`,
   `GitHubClient`, `GitClient`, `CodeIndex`, `AuthProvider`, `SecretsProvider` — і жодного
   `FileStorage`. У `server/src/adapters/` теж нічого (`astgrep, auth, codeindex, depgraph,
   embedder, git, github, llm, secrets, tokenizer`). Скіл вимагає всі чотири кроки:
   інтерфейс у `vendor/shared/adapters.ts` (канонічна серверна копія) → адаптер у `adapters/` →
   лінивий геттер + запис у `ContainerOverrides` у `container.ts` → мок у `adapters/mocks.ts`.
   Пропустити хоч один — зламати шов, і тест на вкладення ніколи не буде юніт-тестом.

**Як правильно.** Оголосити порт (умовно `FileStorage { put(key, stream, contentType), get(key),
delete(key) }`), локальний файловий адаптер під ним, геттер у контейнері, мок. Ендпоінт приймає
**сам файл** (multipart), сервіс сам рахує `byteSize`, сам генерує `storageKey`
(`<workspaceId>/<reviewId>/<uuid>`) і тільки після успішного `put` пише рядок. Клієнт не має
права називати ключ.

---

## Суттєві

### 7. `repository.ts:39-49` — `row!` перетворює 404 на 500, і це не upsert

```ts
const [row] = await this.db.update(t.reviews).set({...}).where(...).returning();
return toAnnotation(row!);
```

**Чому проблема.** `UPDATE ... RETURNING` без збігу дає порожній масив. `row` — `undefined`,
`toAnnotation(row!)` падає на `row.id` з `TypeError` → клієнт бачить 500 замість чесного 404.
Перевірка існування в `service.ts:29-30` це не рятує: між `getReview` і `saveAnnotation` ревʼю
може бути видалене (звичайний TOCTOU), а при варіанті з `onDelete: cascade` з п.4 — тим паче.

Той самий `!` на `repository.ts:76` (`toAttachment(inserted!)`).

Окремо: метод сервіса називається `upsert` (`service.ts:23`), а операція — чистий `UPDATE`.
Якщо піти шляхом 5A (окрема таблиця), тут має бути справжній
`insert().onConflictDoUpdate({ target: reviewId })`, і TOCTOU зникає разом із проблемою.

**Як правильно.** Або `if (!row) throw new NotFoundError('Review not found');`, або справжній
upsert однією командою.

### 8. `repository.ts:94-98` — `deleteAttachment` не скоупиться воркспейсом

```ts
async deleteAttachment(attachmentId: string): Promise<void> {
  await this.db.delete(t.annotationAttachments).where(eq(t.annotationAttachments.id, attachmentId));
}
```

**Чому проблема.** Правило тенансі записане просто в шапці канонічної схеми,
`server/src/db/schema.ts:4-7`: «All queries scope by workspace_id». Тут його немає — знаючи
UUID, можна видалити вкладення чужого воркспейсу. Зараз метод ще й **мертвий**: жодного
виклику ні в `service.ts`, ні в `routes.ts`, тому дірка проходить непоміченою до першого ж
маршруту, який його підключить.

**Як правильно.** `where(and(eq(...workspaceId, workspaceId), eq(...id, attachmentId)))`,
параметр `workspaceId` першим — як у решті методів цього ж файлу. Якщо метод поки не потрібен —
видалити до моменту, коли зʼявиться маршрут (див. п.9).

### 9. Фіча тупикова: вкладення можна додати, але не видалити

`repository.ts:94-98` — метод є. Ні в `service.ts`, ні в `routes.ts` (`routes.ts:8-16` — повний
перелік маршрутів) немає `DELETE /reviews/:id/attachments/:attachmentId`.

**Чому проблема.** Разом із `MAX_ATTACHMENTS_PER_REVIEW` (`service.ts:59-61`, помилка
`too_many_attachments`, 409) це означає: користувач упирається в стелю і не має жодного способу
її звільнити. Помилково прикріпив не той скріншот — все, назавжди.

**Як правильно.** Або додати маршрут + метод сервіса (зі скоупом із п.8), або прибрати
`deleteAttachment` і чесно записати в специфікації, що видалення в L06 немає.

### 10. `service.ts:72-77` — видалення нотатки лишає осиротілі вкладення

`clearAnnotation` занулює три колонки на `reviews`, але рядки в `annotation_attachments`
лишаються і далі показуються через `GET /reviews/:id/attachments`.

**Чому проблема.** Стан «нотатки немає, а файли до неї є» — це не стан, який хтось проєктував;
він просто випав із того, що нотатка живе в колонках, а вкладення — в таблиці (див. п.5).
`GET /reviews/:id/annotation` віддасть `null`, `GET /reviews/:id/attachments` — список файлів
«до нотатки», якої немає.

**Як правильно.** Рішення прийняти явно. Якщо вкладення належать нотатці — видаляти їх у тій
самій транзакції (у варіанті 5A це робить `ON DELETE CASCADE` з `review_annotations`, і код
зникає). Якщо вкладення переживають нотатку — це має бути написано в коментарі методу, а не
випливати з реалізації.

### 11. `service.ts:58-63` — ліміт вкладень без транзакції, гонка проходить

Читання `listAttachments`, потім `insertAttachment` — два окремі раунд-тріпи. Два паралельні
`POST` бачать однакову довжину і обидва вставляють; при ліміті N у базі опиняється N+1.

**Як правильно.** Або одна транзакція з `SELECT ... FOR UPDATE` на батьківському рядку, або
(простіше й надійніше) обмеження на рівні БД. Це не теоретична гонка: UI, що завантажує кілька
файлів одночасно, дає її з першого разу.

### 12. Жоден із 5 маршрутів не оголошує `response`-схему

`routes.ts:21`, `:26-33`, `:35`, `:41-54`, `:56` — скрізь тільки `params` / `body`.

**Чому проблема.** Це не стилістика — в репозиторії є окремо написане пояснення, чому так не
можна, `server/src/modules/_shared/schemas.ts:14-27`:

> «Declaring `schema.response[200]` is not decoration: the serializer validates what leaves the
> process, so a handler that starts returning a raw Drizzle row (with `workspaceId`, internal
> timestamps, …) fails loudly instead of silently widening the public API.»

Ризик тут конкретний, не гіпотетичний: `getAnnotation` (`repository.ts:53-60`) робить
`select()` — тобто **весь** рядок `reviews`. Сьогодні його рятує ручний `toAnnotation`. Варто
комусь спростити мапер або повернути `row` напряму — і `workspace_id`, `agent_id`, `run_id`
поїдуть у публічний API беззвучно.

Для `routes.ts:38` (`return { ok: true }`) готова схема вже лежить поруч і поки не використана
нікде: `OkResponse` (`_shared/schemas.ts:26`).

**Як правильно.** `schema: { params: IdParams, response: { 200: Annotation.nullable() } }` тощо;
самі DTO — з `@devdigest/shared`, як велить коментар у тому ж файлі. Приклади в репозиторії:
`modules/{blast,brief,onboarding,smart-diff}/routes.ts`.

### 13. Контрактів `Annotation` / `AnnotationInput` / `AttachmentRecord` / `AttachmentInput` немає

`routes.ts:3` і `service.ts:1` імпортують їх із `@devdigest/shared`, але в
`server/src/vendor/shared/contracts/` (`brief, eval-ci, findings, knowledge, observability,
platform, productionize, review-api, trace, why`) такого файлу немає, і гілка його не додає.

**Чому проблема.** Без цього гілка не збереться взагалі. І коли файл додаватимуть — діє правило
з `AGENTS.md`: `@devdigest/shared` існує **двічі**; редагується серверна копія, а все, що
перетинає дріт, дзеркалиться в `client/src/vendor/shared`. Тут дріт перетинає все.

**Як правильно.** Новий `server/src/vendor/shared/contracts/annotations.ts` (Zod-first: одна
схема валідує запит і серіалізує відповідь), рядок у барелі, і дзеркальна копія в клієнті —
не тільки серверна.

### 14. `service.ts:32-33`, `:51-53` — валідація дублюється всередині кільця

```ts
const text = input.text.trim();
if (text.length === 0) throw new AppError('empty_annotation', 'Annotation is empty', 422);
...
if (!isAllowedContentType(file.contentType)) throw new AppError('unsupported_type', ..., 422);
```

**Чому проблема.** Правило скіла і `server/AGENTS.md` однакове: парсимо на межі, всередині кілець
дані вже довірені. Порожній рядок і невідомий MIME-тип — це форма вводу, а не бізнес-правило.
Зараз вони проходять Zod, доходять до сервіса і там перетворюються на рукописний 422 — тобто
той самий статус, тільки без деталей помилки, які дає стандартний хендлер.

**Як правильно.** У контракті: `text: z.string().trim().min(1).max(N)` і
`content_type: z.enum([...])`. Тоді сервіс лишає тільки те, що справді бізнес-правило: ліміт
кількості вкладень і перевірка, що ревʼю існує. `MAX_ATTACHMENT_BYTES` теж міг би бути на межі —
але тільки після п.6, коли розмір рахує сервер, а не клієнт.

---

## Дрібніші

### 15. `service.ts:33` — `AppError` там, де є готова `ValidationError`

`server/src/platform/errors.ts:27-31` дає `ValidationError` (код `validation_error`, 422).
Власний код (`empty_annotation`) виправданий тільки якщо клієнт на нього реагує окремо; інакше
це зайвий рядок у неявній таксономії кодів. Для `413` (`service.ts:57`) власний `AppError`
доречний — підкласу немає.

### 16. `schema.excerpt.ts:35-54` — таблиця модуля живе у файлі чужого домену

`annotationAttachments` оголошено в `schema/reviews.ts`. Якщо таблиця належить модулю
`annotations`, їй місце в окремому `server/src/db/schema/annotations.ts` + рядок у барелі
`db/schema.ts:16-28`. Це та сама межа, що й у п.5, тільки на рівні файлів.

### 17. `db/schema.ts` — нову таблицю не додано в обʼєкт `schema`

`export *` її підхопить, але обʼєкт `export const schema = { ... }` (`db/schema.ts:52-95`), яким
типізується drizzle-клієнт, у діфі не змінено. Забути цей рядок — типова причина того, що
relational-queries не бачать таблицю.

### 18. `0043:25-26` — індекс `reviews_annotated_at_idx` не має ні запиту, ні декларації

Жоден метод гілки не фільтрує і не сортує за `annotated_at` (`repository.ts` весь). Індекс
коштує запису на кожному апдейті `reviews` і не використовується. До того ж у
`schema.excerpt.ts:11-33` для `reviews` **немає** блока індексів — тож наступний
`pnpm db:generate` побачить індекс у БД, не побачить у схемі і згенерує `DROP INDEX`.
Або оголосити його в схемі разом із запитом, який його використовує, або не створювати.

### 19. `0043:22-23` проти `repository.ts:83-88` — індекс не тієї форми

Індекс створено на `("review_id")`, а `listAttachments` фільтрує по
`(workspace_id, review_id)`. Конвенція репозиторію — складений тенансі-індекс; є прямий
прецедент: `conventions_repo_idx ON ("workspace_id","repo_id")`
(`0014_conventions_tenant_index.sql:2`, `schema/knowledge.ts:77`).
Має бути `.on(t.workspaceId, t.reviewId)`.

### 20. `schema.excerpt.ts:51` — параметр колбека названо `table`, а не `t`

По всій схемі: `(t) => ({ wsIdx: index('repos_ws_idx').on(t.workspaceId) })`
(`schema/repos.ts:23`, `schema/context.ts:46`, `schema/ops.ts:26`, `schema/knowledge.ts:38`).
Дрібниця, але це один із тих файлів, де однаковість читається з першого погляду.

### 21. `schema.excerpt.ts:35-54` — у вкладень немає автора

Нотатка памʼятає, хто її написав (`annotationAuthorId`), а вкладення — ні. Шапка канонічної
схеми (`db/schema.ts:4-6`) прямо згадує `created_by` «where relevant»; для файлу, який хтось
завантажив, це relevant. Без нього на питання «хто це причепив» відповіді не існує.

### 22. `service.ts:42-44` — `get` не перевіряє існування ревʼю

`GET /reviews/:id/annotation` на неіснуючому `id` віддасть `200 null`, тоді як
`DELETE` на тому ж `id` віддасть 404 (`service.ts:73-74`), а `PUT` — теж 404
(`service.ts:29-30`). Один і той самий ресурс відповідає по-різному залежно від дієслова;
`null` при цьому означає одночасно «ревʼю немає» і «нотатки немає».

### 23. `repository.ts:53-60` — `select()` замість переліку колонок

`getAnnotation` тягне весь рядок `reviews`, щоб прочитати три поля. Поруч, у цьому ж файлі,
`getReview` (`repository.ts:25-31`) робить це правильно — `select({ id, prId })`. Крім
перевитрати, саме звідси приходить ризик протікання з п.12.

### 24. `repository.ts:26` — `prId` вибирається і ніде не використовується

`getReview` повертає `{ id, prId }`, але жоден виклик (`service.ts:29`, `:73`) до `prId` не
звертається. Або воно комусь потрібне — тоді має бути видно кому, або це залишок.

### 25. `routes.ts:46-52` — мапінг wire → домен розписано в хендлері

Розпаковка чотирьох полів і перейменування в camelCase просто в тілі маршруту означає, що
кожне нове поле вкладення редагує `routes.ts`. Порівняйте з `PUT` поруч (`routes.ts:31`), який
віддає `req.body` цілком. Мапер належить у `helpers.ts` (чисті трансформації) або сервіс має
приймати розпарсене тіло як є.

### 26. `routes.ts:41` — запис без пер-роутного ліміту

У `modules/reviews/routes.ts:26-30` дорогі записи мають власний
`config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`. Ендпоінт, який після п.6 почне
приймати файли, тим більше має свій ліміт, а не тільки глобальний (який, до речі, вимкнено при
`NODE_ENV=test` — `server/AGENTS.md`).

### 27. `src/modules/index.ts` — модуль не зареєстровано

У реєстрі (`server/src/modules/index.ts:1-46`) немає ні імпорту `annotations/routes.js`, ні
запису в обʼєкті `modules`. Файл не входить у діф — можливо, забутий. Без нього плагін не
монтується, і жоден з пʼяти маршрутів не існує. Реєстрація статична навмисно — додається
рівно один імпорт + один рядок.

### 28. `helpers.ts` і `constants.ts` у діфі відсутні

`service.ts:5-6` імпортує `sanitizeFileName`, `isAllowedContentType`,
`MAX_ATTACHMENTS_PER_REVIEW`, `MAX_ATTACHMENT_BYTES`. За чеклістом скіла `constants.ts` і
`types.ts` — **публічна поверхня** модуля (єдине, що інший модуль має право імпортувати), а
`helpers.ts` — чисті трансформації. Перевірити, що ці файли є, що в `constants.ts` лише
літерали, і що `sanitizeFileName` справді чиста (їй знадобиться свій юніт-тест — без контейнера).

### 29. Тестів немає жодних

У гілці немає ні `test/…annotations…`, ні `*.it.test.ts`. Мінімум, який тут напрошується:
чиста функція `sanitizeFileName` — звичайний юніт без контейнера; репозиторій — `*.it.test.ts`
(глоб, за яким CI розділяє юніт- та інтеграційну доріжки, — точний, назва має закінчуватись
саме так); сервіс — через `new Container(config, db, {...})` з `ContainerOverrides`, а не
`vi.mock` шляху модуля.

---

## Що робити далі (порядок)

1. Полагодити збірку: імпорти схеми (п.1) і контракти в обох копіях `vendor/shared` (п.13),
   зареєструвати модуль (п.27).
2. Прийняти рішення по п.5 — окрема таблиця `review_annotations` чи `container.reviewRepo`.
   Від нього залежать п.7, 10, 16, 17. Рекомендую окрему таблицю.
3. Переробити вкладення під порт зберігання (п.6) — це і є фіча «прикріпити файли»; зараз її
   фактично немає.
4. Перегенерувати міграцію через `pnpm db:generate` (п.2), що заодно закриє п.3, 18, 19.
5. `onDelete: 'set null'` (п.4), скоуп у `deleteAttachment` (п.8), `response`-схеми (п.12).
6. Тести (п.29) — після того, як шов із п.6 зʼявиться; до нього сервіс вкладень не мокається.
