# Ревʼю гілки `annotations` (перед мерджем)

Оглянуті файли (усі в
`/Users/andriigorbatiuk/Documents/dev-digest/.claude/skills/onion-architecture/evals/fixtures/annotations-branch/`):

- `0043_review_annotations.sql`
- `schema.excerpt.ts`
- `routes.ts`
- `service.ts`
- `repository.ts`

**Вердикт: не мерджити.** Розкладка модуля (routes → service → repository)
зроблена правильно і збігається з `server/src/modules/repos/`, але міграція
порушує два командні рішення, які ніякий лінт і `depcruise` не ловлять, і
разом вони дають рівно ті інциденти, після яких ці рішення й ухвалили.

---

## Блокери

### 1. Три нові колонки на `reviews` — таблиця закрита для нових колонок

**Файл:** `0043_review_annotations.sql:7-9`, дзеркально `schema.excerpt.ts:27-31`

```sql
ALTER TABLE "reviews" ADD COLUMN "annotation_text" text;
ALTER TABLE "reviews" ADD COLUMN "annotation_author_id" uuid;
ALTER TABLE "reviews" ADD COLUMN "annotated_at" timestamp with time zone;
```

**Чому це проблема.** `reviews` закрита для нових колонок — рішення від
12/06/2026 після INC-42. Тоді додавання `model` до `reviews` переписало таблицю
на demo-інстансі й тримало `ACCESS EXCLUSIVE` майже чотири хвилини; ревʼю, яке
в той момент виконувалось, померло на півдорозі й лишилось напівзаписаним рядком.
`reviews` — найгарячіша таблиця в системі, її читає кожен екран.
Командне рішення називає анотації буквально: per-review дані, які не є самим
вердиктом (анотації, стан доставки, розбивка вартості), живуть **у власній
таблиці з ключем `review_id`** і джойняться на читанні. `findings` і `trace`
широкі та grandfathered — вони причина ваги таблиці, а не дозвіл додати третю.
Те, що поруч у схемі вже лежить `model`, — не прецедент: копіювання
навколишнього патерну тут і є спосіб зламати правило.

Додатково той самий блок:

- `0043_review_annotations.sql:25-26` — `CREATE INDEX ... ON "reviews"
  ("annotated_at")` без `CONCURRENTLY` бере на `reviews` блокування, що зупиняє
  записи на час побудови. На повній таблиці ревʼю це друга половина того ж
  інциденту. Індекс за анотаціями на `reviews` при цьому потрібен лише тому,
  що дані поклали не туди.
- `repository.ts:59` — «анотації немає» кодується як `annotationText == null`.
  Порожня анотація і відсутня анотація стають нерозрізненними, а «стерти»
  перетворюється на UPDATE гарячого рядка (`repository.ts:63-68`).

**Як правильно.** Окрема таблиця, `review_id` як первинний ключ (одна нотатка на
ревʼю — обмеження на рівні схеми, а не на рівні сервісу):

```sql
CREATE TABLE IF NOT EXISTS "review_annotations" (
  "review_id"    uuid PRIMARY KEY REFERENCES "reviews"("id") ON DELETE RESTRICT,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  "text"         text NOT NULL,
  "author_id"    uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "annotated_at" timestamptz NOT NULL DEFAULT now(),
  "created_at"   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "review_annotations_ws_annotated_idx"
  ON "review_annotations" ("workspace_id", "annotated_at");
```

`reviews` при цьому не чіпається взагалі. Наявність рядка = наявність нотатки,
`DELETE` замість UPDATE-у гарячого рядка, а індекс за `annotated_at` будується
на маленькій новій таблиці. Якщо все ж вважаєте, що колонки на `reviews`
виправдані, — це предмет обговорення в PR і окремої згоди, а не мовчазного
мерджу.

---

### 2. Нові foreign keys каскадять — за замовчуванням має бути `RESTRICT`

**Файл:** `0043_review_annotations.sql:13-14`, `schema.excerpt.ts:28-30`,
`schema.excerpt.ts:41-44`

```sql
"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
"review_id"    uuid NOT NULL REFERENCES "reviews"("id")    ON DELETE CASCADE,
```

**Чому це проблема.** Рішення від 03/05/2026: нові FK — `ON DELETE RESTRICT`, а
видалення робить сервіс-власник явно. Причина — прибирання воркспейсу колись
знесло репозиторій разом із 40k findings і їхніми audit-рядками, тихо, бо всі FK
у схемі каскадували; помітили через два тижні, бо помилки не було. Існуючі
каскади лишаються (їх переписування — окрема міграція іншого дня), нові не
додаються. Схема тут **сперечатиметься з вами**: майже кожен FK, який ви прочитаєте
в `server/src/db/schema/`, каже `onDelete: 'cascade'` — і саме на цьому пункті
копіювати навколишній стиль неправильно.

Найгірший випадок — `schema.excerpt.ts:28-30`:

```ts
annotationAuthorId: uuid('annotation_author_id').references(() => users.id, {
  onDelete: 'cascade',
}),
```

Каскад на колонці означає видалення **всього рядка ревʼю**, коли видаляють
користувача. Тобто звільнення людини, яка лишила нотатку, стирає саме ревʼю з
findings і trace (вони каскадять з `reviews`). Це буквально форма INC-у з
03/05/2026, тільки гірша: зникає не дочірня сутність, а батьківська.

**Як правильно.** Усі три FK — `ON DELETE RESTRICT` (для автора альтернатива —
`ON DELETE SET NULL`, якщо команда свідомо хоче зберігати нотатку без автора;
`CASCADE` — ні за яких умов). Явне видалення дітей — у сервісі анотацій, у
порядку, який він обирає, з можливістю залогувати або відмовити.

---

### 3. Розбіжність між міграцією і Drizzle-схемою на `annotation_author_id`

**Файл:** `0043_review_annotations.sql:8` проти `schema.excerpt.ts:28-30`

SQL створює `annotation_author_id uuid` **без жодного `REFERENCES`**, а
Drizzle-схема декларує FK на `users.id` з каскадом. Отже: (а) на рівні БД
цілісності немає взагалі — можна записати неіснуючий `author_id`; (б) наступний
`drizzle-kit generate` побачить різницю і згенерує «зайвий» `ADD CONSTRAINT`
у чужій міграції, який ніхто не очікує. Схема і застосований SQL мають збігатися
байт-у-байт за змістом — після виправлення пунктів 1-2 це слід перевірити ще раз.

---

### 4. `removeAnnotation` лишає attachments сиротами

**Файл:** `service.ts:72-77`

```ts
async removeAnnotation(workspaceId: string, reviewId: string): Promise<void> {
  const annotation = await this.repo.getAnnotation(workspaceId, reviewId);
  if (!annotation) throw new NotFoundError('Review has no annotation');
  await this.repo.clearAnnotation(workspaceId, reviewId);
}
```

**Чому це проблема.** Вкладення привʼязані до `review_id`, а не до анотації
(`schema.excerpt.ts:42-44`), тож після видалення нотатки вони лишаються висіти
на ревʼю: `GET /reviews/:id/attachments` (`routes.ts:56-59`) далі повертає
файли нотатки, якої вже немає, а обʼєкти в сховищі ніхто не прибирає. Метод
`repository.deleteAttachment` (`repository.ts:94-98`) існує, але його ніхто не
викликає — жодного виклику ні в `service.ts`, ні в `routes.ts`.

**Як правильно.** Це і є та «явна каскадність у сервісі», якої вимагає рішення
з пункту 2: спершу видалити вкладення (і файли зі сховища), потім нотатку, у
явному порядку, під логом. З окремою таблицею з пункту 1 це один `DELETE` по
`review_annotations` плюс попередній прохід по вкладеннях.

---

### 5. Модуль анотацій пише в чужу таблицю `reviews`

**Файл:** `repository.ts:24-68` (`getReview`, `saveAnnotation`, `getAnnotation`,
`clearAnnotation` — усі проти `t.reviews`)

**Чому це проблема.** `reviews` належить модулю `modules/reviews` — його
репозиторій (`server/src/modules/reviews/repository.ts:27+`) описаний як «THE
ONLY layer touching the DB for the review domain». `depcruise` тут зелений: імпорт
іде в `db/schema`, а не в `../reviews/repository.js`, тож `no-cross-module-internals`
не спрацює. Але звʼязаність та сама — форма чужої таблиці тепер ваша, і зламати
її може будь-яка зміна в модулі reviews. Це рівно та «сліпа зона», де зелений
білд нічого не означає.

**Як правильно.** Чужі дані беруться через контейнер: `container.reviewRepo` вже
є (`server/src/platform/container.ts:111-113`). Перевірку існування ревʼю
(`service.ts:29`) робити через нього, а власний репозиторій модуля має торкатися
тільки `review_annotations` і `annotation_attachments`. Якщо потрібного методу
в `ReviewRepository` немає — додати саме туди.

---

## Важливе, але не блокуюче

### 6. `deleteAttachment` не скоупиться воркспейсом

**Файл:** `repository.ts:94-98`

```ts
await this.db.delete(t.annotationAttachments).where(eq(t.annotationAttachments.id, attachmentId));
```

Чекліст нового модуля вимагає: репозиторій — єдине місце, що торкається своїх
таблиць, і **кожен запит скоупиться `workspaceId`**. Решта методів у цьому файлі
це роблять (`repository.ts:28`, `:46`, `:67`, `:84-87`), а цей — ні. Щойно метод
підключать до пункту 4 або до майбутнього `DELETE /attachments/:id`, він стане
крос-тенантним видаленням за вгаданим id. Додати
`eq(t.annotationAttachments.workspaceId, workspaceId)` у `where` і прийняти
`workspaceId` першим аргументом, як у сусідів.

### 7. `storage_key` і `bytes` приходять від клієнта

**Файл:** `routes.ts:46-52` → `service.ts:54-68` → `repository.ts:71-76`

Клієнт передає `storage_key` і `bytes`, і обидва записуються в БД як є.
`storage_key`, обраний клієнтом, дозволяє повісити вкладення на будь-який обʼєкт
сховища — зокрема на обʼєкт чужого воркспейсу — або перезаписати/підмінити
існуючий ключ. `bytes` робить перевірку `MAX_ATTACHMENT_BYTES` (`service.ts:54`)
суто декоративною: клієнт просто пише менше число.
Ключ має карбувати сервер (сервіс, з `workspaceId`/`reviewId`/uuid), а розмір —
братися з фактичного завантаження, а не з тіла запиту. Валідація на межі
(`AttachmentInput`) перевіряє форму, а не правдивість — це різні речі.

### 8. На жодному маршруті немає `schema.response`

**Файл:** `routes.ts:21`, `:26-28`, `:35`, `:41-43`, `:56`

`server/src/modules/_shared/schemas.ts` прямо про це: response-схема не
декорація — серіалізатор валідує те, що виходить з процесу, тож хендлер, який
почав повертати сирий Drizzle-рядок (з `workspaceId`, внутрішніми таймстемпами),
падає голосно, а не тихо розширює публічний API. Тут ризик реальний:
`repository.ts:39-49` робить `.returning()` по всьому рядку `reviews`.
Додати `response: { 200: ... }` на кожен маршрут, а для `DELETE`
(`routes.ts:35-39`, повертає `{ ok: true }`) використати вже наявний
`OkResponse` з `_shared/schemas.ts`.

### 9. `getAnnotation` тягне весь рядок `reviews`

**Файл:** `repository.ts:52-61`

`.select()` без списку колонок читає всю гарячу таблицю (verdict, summary, score,
model…) заради трьох полів нотатки. Сусідній `getReview` (`repository.ts:25-29`)
робить правильно — перелічує колонки. Після пункту 1 це питання зникає само.

### 10. `row!` після UPDATE перетворює 404 на 500

**Файл:** `repository.ts:39-49` (`return toAnnotation(row!)`)

Між перевіркою існування ревʼю (`service.ts:29`) і записом ревʼю може зникнути;
тоді `.returning()` дає порожній масив, `row!` кидає `TypeError`, і клієнт
отримує 500 замість 404. Повертати `row ?? null`, а `NotFoundError` кидати в
сервісі — доменні помилки кидає сервіс, маршрути їх не мапять руками
(`service.ts:30` уже робить це правильно).

---

## Дрібне / перевірити перед мерджем

- **`schema.excerpt.ts:5-9` — імпорти вказують на неіснуючі файли.**
  `./workspaces.js`, `./pull-requests.js`, `./users.js` у `server/src/db/schema/`
  не існують: `workspaces` і `users` лежать у `./core`, `pullRequests` — у
  `./pulls`, і реальні файли схеми імпортують **без розширення**
  (`from './_shared'`, `from './core'`). Нова таблиця має потрапити в один із
  доменних файлів, що ре-експортуються з барелю `server/src/db/schema.ts` —
  репозиторій імпортує `* as t from '../../db/schema.js'`.
- **Номер міграції і журнал.** Остання застосована — `0017_shallow_swordsman`,
  а гілка приносить `0043`. Drizzle застосовує міграції за
  `src/db/migrations/meta/_journal.json`; файлу, якого немає в журналі (і
  відповідного `00NN_snapshot.json`), не існує для мігратора. Міграцію треба
  генерувати через `drizzle-kit`, а не писати руками, і номер має бути
  наступним.
- **Реєстрація модуля.** У `server/src/modules/index.ts` запису `annotations`
  немає. Без нього маршрути просто не піднімуться, а `depcruise` впаде на
  `no-orphans` («Unreachable module — dead code, or a missing registration in
  modules/index.ts»).
- **Контракти в обох копіях `@devdigest/shared`.** `Annotation`,
  `AnnotationInput`, `AttachmentInput`, `AttachmentRecord` у гілці не показані.
  Вони перетинають дріт, отже мають зʼявитися в
  `server/src/vendor/shared/contracts/` (канонічна копія) **і** бути віддзеркалені
  в `client/src/vendor/shared/contracts/`. Редагувати лише одну копію не можна.
- **Індекс під фактичний запит.** `listAttachments` (`repository.ts:83-88`)
  фільтрує по `(workspace_id, review_id)`, а індекс створено тільки по
  `review_id` (`0043_review_annotations.sql:22-23`). Композитний
  `(workspace_id, review_id)` точніше лягає на запит.
- **`helpers.ts` / `constants.ts` не входять у вирізку.** `sanitizeFileName`,
  `isAllowedContentType`, `MAX_ATTACHMENTS_PER_REVIEW`, `MAX_ATTACHMENT_BYTES`
  (`service.ts:5-6`) не перевірені — `sanitizeFileName` варто окремо глянути на
  path traversal, якщо імʼя десь бере участь у формуванні ключа сховища.

---

## Що зроблено правильно

Щоб не загубилось у переліку зауважень:

- Розкладка кілець чиста: `routes.ts` тільки парсить і делегує, `service.ts`
  приймає розвʼязані значення (`workspaceId`, `userId`, `reviewId`) і жодного
  разу не бачить `FastifyRequest`, SQL живе виключно в репозиторії.
- Сервіс будується з контейнера (`service.ts:19-21`) точно як
  `modules/repos/service.ts` — шов для тестів на місці.
- Валідація на межі: `IdParams` і Zod-body в `schema` маршруту
  (`routes.ts:21-58`), без ручного `Schema.parse(req.body)` у хендлері.
- Доменні помилки кидаються як `AppError`/`NotFoundError` зі статусами
  (`service.ts:30`, `:33`, `:52`, `:55`, `:60`, `:74`) — маршрути їх не мапять.

---

## Порядок виправлень

1. Переписати міграцію: `review_annotations` окремою таблицею, `reviews` не
   чіпати, `annotation_attachments` — `ON DELETE RESTRICT` на всіх FK, згенерувати
   через `drizzle-kit` з правильним номером і журналом (блокери 1-3).
2. Прибрати `t.reviews` з репозиторію модуля, перевірку ревʼю робити через
   `container.reviewRepo` (блокер 5).
3. Явне видалення дітей у `removeAnnotation`, `deleteAttachment` зі скоупом по
   воркспейсу (блокер 4, пункт 6).
4. `storage_key` карбує сервер, `bytes` — з реального завантаження (пункт 7).
5. `schema.response` на всі маршрути, `row ?? null` замість `row!`, точковий
   `select` (пункти 8-10).
6. Реєстрація модуля в `modules/index.ts` + контракти в обидві копії
   `@devdigest/shared`, далі
   `node scripts/verify.mjs --slice backend`.
