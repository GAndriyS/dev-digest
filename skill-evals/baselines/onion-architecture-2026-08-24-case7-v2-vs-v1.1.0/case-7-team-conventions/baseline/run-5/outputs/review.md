# Ревʼю гілки `annotations` (перед мерджем)

Обсяг: `.claude/skills/onion-architecture/evals/fixtures/annotations-branch/` —
`0043_review_annotations.sql`, `schema.excerpt.ts`, `routes.ts`, `service.ts`, `repository.ts`.
Перевірено проти реального репозиторію (`server/src/**`) і правил оніон-архітектури DevDigest.

Вердикт: **не мерджити як є**. Є 5 блокерів (гілка або не збереться, або міграція не
застосується, або ламає чужий домен), 9 важливих і 6 дрібних зауважень.

Що зроблено правильно (щоб не переробили): розкладка `routes → service → repository`
відповідає чеклісту модуля; сервіс приймає розвʼязані значення (`workspaceId`, `userId`,
`reviewId`), а не `FastifyRequest`; `getContext` викликається на кожному роуті; жоден
конкретний адаптер не конструюється в модулі; `IdParams` валідує `:id` на едж-шарі.

---

## Блокери

### 1. Модуль пише в чужу таблицю — `repository.ts:24-68`

`AnnotationsRepository.getReview` (24), `saveAnnotation` (34-50), `getAnnotation` (52-61) і
`clearAnnotation` (63-68) читають і мутують `t.reviews` — таблицю модуля `reviews`.

Чому це проблема: `server/src/modules/reviews/repository.ts` у своєму ж хедері оголошує себе
«The ONLY layer touching the DB for the review domain. Owns `reviews`, `findings`, `pr_intent`…».
Зараз форма рядка `reviews` належить двом модулям одночасно: будь-яка зміна в домені reviews
(перейменування колонки, звуження `select`, зміна скоупінгу) тихо ламає анотації.

Окремо небезпечно те, що **CI цього не побачить**. `no-cross-module-internals`
(`server/.dependency-cruiser.cjs:83-97`) ловить `import '../reviews/repository.js'`. Тут імпорту
немає — модуль тягне тільки `db/schema`, що дозволено всюди. Звʼязність та сама, збірка зелена.

Як правильно: додати методи анотацій до `ReviewRepository` (він уже композує підрепозиторії в
`modules/reviews/repository/`) і брати його з композиційного кореня —
`container.reviewRepo` (`server/src/platform/container.ts:111-113`, поруч із `agentsRepo`, які
там саме для цього). `AnnotationsRepository` лишити власником одного `annotation_attachments`.
Якщо потрібного методу в `ReviewRepository` немає — це і є зміна, яку треба зробити.

### 2. Схема імпортує файли, яких не існує — `schema.excerpt.ts:6-9`

```ts
import { workspaces } from './workspaces.js';
import { pullRequests } from './pull-requests.js';
import { users } from './users.js';
import { now } from './_shared.js';
```

Реальний розклад `server/src/db/schema/`: `workspaces` і `users` живуть у `./core`,
`pullRequests` — у `./pulls`, і всі домен-файли імпортують **без розширення `.js`**
(див. `server/src/db/schema/reviews.ts:3-5`). Файлів `workspaces.ts`, `pull-requests.ts`,
`users.ts` немає. Гілка не тайпчекнеться.

Як правильно: `from './core'`, `from './pulls'`, `from './_shared'`.

### 3. Міграція ніколи не застосується — `0043_review_annotations.sql`

`server/src/db/migrate.ts:31` викликає drizzle-міграторний `migrate()`, який іде по
`src/db/migrations/meta/_journal.json`. Останній запис там — `idx: 17`, тег
`0017_shallow_swordsman`; поруч лежить `meta/0017_snapshot.json`. Рукописний SQL без запису в
журналі й без снапшота мігратор просто не бачить: `pnpm db:migrate` вийде з кодом 0, не
застосувавши нічого, а сервіс упаде вже на рантаймі («column annotation_text does not exist»).

Плюс номер: наступний вільний — `0018`, а не `0043`.

Як правильно (`server/AGENTS.md:28-29`): змінити схему → `pnpm db:generate` → за потреби
перейменувати згенерований файл у змістовну назву (так зроблено з
`0012_conventions_candidate_fields.sql`) → закомітити SQL **разом із** `meta/_journal.json` і
`meta/00NN_snapshot.json`.

### 4. `onDelete: 'cascade'` на автора анотації — `schema.excerpt.ts:28-30`

```ts
annotationAuthorId: uuid('annotation_author_id').references(() => users.id, {
  onDelete: 'cascade',
}),
```

FK-каскад видаляє **рядок-носій**, а не колонку. Тобто видалення користувача знищить усі
`reviews`, які він анотував — разом із вердиктом агента, `summary`, `score` і (через
`findings.review_id … ON DELETE CASCADE`, `db/schema/reviews.ts:29-31`) усіма findings. Це прямо
суперечить меті фічі, описаній у шапці міграції: «нотатка живе разом з ревʼю».

Як правильно: `onDelete: 'set null'`. Порівняйте з конвенцією репозиторію для «хто створив»:
`repos.createdBy` (`db/schema/repos.ts:18`) і `agents.createdBy` (`db/schema/agents.ts:34`) —
`references(() => users.id)` взагалі без каскаду.

Тут же **розбіжність SQL і схеми**: у міграції (рядок 8) колонка додана як
`ADD COLUMN "annotation_author_id" uuid` — без жодного `REFERENCES`. Тобто навіть якби міграція
застосувалася, FK у БД не було б, а `db:generate` наступного разу згенерував би `ADD CONSTRAINT`.

### 5. Індекс є в SQL, але не в схемі — `0043_review_annotations.sql:25-26` vs `schema.excerpt.ts:11-33`

```sql
CREATE INDEX IF NOT EXISTS "reviews_annotated_at_idx" ON "reviews" ("annotated_at");
```

Таблиця `reviews` у Drizzle-схемі індексів не оголошує зовсім. Drizzle-схема — джерело істини
для `db:generate`, тож наступна згенерована міграція побачить «в БД є індекс, у схемі немає» і
випише `DROP INDEX "reviews_annotated_at_idx"`. Індекс тихо зникне при першому ж наступному
генеруванні.

Як правильно: оголосити індекс у третьому аргументі `pgTable` для `reviews` (стиль репозиторію —
обʼєкт: `(t) => ({ annotatedAtIdx: index('reviews_annotated_at_idx').on(t.annotatedAt) })`,
див. `db/schema/context.ts:46` і `db/schema/core.ts:45-47`). Або, якщо індекс не потрібен, —
прибрати з SQL.

---

## Важливі

### 6. Нова таблиця не зареєстрована в барелі — `schema.excerpt.ts:35`

`server/src/db/schema.ts` не лише робить `export *`, а ще й збирає явний обʼєкт `schema` (рядки
29-46 імпортів + перелік до кінця файлу) — саме він типізує drizzle-клієнт. `annotationAttachments`
там немає.

Як правильно: додати `annotationAttachments` в імпорт `from './schema/reviews'` і в обʼєкт `schema`.

### 7. Модуль не підключено — відсутній запис у `src/modules/index.ts`

У діффі немає зміни `server/src/modules/index.ts`. Реєстрація там статична **навмисно**
(коментар у файлі: динамічний `import()` `.ts` не портується між tsx, бандлером і vitest).
Без одного імпорту + одного запису в `modules` жоден із пʼяти роутів не існуватиме.

Як правильно: `import annotations from './annotations/routes.js';` + `annotations,` у `modules`.

### 8. Контрактів `@devdigest/shared` не існує — `routes.ts:3`, `service.ts:1`, `repository.ts:2`

`AnnotationInput`, `AttachmentInput`, `Annotation`, `AttachmentRecord` у
`server/src/vendor/shared/contracts/` відсутні (грепом по всій теці — нічого), у
`client/src/vendor/shared/` теж. Гілка на них спирається, але їх не приносить.

Як правильно: додати контракти в **канонічну серверну копію** (`server/src/vendor/shared`,
найімовірніше новий `contracts/annotations.ts` + реекспорт), і **обовʼязково дзеркалити** в
`client/src/vendor/shared` — типи перетинають дріт (клієнт шле `AnnotationInput`). Правило
«редагуй серверну копію, потім дзеркаль» — з `AGENTS.md`; одностороння правка вже колись
розʼїхалась.

### 9. Жоден роут не оголошує `response`-схему — `routes.ts:21,26,35,41,56`

`server/src/modules/_shared/schemas.ts:14-27` описує це як конвенцію дослівно: «Declaring
`schema.response[200]` is not decoration: the serializer validates what leaves the process, so a
handler that starts returning a raw Drizzle row (with `workspaceId`, internal timestamps, …)
fails loudly instead of silently widening the public API».

Ризик тут не теоретичний: `repository.ts:52-56` робить `select()` по всій таблиці `reviews`, і
досить одного недогляду в мапері, щоб у відповідь поїхали внутрішні поля.

Як правильно: `response: { 200: Annotation.nullable() }` для GET, `{ 200: Annotation }` для PUT,
`{ 200: AttachmentRecord }` для POST, `{ 200: z.array(AttachmentRecord) }` для GET-списку. Готові
приклади — `modules/brief/routes.ts:43,53` і `modules/onboarding/routes.ts:30,48`.

### 10. `{ ok: true }` руками замість `OkResponse` — `routes.ts:38`

Для «дій, чий результат — лише успіх/невдача» у `_shared/schemas.ts:26-27` є експортована
`OkResponse`. Використати її як `response: { 200: OkResponse }`, а не літерал.

### 11. Мапінг полів у хендлері — `routes.ts:46-52`

```ts
const { name, content_type, bytes, storage_key } = req.body;
return service.attach(workspaceId, req.params.id, {
  name, contentType: content_type, bytes, storageKey: storage_key,
});
```

Роут — це транспорт: розпарсити, викликати, серіалізувати. Перейменування snake_case → camelCase
— це трансформація, і вона тут єдина причина, чому хендлер має тіло довше за один рядок.

Як правильно: чиста функція в `helpers.ts` модуля (`toAttachmentInput(body)`), або сервіс приймає
контрактну форму як є і розкладає її сам. Тоді роут стає `return service.attach(workspaceId,
req.params.id, req.body)`.

### 12. `attach` не перевіряє існування й належність ревʼю — `service.ts:46-70`

`upsert` робить це правильно (`service.ts:29-30`: `getReview` → `NotFoundError`). `attach` —
ні: одразу перевіряє тип/розмір і вставляє.

Наслідки: (а) неіснуючий `reviewId` дасть помилку FK з БД, тобто 500 замість чистого 404;
(б) чужий `reviewId` (uuid іншого воркспейсу) пройде FK і створить рядок, у якого
`workspace_id` — ваш, а `review_id` вказує на ревʼю іншого тенанта. Читання скоупиться по
`workspaceId`, тож витоку назовні немає, але цілісність даних порушена, і будь-який пізніший
джойн `annotation_attachments → reviews` дасть змішані тенанти.

Як правильно: першим рядком `attach` — перевірка ревʼю в межах `workspaceId` (після фікса №1 —
через `container.reviewRepo`), з `NotFoundError`.

### 13. Файлові вкладення без порту й без адаптера — `routes.ts:41-54`, `service.ts:46-70`

Клієнт присилає `storage_key` і `bytes`, сервер кладе їх у БД як є. Тобто:

- `MAX_ATTACHMENT_BYTES` (`service.ts:54`) перевіряє **число, яке надіслав клієнт**, а не
  реальний розмір обʼєкта. Ліміт обходиться зміною одного поля в JSON.
- `storage_key` — теж клієнтський. Сервер ніколи не перевіряє, що обʼєкт існує і що він належить
  цьому воркспейсу; рядок у БД може вказувати на чужий обʼєкт у сховищі.
- Сховище файлів — це I/O, тобто інфраструктура. Зараз його в архітектурі немає взагалі.

Як правильно: якщо файли справді десь зберігаються, це порт — усі **чотири** кроки, інакше шов
зламаний: інтерфейс (`BlobStore`) у `server/src/vendor/shared/adapters.ts` (канонічна копія),
адаптер у `server/src/adapters/`, лінивий геттер із перевіркою `overrides.<x>` **першою** +
запис у `ContainerOverrides` у `platform/container.ts`, мок у `adapters/mocks.ts`. Сервіс тоді
питає розмір і власника у порту, а не в тіла запиту. Без цього `attach` неможливо
протестувати без реального сховища.

Окремо: якщо геттер читатиме ключ доступу через `SecretsProvider`, він має бути `async`, а поле
кешу — додане в `container.invalidateSecretCaches()` (єдиний виклик —
`modules/settings/routes.ts`). Список там чиститься **вручну**, це не свіп; забутий кеш дає не
стектрейс, а тікет підтримки: користувач вставив новий ключ, UI підтвердив збереження, а
процес досі ходить зі старим.

### 14. `deleteAttachment` не скоупиться по воркспейсу і мертвий — `repository.ts:94-98`

```ts
await this.db.delete(t.annotationAttachments).where(eq(t.annotationAttachments.id, attachmentId));
```

Правило репозиторію в чеклісті модуля: кожен запит скоупиться `workspaceId`. Це єдиний метод
файлу, який його не має. Метод при цьому нізвідки не викликається — ні сервіс, ні роут його не
знають, тобто зараз він просто чекає, поки хтось викличе його без скоупу.

Як правильно: або прибрати до появи роута `DELETE /attachments/:id`, або одразу
`and(eq(workspaceId, ...), eq(id, ...))`.

### 15. Видалення нотатки лишає вкладення сиротами — `service.ts:72-77`, схема

`annotation_attachments.review_id` посилається на `reviews`, а не на нотатку. `removeAnnotation`
чистить три колонки в `reviews` і зупиняється. Після цього `GET /reviews/:id/attachments`
продовжує повертати файли нотатки, якої вже немає, а `GET .../annotation` віддає `null`. UI
покаже вкладення без нотатки.

Як правильно: вирішити явно — або `clearAnnotation` і видалення вкладень в одній транзакції,
або задокументувати (і в контракті, і в UI), що вкладення живуть на ревʼю, а не на нотатці.
Зараз це не рішення, а недогляд.

---

## Дрібні

### 16. `row!` після UPDATE — `repository.ts:49` (і `:76`)

`saveAnnotation` робить `update(...).returning()` і одразу `toAnnotation(row!)`. Між `getReview`
у сервісі (`service.ts:29`) і цим UPDATE ревʼю може зникнути — тоді `row` це `undefined`,
`row!.id` кидає TypeError і користувач отримує 500 замість 404.

Як правильно: `if (!row) throw new NotFoundError('Review not found');` (або повертати `null` і
дати сервісу кинути помилку — але не `!`).

### 17. `select()` по всій таблиці — `repository.ts:52-56`

`getAnnotation` тягне всі колонки `reviews`, щоб узяти три. `getReview` поруч (рядок 26) уже
показує правильний стиль — явний список колонок. Заодно це прибирає ризик з п.9.

### 18. Індекс не збігається з формою запитів — `schema.excerpt.ts:52`, `0043…sql:22-23`

Індекс лише по `review_id`, тоді як обидва читальні запити (`repository.ts:83-89`) фільтрують
`(workspace_id, review_id)`. Композитний індекс по обох колонках відповідатиме запиту. Прецедент
у репозиторії — окрема міграція `0014_conventions_tenant_index.sql`.

### 19. Кастомна помилка замість наявної таксономії — `service.ts:33`

`new AppError('empty_annotation', 'Annotation is empty', 422)` при тому, що
`platform/errors.ts:26-30` має `ValidationError` (той самий 422, код `validation_error`).
Кастомний код виправданий, лише якщо клієнт справді на нього реагує окремо — тоді він має бути
в контракті. Інакше — `ValidationError`.

### 20. POST повертає 200 замість 201 і не має свого rate limit — `routes.ts:41-54`

Створення ресурсу: конвенція модуля `repos` — `reply.status(created ? 201 : 200)`. І роут пише
рядок у БД на кожен виклик, а per-route ліміту не має; порівняйте з `modules/reviews/routes.ts`,
де дорогий роут несе `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`.

### 21. `helpers.ts` і `constants.ts` не в діффі — `service.ts:5-6`

Сервіс імпортує `sanitizeFileName`, `isAllowedContentType`, `MAX_ATTACHMENTS_PER_REVIEW`,
`MAX_ATTACHMENT_BYTES`, але цих файлів у наборі немає. Треба переконатися, що вони існують, і
окремо перевірити `sanitizeFileName` — `file_name` приходить від клієнта і потрапляє в БД, тож
там мають бути зняті сегменти шляху (`../`, `/`, NUL) і обмежена довжина.

---

## Порядок виправлень

1. № 3, 2, 6, 7, 8 — без них гілка просто не працює (не збереться / не змігрує / не підніметься).
2. № 4, 5 — цілісність даних і дрейф схеми; виправляти одним `db:generate`, разом з №3.
3. № 1 — структурна: винести роботу з `reviews` на `container.reviewRepo`. Тягне за собою №12 і №17.
4. № 13 — визначитися з портом сховища до мерджу: пізніше це переписування контракту, а не рефакторинг.
5. Решта — по ходу.

Окрема примітка: `depcruise` на цій гілці, найімовірніше, буде зелений. №1, №13 і №15 він не
бачить принципово — це не імпорти, а пропуски. Не сприймайте зелений CI як підтвердження.
