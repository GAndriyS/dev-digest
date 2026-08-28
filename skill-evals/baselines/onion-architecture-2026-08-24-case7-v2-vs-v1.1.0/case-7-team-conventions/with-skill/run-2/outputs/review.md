# Ревʼю гілки `annotations` (L06) — перед мерджем

Огляд вирізки в `.claude/skills/onion-architecture/evals/fixtures/annotations-branch/`:
`0043_review_annotations.sql`, `schema.excerpt.ts`, `routes.ts`, `service.ts`, `repository.ts`.

**Вердикт: не мерджити як є.** Шар routes → service → repository розкладений правильно,
сервіс бере `Container` і будує свій репозиторій із `container.db`, доменні помилки кидає
сервіс (а не мапить роут) — усе за формою онiона. Але гілка порушує два командні рішення
про міграції (обидва — «код виглядатиме нормально, і CI буде зелений»), тягне чужу таблицю
через власний репозиторій і має два місця з крос-тенантним доступом.

Нижче: **6 блокерів**, **5 серйозних**, **5 дрібних**, плюс перелік того, чого у вирізці
немає й що треба перевірити окремо.

---

## Блокери

### B1. Три нові колонки в `reviews` — таблиця закрита для нових колонок

**Файли:** `0043_review_annotations.sql:7-9`; `schema.excerpt.ts:27-31`

```sql
ALTER TABLE "reviews" ADD COLUMN "annotation_text" text;
ALTER TABLE "reviews" ADD COLUMN "annotation_author_id" uuid;
ALTER TABLE "reviews" ADD COLUMN "annotated_at" timestamp with time zone;
```

**Чому це проблема.** Рішення команди від 12/06/2026, після INC-42: `reviews` закрита для
нових колонок. Додавання `model` переписало таблицю на демо-інстансі й тримало
`ACCESS EXCLUSIVE` майже чотири хвилини; ревʼю, що виконувалося в той момент, померло
на півдорозі й лишилося напівзаписаним рядком, який ніхто не зміг пояснити. `reviews` —
найгарячіша таблиця в проєкті і та, яку читає кожен екран.

Анотація — це якраз «per-review дані, що не є самим вердиктом». Той факт, що `findings`
і `trace` широкі, — це причина, чому таблиця важка, а не ліцензія додати третє.
Аргумент «це ж просто три nullable-колонки, PG додасть їх метаданими» тут не рятує:
правило безумовне, а разом із колонками гілка ще й будує індекс по `reviews` (див. B2),
і кладе необмежений `text` у рядок таблиці, яку читає весь UI.

**Як правильно.** Своя таблиця, ключована `review_id`, join на читанні:

```sql
CREATE TABLE "review_annotations" (
  "review_id"   uuid PRIMARY KEY REFERENCES "reviews"("id") ON DELETE RESTRICT,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  "text"        text NOT NULL,
  "author_id"   uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "annotated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at"  timestamp with time zone NOT NULL DEFAULT now()
);
```

Це заодно прибирає всю дивну механіку в репозиторії: `saveAnnotation` стає
`insert … onConflictDoUpdate`, `clearAnnotation` (`repository.ts:63-68`) —
звичайним `DELETE` рядка замість `UPDATE … SET NULL` на `reviews`, а `getAnnotation`
(`repository.ts:52-61`) перестає робити `SELECT *` з `reviews` заради одного поля.

Якщо команда все ж вважає, що анотація має жити в `reviews` — це те місце, де треба
зупинитись і домовитись у PR, а не проводити як звичайну фічу.

---

### B2. `CREATE INDEX` по `reviews` без `CONCURRENTLY` — і ніхто його не використовує

**Файл:** `0043_review_annotations.sql:25-26`

```sql
CREATE INDEX IF NOT EXISTS "reviews_annotated_at_idx" ON "reviews" ("annotated_at");
```

**Чому це проблема.** Це та частина міграції, яка реально блокує: `CREATE INDEX` без
`CONCURRENTLY` бере `SHARE`-лок і зупиняє **всі записи** в `reviews` на весь час побудови —
тобто рівно той сценарій INC-42, тільки з іншого боку. І при цьому індекс мертвий: у гілці
немає жодного запиту, що фільтрує або сортує по `annotatedAt` — `repository.ts` адресує
рядки виключно по `(workspace_id, id)`.

**Як правильно.** Прибрати. Якщо колись знадобиться «останні проанотовані» — індекс
будується вже на новій таблиці з B1 (де він дешевий), і додається разом із запитом,
який його читає.

---

### B3. Усі нові FK — `ON DELETE CASCADE`

**Файли:** `0043_review_annotations.sql:13-14`; `schema.excerpt.ts:28-30, 39-44`

**Чому це проблема.** Рішення від 03/05/2026: нові зовнішні ключі — `ON DELETE RESTRICT`,
а дітей видаляє явно сервіс-власник. Причина: під час чистки воркспейсу видалення репозиторію
безшумно забрало 40k findings і їхні аудит-рядки, бо всі FK каскадували; ніхто не помітив
два тижні — не було помилки, яку можна помітити.

Тут це не гіпотетично: `ReviewRepository.deleteReview(workspaceId, reviewId)` вже існує
(`server/src/modules/reviews/repository.ts:105-107`) і викликається з UI. Після цієї міграції
видалення одного ревʼю тихо змітає всі його вкладення — включно з тим, що рядки містять
`storage_key`, тобто посилання на обʼєкти у зовнішньому сховищі. БД забуде про них миттєво
й без сліду, а самі файли залишаться осиротілими назавжди: не буде ні помилки, ні рядка,
за яким їх можна знайти й прибрати.

Схема тут сперечатиметься з вами: майже кожен FK у `server/src/db/schema/reviews.ts`
каже `onDelete: 'cascade'`, і скопіювати сусідній стиль — саме той інстинкт, який це
рішення й забороняє. Наявні каскади лишаються; нові не додаються.

**Як правильно.**
- `ON DELETE RESTRICT` на `annotation_attachments.review_id` та `.workspace_id`
  (і в SQL, і в Drizzle-схемі);
- `AnnotationsService` отримує `deleteForReview(workspaceId, reviewId)`, який видаляє
  вкладення (і, окремо, обʼєкти в сховищі) у порядку, який обирає сам, і може залогувати
  або відмовити;
- сервіс ревʼю кличе його перед видаленням ревʼю — через контейнер, не імпортом у чужу папку.

Якщо каскад тут справді доречний — це треба написати в PR і погодити; за замовчуванням `restrict`.

---

### B4. `annotation_author_id`: схема і міграція суперечать одна одній

**Файли:** `0043_review_annotations.sql:8` vs `schema.excerpt.ts:28-30`

Міграція додає голу колонку `uuid` **без жодного FK**. Drizzle-схема оголошує
`.references(() => users.id, { onDelete: 'cascade' })`. Дві окремі проблеми:

1. **Дрейф.** Обмеження, яке описує схема, у базі не існує. Будь-хто, хто читає
   `schema/reviews.ts`, вірить у гарантію цілісності, якої немає, а наступний
   `pnpm db:generate` згенерує «відсутній» FK як несподівану міграцію.
2. **Якби FK створили як написано — це втрата даних.** `ON DELETE CASCADE` на
   *nullable*-колонці всередині `reviews` означає, що видалення користувача видаляє
   **весь рядок ревʼю**, а з ним каскадом — його `findings` і `trace`. Звільнився
   інженер, адмін почистив користувача — і разом з ним зникли всі ревʼю, які він
   колись прокоментував. Тут потрібен `ON DELETE SET NULL` (а за правилом
   з B3 — `RESTRICT`), і ніколи `CASCADE`.

**Плюс:** міграція написана руками й пронумерована `0043`, тоді як журнал закінчується
на `0017` (`server/src/db/migrations/meta/_journal.json`). `pnpm db:migrate` ходить по
`_journal.json` — файл без запису в журналі просто ніколи не виконається, і гілка
«працюватиме» лише там, де хтось прогнав SQL руками. Міграція має бути згенерована
`pnpm db:generate` (`server/AGENTS.md:28-29`).

---

### B5. Модуль annotations читає й пише чужу таблицю напряму

**Файл:** `repository.ts:24-32` (`select … from t.reviews`), `39-49` (`update t.reviews`),
`52-61`, `63-68`

**Чому це проблема.** `t.reviews` — таблиця модуля `reviews`. Імпорт
`../reviews/repository.js` впав би на `no-cross-module-internals` голосно; інлайн-запит
через `container.db` імпортує лише `db/schema`, тому depcruise буде зелений — а звʼязаність
рівно та сама: форма чужої таблиці тепер ваша, і зламати її може будь-яка зміна в модулі
`reviews`. Єдина різниця в тому, що збірка залишиться зеленою.

`reviews` уже має репозиторій на контейнері саме для цього — `container.reviewRepo`
(`server/src/platform/container.ts:110-112`).

**Як правильно.** Після переїзду в свою таблицю (B1) у модуля лишається одна легітимна
потреба до `reviews` — перевірити, що ревʼю існує й належить воркспейсу. Беріть її через
`container.reviewRepo`. Зверніть увагу: наявний `ReviewRepository.getReview(reviewId)`
(`server/src/modules/reviews/repository.ts:69`) **не скоупить по workspace** — треба додати
туди workspace-scoped метод, а не робити свій запит збоку.

---

### B6. `deleteAttachment` не скоупиться по workspace

**Файл:** `repository.ts:94-98`

```ts
async deleteAttachment(attachmentId: string): Promise<void> {
  await this.db.delete(t.annotationAttachments).where(eq(t.annotationAttachments.id, attachmentId));
}
```

**Чому це проблема.** Правило репозиторію: кожен запит скоупиться `workspaceId`
(див. коментар тенантності в `server/src/db/schema.ts:4-6`). Тут — жодного. Будь-який
`attachmentId` з будь-якого воркспейсу видаляється без питань. Зараз метод ніхто не
викликає (роуту на видалення вкладення в `routes.ts` немає), тобто це мертвий код із
вбудованим IDOR, який спрацює тоді, коли хтось додасть роут і резонно припустить,
що репозиторій уже безпечний — усі решта методів у цьому ж файлі скоуплені.

**Як правильно.** Або видалити метод разом із гілкою, або **зараз** привести до
`deleteAttachment(workspaceId: string, attachmentId: string)` з обома умовами в `where`.

---

## Серйозні

### S1. `attach` не перевіряє ревʼю — ні існування, ні тенант

**Файл:** `service.ts:46-70` (порівняйте з `service.ts:29-30` в `upsert`)

`upsert` починається з `getReview` і кидає `NotFoundError`. `attach` не робить ні того,
ні іншого — одразу йде у валідацію файлу й вставку. Наслідки:

- вкладення до неіснуючого ревʼю падає на порушенні FK → **500 замість 404**;
- `reviewId` із **чужого** воркспейсу проходить: `repository.ts:70-77` бере `workspaceId`
  з контексту запиту й `reviewId` з URL, не звіряючи їх між собою. У результаті рядок
  містить *ваш* `workspace_id` і *чужий* `review_id`, і жоден constraint цього не ловить.
  Власник ревʼю підкинутого вкладення не побачить (`listAttachments` фільтрує по обох),
  а каскад із B3 колись його тихо приб'є.

**Як правильно.** Перевірка ревʼю — перший рядок `attach`, так само як в `upsert`
(і через `container.reviewRepo`, див. B5).

### S2. `storage_key`, `bytes` і `content_type` приходять від клієнта

**Файли:** `routes.ts:43-52`; `service.ts:51-56`

Сервер файлу не бачить взагалі. `MAX_ATTACHMENT_BYTES` і `isAllowedContentType`
перевіряють те, що клієнт **сам про себе заявив** — тобто ліміт розміру й whitelist типів
не є перевірками, це ввічливе прохання. Гірше з `storage_key`: він теж клієнтський, тож
ніщо не заважає надіслати ключ чужого обʼєкта у сховищі й отримати його у видачі
`GET /reviews/:id/attachments` (а коли зʼявиться роут на завантаження — і сам вміст).
Це крос-тенантне читання через звичайний POST.

**Як правильно.** `storage_key` генерує сервер (`${workspaceId}/${reviewId}/${uuid}`),
у контракт він взагалі не входить; розмір і `content_type` читаються з реального потоку
(`@fastify/multipart`) або з метаданих обʼєкта після завантаження — не з тіла запиту.

### S3. Валідація порожнього тексту зроблена в сервісі, а не на межі

**Файл:** `service.ts:32-33`

```ts
const text = input.text.trim();
if (text.length === 0) throw new AppError('empty_annotation', 'Annotation is empty', 422);
```

Правило: парсимо на межі, всередині кілець дані вже довірені. Це `z.string().trim().min(1)`
у `AnnotationInput` — і тоді запит помирає 422-ю до входу в хендлер, без ручної помилки
в бізнес-логіці. Заодно в контракті немає верхньої межі довжини: `text` без `.max(N)`
означає необмежений блоб (ще один аргумент за B1 — зараз він лягає в рядок `reviews`).

### S4. Жоден роут не оголошує `response`-схему

**Файл:** `routes.ts:21, 26-33, 35, 41-54, 56`

`server/src/modules/_shared/schemas.ts:14-27` пояснює, чому це не декорація: серіалізатор
валідує те, що **виходить** із процесу, тож хендлер, який одного дня поверне сирий
Drizzle-рядок (з `workspaceId`, `storageKey`, внутрішніми таймстемпами), впаде голосно,
а не розширить публічний API мовчки. Одна Zod-схема має вести і валідацію запиту,
і серіалізацію відповіді. Нові модулі це вже роблять — `modules/{brief,blast,onboarding,smart-diff}/routes.ts`.

Окремо: `routes.ts:38` повертає літерал `{ ok: true }`, тоді як для цього є
`OkResponse` (`_shared/schemas.ts:26`).

### S5. `row!` після окремого `getReview` — 500 замість 404 на гонці

**Файли:** `service.ts:29-30` → `repository.ts:39-49`

Між `SELECT` у `getReview` і `UPDATE` у `saveAnnotation` ревʼю можуть видалити. Тоді
`UPDATE` зачепить 0 рядків, `.returning()` поверне `[]`, а `row!` дасть `TypeError`
у `toAnnotation` — 500 замість чесної 404. Після переїзду в свою таблицю (B1) це
природно стає одним `insert … onConflictDoUpdate`, і перевірка існування зводиться
до однієї операції замість двох.

---

## Дрібні

### M1. Ліміт вкладень — TOCTOU
`service.ts:58-61`: `listAttachments` + порівняння з `MAX_ATTACHMENTS_PER_REVIEW` не
атомарні, два паралельні POST проходять обидва. Для UI-фічі не критично, але якщо
ліміт має значення — це `count` усередині транзакції.

### M2. Таблиця модуля живе у файлі схеми чужого модуля
`schema.excerpt.ts:35` кладе `annotationAttachments` у `db/schema/reviews.ts`. Своя
таблиця → свій файл `db/schema/annotations.ts` + один рядок у барелі
(`server/src/db/schema.ts:15-27`), як зроблено для `repo-intel`, `ci`, `eval`. Інакше
`reviews.ts` продовжує рости чужими фічами.

### M3. Імпорти в `schema.excerpt.ts` вказують на неіснуючі файли
`schema.excerpt.ts:6-9` імпортує `./workspaces.js`, `./pull-requests.js`, `./users.js`.
Таких файлів немає: `workspaces` і `users` — у `db/schema/core.ts`, `pullRequests` —
у `db/schema/pulls.ts`, і решта файлів схеми імпортують **без** розширення `.js`
(`server/src/db/schema/reviews.ts:3-5`). Якщо це не артефакт вирізки — гілка не збереться.

### M4. Індекс на вкладеннях не збігається із запитом
`0043_review_annotations.sql:22-23` індексує тільки `review_id`, а `listAttachments`
(`repository.ts:79-92`) фільтрує по `(workspace_id, review_id)` і сортує по `created_at`.
Композитний `(workspace_id, review_id)` — і за правилом тенантності, і за єдиним
запитом, який реально виконується.

### M5. Мапінг wire → domain у хендлері
`routes.ts:46-52` розпаковує `content_type` / `storage_key` і збирає camelCase-обʼєкт
руками. Дрібниця, але це трансформація, а не делегування; її місце — `helpers.ts`
модуля, або сервіс приймає DTO як є.

---

## Чого немає у вирізці — перевірити окремо

1. **Контракти `@devdigest/shared` відсутні.** `AnnotationInput`, `AttachmentInput`,
   `Annotation`, `AttachmentRecord` не існують **у жодній** із двох копій —
   ні в `server/src/vendor/shared/contracts/*`, ні в `client/src/vendor/shared/*`.
   Гілка має додати їх у серверну копію (канонічна) і **віддзеркалити** в клієнтську;
   ці типи перетинають дріт, тож правити тільки одну копію не можна.
2. **`helpers.ts` і `constants.ts` не додані.** `sanitizeFileName` варта окремого
   погляду: `file_name` — клієнтський рядок, і path traversal (`../../`) тут цілком
   реальний, якщо ім'я колись бере участь у формуванні ключа чи заголовка
   `Content-Disposition`.
3. **Реєстрація модуля.** У `server/src/modules/index.ts` потрібен один import + один
   запис; у вирізці цього немає, і без нього роути просто не піднімуться.
4. **Тестів немає.** DB-backed мають називатися `*.it.test.ts` (на цьому globʼі
   розходяться CI-лейни), а підміна адаптерів — через `new Container(config, db, { … })`,
   не `vi.mock`. Мінімум, що варто покрити: крос-тенантний `attach` (S1) і те, що
   видалення ревʼю не забирає вкладення мовчки (B3).

---

## Що зроблено добре

- Розділення routes → service → repository акуратне: роут лише валідує й делегує,
  сервіс тримає бізнес-правила, репозиторій — єдине місце із SQL.
- Сервіс приймає `Container` і будує репозиторій із `container.db`, як `modules/repos/service.ts`.
- Сервіс і репозиторій приймають **розвʼязані значення** (`workspaceId`, `userId`, `reviewId`),
  а не `FastifyRequest` — межа стоїть там, де має.
- Тенантність через `getContext` (`_shared/context.ts`), а не через параметр запиту.
- Доменні помилки кидає сервіс (`AppError` / `NotFoundError`); роути їх не мапять руками.
- Рядок БД → DTO конвертується в одному місці (`toAnnotation` / `toAttachment`),
  і `toAttachment` свідомо не віддає `storage_key` назовні.

---

## Мінімальний план до мерджу

1. Перенести анотацію у власну таблицю `review_annotations`, ключовану `review_id`; прибрати
   три `ALTER TABLE reviews ADD COLUMN` і `reviews_annotated_at_idx` (B1, B2).
2. Усі нові FK — `ON DELETE RESTRICT`; додати `AnnotationsService.deleteForReview(...)`
   і викликати його з сервісу ревʼю перед видаленням (B3).
3. Прибрати розходження схеми й міграції по `annotation_author_id`; перегенерувати
   міграцію через `pnpm db:generate`, щоб зʼявився запис у `_journal.json` (B4).
4. Доступ до `reviews` — тільки через `container.reviewRepo` (додавши туди
   workspace-scoped `getReview`) (B5).
5. Скоупити `deleteAttachment` по `workspaceId` або видалити метод (B6).
6. Перевірку ревʼю на початок `attach` (S1); `storage_key` генерує сервер, розмір і тип
   читаються з реального обʼєкта (S2).
7. Порожній/задовгий текст відсікати Zod-схемою на роуті (S3); додати `response`-схеми
   на всі пʼять роутів (S4).
8. Додати контракти в обидві копії `@devdigest/shared` і зареєструвати модуль
   у `modules/index.ts`.

Після цього прогнати `node scripts/verify.mjs --slice backend` (і `--slice integration`,
якщо зʼявляться `*.it.test.ts`). Але зверніть увагу: **жоден із шести блокерів
CI не ловить** — B1–B4 це міграції (будь-яка міграція є легальним SQL), B5 не створює
забороненого імпорту, B6 — просто відсутня умова у `where`. Зелений `depcruise` тут
не говорить нічого.
