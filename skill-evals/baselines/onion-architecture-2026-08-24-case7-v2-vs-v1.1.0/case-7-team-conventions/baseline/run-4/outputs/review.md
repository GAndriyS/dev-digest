# Ревʼю гілки `annotations` (L06) — перед мерджем

Перевірено: `0043_review_annotations.sql`, `schema.excerpt.ts`, `routes.ts`,
`service.ts`, `repository.ts` у
`.claude/skills/onion-architecture/evals/fixtures/annotations-branch/`.
Номери рядків — по цих файлах.

**Головне наперед:** `depcruise` на цій гілці буде зелений. `routes.ts` імпортує
лише сервіс, `service.ts` не тягне Fastify, `repository.ts` бере `db/schema` —
жодне правило з `server/.dependency-cruiser.cjs` не спрацює. Усе, що нижче,
конфіг не бачить у принципі (це імпорти, а тут — відсутність імпорту, пропуск у
списку або SQL). Зелена CI тут нічого не доводить.

Вердикт: **не мерджити** — є 5 блокерів, з них два (№3 і №4) означають, що фіча
або взагалі не працюватиме на чистій БД, або втратить дані.

---

## Блокери

### 1. Модуль пише в чужу таблицю — `repository.ts:24-32, 39-50, 52-61, 63-68`

`AnnotationsRepository` читає й оновлює `t.reviews`. Це таблиця модуля
`reviews`, у якого вже є власний репозиторій, і він **уже виставлений на
контейнері**: `server/src/platform/container.ts:111-113` (`get reviewRepo()`),
поруч з `agentsRepo` і `skillsRepo` — саме для таких випадків.

Чому це проблема, хоч CI мовчить: імпорт `../reviews/repository.js` впав би на
`no-cross-module-internals` голосно. Той самий запит, написаний інлайн через
`container.db`, імпортує тільки `db/schema` — легально звідусіль і рівно так
само зчеплено. Шейп `reviews` тепер належить двом модулям: reviews не може
перейменувати чи прибрати колонку, не зламавши annotations, і не дізнається про
це до рантайму.

Як правильно (два варіанти, обидва прийнятні):

- **Власна таблиця.** `review_annotations (review_id uuid PK REFERENCES
  reviews(id) ON DELETE CASCADE, workspace_id, text, author_id, annotated_at)`.
  Тоді annotations володіє своїми даними, `reviews` взагалі не змінюється, а
  `saveAnnotation` стає чесним `INSERT ... ON CONFLICT (review_id) DO UPDATE`
  замість UPDATE по чужому рядку. Це також лікує №4 і №18 нижче.
- **Мінімум:** якщо колонки таки лишаються на `reviews`, то читання/запис іде
  через `container.reviewRepo` (додати туди `getAnnotation`/`saveAnnotation`/
  `clearAnnotation`), а `AnnotationsRepository` володіє лише
  `annotation_attachments`. Перевірку існування рев'ю (`service.ts:29`) теж
  забрати з власного репозиторію на `container.reviewRepo`.

Зараз `repository.ts:24-32` (`getReview`) — це буквально дублікат
`reviews/repository.ts:69-71`, лише з workspace-скоупом.

### 2. `deleteAttachment` без `workspaceId` — `repository.ts:94-98`

```ts
async deleteAttachment(attachmentId: string): Promise<void> {
  await this.db.delete(t.annotationAttachments).where(eq(t.annotationAttachments.id, attachmentId));
}
```

Правило репозиторію: *кожен* запит скоупиться по `workspaceId` — це записано і в
чеклісті нового модуля, і в шапці `server/src/db/schema.ts` («All queries scope
by workspace_id»). Решта методів цього ж файлу скоуп мають; цей — ні. З UUID у
руках сусідній воркспейс видаляє чуже вкладення.

Друга частина проблеми: метод **ніхто не викликає** — ні `service.ts`, ні
`routes.ts` (роута `DELETE /attachments/:id` не існує). Тобто це або незавершена
дірка, або мертвий код. Обидва варіанти треба закрити свідомо: або
`deleteAttachment(workspaceId, attachmentId)` + роут + метод сервісу, або
прибрати метод.

Правильно:

```ts
async deleteAttachment(workspaceId: string, attachmentId: string): Promise<boolean> {
  const rows = await this.db.delete(t.annotationAttachments)
    .where(and(eq(t.annotationAttachments.workspaceId, workspaceId),
               eq(t.annotationAttachments.id, attachmentId)))
    .returning({ id: t.annotationAttachments.id });
  return rows.length > 0;
}
```

(так само, як `reviews/repository/review.repo.ts:83-93`).

### 3. Міграція ніколи не застосується — `0043_review_annotations.sql` (весь файл)

Дві незалежні поломки:

1. **Номер поза послідовністю.** Остання міграція в репо —
   `server/src/db/migrations/0017_shallow_swordsman.sql`. Тут `0043`.
2. **Нема запису в журналі.** `server/src/db/migrate.ts:31` викликає
   `migrate(db, { migrationsFolder })` з `drizzle-orm/postgres-js/migrator`, а
   той читає `src/db/migrations/meta/_journal.json`, а не вміст каталогу. Файлу,
   якого нема в журналі, для мігратора не існує.

Наслідок найгірший з можливих: `pnpm db:migrate` відпрацює, надрукує
`✓ migrations applied` і вийде з кодом 0 — при цьому колонок і таблиці в БД не
буде. Впаде вже застосунок, у рантаймі, з помилкою про невідому колонку.

Ручні (не згенеровані) міграції в цьому репо існують —
`0012_conventions_candidate_fields`, `0013_conventions_drop_accepted`,
`0014_conventions_tenant_index` — і кожна має свій запис у `_journal.json`
(`idx` 12, 13, 14). Правильно: `pnpm db:generate` (конвенція з
`server/AGENTS.md`), або, якщо SQL пишеться руками, — наступний вільний номер
`0018_...` **плюс** запис `{ idx, version: "7", when, tag, breakpoints: true }`
у журнал.

### 4. `ON DELETE CASCADE` на авторі нотатки — `schema.excerpt.ts:28-30` проти `0043_review_annotations.sql:8`

Тут одразу два дефекти.

**Дрифт схеми й міграції.** Drizzle оголошує зовнішній ключ:

```ts
annotationAuthorId: uuid('annotation_author_id').references(() => users.id, { onDelete: 'cascade' }),
```

а SQL додає колонку без жодного `REFERENCES`:

```sql
ALTER TABLE "reviews" ADD COLUMN "annotation_author_id" uuid;
```

Тобто в БД констрейнта не буде, а наступний `pnpm db:generate` у когось іншого
згенерує «зайву» міграцію, що його додає. Дві версії правди про одну колонку.

**Сам каскад — втрата даних.** Якщо цей FK таки доїде до БД у вигляді, як
написано в Drizzle, то видалення користувача видалить **увесь рядок `reviews`** —
разом з вердиктом, summary, score, і разом з `findings`, які каскадять від
`reviews` (`server/src/db/schema/reviews.ts:29-31`). Тобто звільнився інженер,
який колись лишив нотатку, — і з БД зникло рев'ю агента з усіма знахідками.
Це рівно навпаки до того, навіщо фіча існує («шість тижнів потому нотатка —
єдине місце, де ця відповідь вижила», `service.ts:8-15`).

Правильно: `onDelete: 'set null'` і в Drizzle, і в SQL. Колонка nullable, тип
`Annotation.author_id` уже допускає null (`repository.ts:105`) — код до цього
готовий. Порівняй з `annotation_attachments.review_id`, де `CASCADE` доречний,
бо вкладення без рев'ю не має сенсу.

### 5. Файлове сховище без порту й адаптера — `routes.ts:41-54`, `service.ts:46-70`

Фіча називається «прикріпити файли», але жоден файл ніде не зберігається. Роут
приймає від клієнта готовий `storage_key`, `bytes` і `content_type`, а сервіс
перевіряє ліміт (`service.ts:54`) саме за клієнтським `bytes`. Тобто:

- перевірка розміру не перевіряє нічого — клієнт надішле `bytes: 1`;
- `content_type` — теж заявка клієнта, а не факт;
- `storage_key` задає клієнт, тобто клієнт вирішує, куди/на що вказує запис;
- сама операція запису у сховище просто відсутня в гілці.

Робота з файловим сховищем — це інфраструктура, а в цьому бекенді інфраструктура
живе за портом. Портів зараз сім (`server/src/vendor/shared/adapters.ts`:
`LLMProvider`, `Embedder`, `GitHubClient`, `GitClient`, `CodeIndex`,
`AuthProvider`, `SecretsProvider`) — сховища серед них нема, і гілка його не
додає.

Правильно — усі чотири кроки, інакше шов зламаний:

1. `interface FileStorage { put(key, bytes, contentType): Promise<...>; get(key): ...; delete(key): ... }` у `server/src/vendor/shared/adapters.ts` (канонічна копія);
2. адаптер у `server/src/adapters/storage/<impl>.ts`;
3. lazy-getter з `??=`, перевіркою `overrides.storage` **першою** і записом у
   `ContainerOverrides` у `server/src/platform/container.ts`;
4. `MockFileStorage` у `server/src/adapters/mocks.ts`.

І сервіс має отримувати самі байти (multipart), сам генерувати `storageKey`,
класти через порт, і писати в БД **реальний** розмір і content-type того, що
записалося. Без п.4 жоден тест `attach()` не напишеться без справжнього сховища.

---

## Важливе (не блокує мердж, але має бути виправлене в цій же гілці)

### 6. `row!` перетворює 404 на 500 — `repository.ts:49` і `repository.ts:76`

```ts
.returning();
return toAnnotation(row!);
```

`service.ts:29-30` перевіряє існування рев'ю окремим запитом, потім
`saveAnnotation` робить UPDATE. Між ними рядок може зникнути — у модулі reviews
є `DELETE /reviews/:id` (`server/src/modules/reviews/routes.ts:151`). Тоді
`returning()` віддасть порожній масив, `toAnnotation(undefined)` кине
`TypeError` і клієнт отримає 500 замість чесного 404.

Правильно: `if (!row) throw new NotFoundError('Review not found');` — або, у
варіанті з власною таблицею (№1), `INSERT ... ON CONFLICT DO UPDATE`, який
завжди повертає рядок і взагалі знімає гонку.

Те саме на `:76` для `insertAttachment`.

### 7. `select()` без проекції по чужій таблиці — `repository.ts:52-61`

`getAnnotation` тягне весь рядок `reviews` (verdict, summary, score, model,
run_id...) щоб віддати три поля. Сусідній `getReview` (`:25-29`) робить
правильно — з проекцією. Крім зайвих даних це ще й розширює зчеплення з чужою
таблицею з №1: тип результату тепер `typeof t.reviews.$inferSelect` цілком.

Правильно: `.select({ id: t.reviews.id, annotationText: ..., annotationAuthorId: ..., annotatedAt: ... })`.

### 8. Жодна ручка не оголошує `schema.response` — `routes.ts:21, 26, 35, 41, 56`

`server/src/modules/_shared/schemas.ts:14-27` пояснює, навіщо це потрібно:
серіалізатор валідує те, що **виходить** з процесу, тож хендлер, який почне
віддавати сирий Drizzle-рядок з `workspaceId` і внутрішніми таймстемпами, впаде
голосно, а не розширить публічний API мовчки. Свіжі модулі так і роблять —
`brief/routes.ts:43,53`, `onboarding/routes.ts:30,48`.

Тут це особливо доречно, бо репозиторій ліпить DTO з повного рядка `reviews`
(див. №7) — рівно та ситуація, від якої response-схема страхує. Коментарі в
`smart-diff/routes.ts:11` і `blast/routes.ts:18` («no route in this codebase
declares one») застаріли — не орієнтуйтеся на них.

Окремо `routes.ts:38` повертає `{ ok: true }` — для цього вже є готовий
`OkResponse` у тому ж `_shared/schemas.ts:26`.

### 9. Порожній текст валідується в сервісі, а не на межі — `service.ts:32-33`

```ts
const text = input.text.trim();
if (text.length === 0) throw new AppError('empty_annotation', 'Annotation is empty', 422);
```

Правило — parse at the boundary: усередині кілець дані вже довірені.
`AnnotationInput` у `@devdigest/shared` має нести `z.string().trim().min(1)`,
тоді порожня нотатка 422-иться до входу в хендлер, однією схемою, і клієнт
бачить стандартну помилку валідації, а не свій окремий код `empty_annotation`.
`trim()` у сервісі можна лишити як нормалізацію, але порожній рядок не має туди
доходити.

### 10. Мапінг полів у хендлері — `routes.ts:46-52`

```ts
const { name, content_type, bytes, storage_key } = req.body;
return service.attach(workspaceId, req.params.id, {
  name, contentType: content_type, bytes, storageKey: storage_key,
});
```

Роут — транспорт: розпарсити, викликати, серіалізувати. Перейменування полів —
чиста трансформація, її місце `helpers.ts` (модуль його вже має —
`service.ts:5`) або `.transform()` у самій Zod-схемі `AttachmentInput`. Порівняй
з `repos/routes.ts`, де хендлер передає `req.body.url` як є.

### 11. `schema.excerpt.ts` не збереться — `schema.excerpt.ts:5-9`

```ts
import { workspaces } from './workspaces.js';
import { pullRequests } from './pull-requests.js';
import { users } from './users.js';
import { now } from './_shared.js';
```

Жодного з цих трьох файлів не існує. Реально: `users` і `workspaces` — у
`server/src/db/schema/core.ts` (`:6`, `:13`), `pullRequests` — у
`server/src/db/schema/pulls.ts`. І всі імпорти в `src/db/schema/*.ts` — **без**
розширення `.js` (див. `schema/reviews.ts:3-5`: `from './_shared'`, `from
'./core'`, `from './pulls'`). Має бути:

```ts
import { now } from './_shared';
import { workspaces, users } from './core';
import { pullRequests } from './pulls';
```

Якщо це просто артефакт вирізки — перевірте оригінал; якщо ні, гілка не
проходить `tsc`.

### 12. Нову таблицю не додано в об'єкт `schema` — `schema.excerpt.ts:35-54`

`server/src/db/schema.ts` не лише реекспортує доменні файли (`export * from
'./schema/reviews'`), а й збирає **іменований об'єкт `schema`** з переліком усіх
таблиць — він іде в `drizzle()` для типізації клієнта. `annotationAttachments`
у ньому нема. Барель підхопить символ, `schema` const — ні. Додати і в імпорт
(`import { reviews, findings, prIntent, prBrief } from './schema/reviews'`), і в
сам об'єкт.

### 13. Контрактів у `@devdigest/shared` не існує — `routes.ts:3`, `service.ts:1`, `repository.ts:2`

Гілка імпортує `AnnotationInput`, `AttachmentInput`, `Annotation`,
`AttachmentRecord` з `@devdigest/shared`, але жодного з цих імен нема ні в
`server/src/vendor/shared/`, ні в `client/src/vendor/shared/`. У вирізці цих
змін теж нема.

Це wire-crossing контракт (клієнт малює нотатку і список вкладень), тож правило
двох копій діє в повному обсязі: додати в **серверну** копію (канонічну) і
віддзеркалити в клієнтську. Редагувати лише одну — гарантований дрифт (клієнтська
копія вже й так розійшлася з серверною).

### 14. Модуль не зареєстрований — `server/src/modules/index.ts`

У вирізці нема одного імпорту + одного запису в `modules`. Реєстрація тут
статична навмисно (динамічний `import()` `.ts` не портується між tsx, бандлером
і vitest). Без цього роутів просто не існує, а `depcruise` ще й позначить нові
файли як `no-orphans` (severity `warn` — не зупинить CI).

### 15. Ліміт вкладень має гонку — `service.ts:58-61` + `repository.ts:79-92`

`listAttachments` тягне всі рядки цілком (`select()` без проекції), щоб
порахувати довжину, і лише потім іде INSERT. Два паралельні POST на межі ліміту
пройдуть обидва. Мінімум — `count()` замість вивантаження рядків; надійно —
робити перевірку і вставку в одній транзакції або покласти обмеження на БД.

### 16. Індекси — `0043_review_annotations.sql:22-26`

- `annotation_attachments_review_idx` тільки по `review_id`, тоді як
  єдиний запит по цій таблиці фільтрує по `(workspace_id, review_id)`
  (`repository.ts:83-89`). Конвенція тенант-індексів у репо вже є —
  `0014_conventions_tenant_index.sql`. Має бути складений
  `(workspace_id, review_id)`.
- `reviews_annotated_at_idx` по одній nullable-колонці, і жодного запиту, який
  ним скористався б, у гілці нема (сортування по `annotated_at` не існує).
  Такий індекс лише сповільнює кожну вставку й оновлення `reviews`. Або
  прибрати, або, якщо він для майбутнього списку «нещодавно анотовані», —
  зробити частковим і тенант-скоупленим:
  `ON reviews (workspace_id, annotated_at DESC) WHERE annotation_text IS NOT NULL`.

### 17. Видалення нотатки лишає сироти — `service.ts:72-77`, `repository.ts:63-68`

`removeAnnotation` обнуляє три колонки на `reviews`, а вкладення не чіпає — вони
каскадять від `reviews`, не від нотатки. Тобто після `DELETE
/reviews/:id/annotation` нотатки нема, а `GET /reviews/:id/attachments` і далі
віддає файли, і в сховищі вони теж лишаються назавжди. Або чистити вкладення в
одній транзакції з нотаткою (і видаляти файли через порт з №5), або перейти на
власну таблицю `review_annotations` з №1 і повісити FK вкладень на неї — тоді
каскад зробить це сам.

---

## Дрібне

- **`routes.ts:41-54` — POST attachments без per-route rate limit.** Порівняй
  `reviews/routes.ts:29`, де дорога ручка несе власний ліміт. Запис у сховище —
  теж дорога операція, і на відміну від LLM-ручок її можна викликати в циклі
  безкоштовно.
- **`routes.ts:21-59` — префікс `/reviews/:id/...` належить модулю reviews.**
  Формально правило не порушено (колізії шляхів нема), але URL-простір рев'ю
  тепер обслуговують два плагіни; якщо reviews колись додасть свій
  `/reviews/:id/*`, шукати доведеться в двох файлах. Варіант: `/annotations`
  з `review_id` у тілі/квері, або хоча б коментар у `modules/index.ts`.
- **Тестів у гілці нема.** Мінімум, що варто мати: `*.it.test.ts` на
  workspace-скоуп репозиторію (після виправлення №2) і юніт на `attach()` з
  `MockFileStorage` через `new Container(config, db, { storage: ... })` — не
  через `vi.mock` шляху модуля. Нагадування: DB-тести мусять мати суфікс
  `.it.test.ts`, лані CI діляться рівно по цьому глобу.
- **`helpers.ts` і `constants.ts` у вирізці відсутні** (`service.ts:5-6`
  на них посилається) — перевірити окремо, що `sanitizeFileName` реально
  знешкоджує шляхи (`../`, абсолютні, NUL, юнікодні омографи), бо після №5
  саме воно стоятиме між клієнтом і файловою системою.

---

## Що зробити першим

1. №3 і №4 — інакше фіча не доїде до БД або з'їсть рев'ю разом з користувачем.
2. №2 — cross-tenant видалення.
3. №5 — без порту вкладення не тестуються і не зберігаються.
4. №1 — визначитися з володінням даними; варіант з власною таблицею
   `review_annotations` закриває заразом №4, №6 і №17.
