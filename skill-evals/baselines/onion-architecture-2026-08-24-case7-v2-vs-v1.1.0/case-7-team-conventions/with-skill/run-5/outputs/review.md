# Ревʼю гілки `annotations` — перед мерджем

Обсяг: `0043_review_annotations.sql`, `schema.excerpt.ts`, `routes.ts`, `service.ts`,
`repository.ts` (вирізка в `.claude/skills/onion-architecture/evals/fixtures/annotations-branch/`).
`helpers.ts`, `constants.ts`, контракти в `vendor/shared`, `modules/index.ts` і тести
у вирізку не потрапили — там, де це важливо, я це зазначаю окремо.

**Вердикт: не мерджити.** Сім блокерів, з них два — прямі порушення командних
рішень, які не ловить жоден лінтер, і один — тихий шлях до втрати цілого ревʼю.

Що зроблено правильно (щоб не переписувати): шар `routes → service → repository`
розділений як треба, сервіс бере `Container` і будує репозиторій з `container.db`,
тенансі береться через `getContext`, помилки кидаються як `AppError`/`NotFoundError`,
Zod оголошений на маршруті, а не парситься руками в хендлері. Каркас правильний —
проблеми в тому, куди лягли дані і як налаштовані FK.

---

## Блокери

### B1. Три нові колонки на `reviews` — таблиця закрита для нових колонок

`0043_review_annotations.sql:7-9`, `schema.excerpt.ts:27-31`

```sql
ALTER TABLE "reviews" ADD COLUMN "annotation_text" text;
ALTER TABLE "reviews" ADD COLUMN "annotation_author_id" uuid;
ALTER TABLE "reviews" ADD COLUMN "annotated_at" timestamp with time zone;
```

**Чому це проблема.** `reviews` закрита для нових колонок за рішенням від
12/06/2026, після INC-42: додавання `model` переписало таблицю на демо-інстансі й
тримало `ACCESS EXCLUSIVE` майже чотири хвилини, ревʼю, яке в той момент виконувалось,
померло на півдорозі й лишилось напівзаписаним рядком. Це найгарячіша таблиця в
системі — її читає кожен екран. Анотація не є частиною вироку: це подані людиною
дані, які фіча винайшла для себе. Саме той випадок, який рішення й описує.
`findings` і `trace` широкі та grandfathered — вони причина, чому таблиця важка,
а не дозвіл додати третю.

Окремо: колонки додані без `DEFAULT`, тож самі по собі вони дешеві, але це не
рятує — див. B2 (FK на `users`) і M2 (побудова індексу), які лок таки візьмуть.
І головне: рішення про власну таблицю — не про вартість цієї конкретної міграції,
а про те, щоб `reviews` не росла далі.

**Як правильно.** Власна таблиця, ключована `review_id`, join на читанні:

```sql
CREATE TABLE "review_annotations" (
  "review_id" uuid PRIMARY KEY REFERENCES "reviews"("id") ON DELETE RESTRICT,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  "text" text NOT NULL,
  "author_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "annotated_at" timestamp with time zone NOT NULL DEFAULT now()
);
```

Прецедент у репозиторії вже є і виглядає рівно так: `pr_intent` і `pr_brief` у
`server/src/db/schema/reviews.ts:48` і `:75` — обидві бічні таблиці з `pr_id` як
первинним ключем, а не колонки на `pull_requests`. Копіюйте цю форму.

Бонусом це прибирає половину проблем нижче: `saveAnnotation` стає нормальним
upsert-ом у власну таблицю замість `UPDATE reviews` (B4), а «анотації немає»
перестає бути `annotation_text IS NULL` і стає «немає рядка».

### B2. `annotationAuthorId` з `onDelete: 'cascade'` — видалення користувача видаляє ревʼю

`schema.excerpt.ts:28-30`

```ts
annotationAuthorId: uuid('annotation_author_id').references(() => users.id, {
  onDelete: 'cascade',
}),
```

**Чому це проблема.** Каскад тут стоїть на колонці таблиці `reviews`, а не на
таблиці анотацій. Семантика PostgreSQL: видалили користувача — **видалився весь
рядок ревʼю**, разом із вироком, score, summary, `run_id`. А далі по ланцюжку
каскадить `findings.review_id` (`server/src/db/schema/reviews.ts:31`) і нові
`annotation_attachments`. Тобто звільнили людину, почистили її акаунт — і мовчки
зникли всі ревʼю, які вона колись прокоментувала, разом із фіндингами. Помилки не
буде, логу не буде. Це рівно форма інциденту від 03/05/2026, де прибирання репо
забрало 40k фіндингів і аудит-рядки, і ніхто не помічав два тижні.

**Як правильно.** Разом із B1 колонка їде у власну таблицю, і FK стає
`onDelete: 'restrict'`. Якщо треба вміти видаляти користувачів — сервіс, який
володіє видаленням користувача, явно вирішує, що робити з анотаціями (знеособити
`author_id`, перенести, відмовити), і робить це видимо.

### B3. Усі нові FK — `CASCADE`; за домовленістю нові FK це `RESTRICT`

`0043_review_annotations.sql:13-14`, `schema.excerpt.ts:41`, `schema.excerpt.ts:44`

```sql
"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
"review_id" uuid NOT NULL REFERENCES "reviews"("id") ON DELETE CASCADE,
```

**Чому це проблема.** Рішення від 03/05/2026: нові FK — `ON DELETE RESTRICT`,
а видалення дітей іде через сервіс-власник, у порядку, який він обирає, з
можливістю залогувати або відмовити. Наявні каскади лишаються (їх переписування —
окрема міграція окремого дня), нові не додаються. Схема буде сперечатися: майже
кожен FK, який ви прочитаєте в `server/src/db/schema/*.ts`, каже `cascade`
(53 входження) — і саме тут копіювати оточення є неправильним інстинктом.

Конкретний наслідок уже вбудований у гілку: `ReviewRepository.deleteReview()`
(`server/src/modules/reviews/repository.ts:105`) після цієї міграції почне тихо
забирати з собою всі `annotation_attachments`. Модуль reviews про них не знає й
ніколи не дізнається — рядки зникнуть без жодного рядка в логах, а обʼєкти в
сховищі лишаться висіти назавжди.

**Як правильно.** `ON DELETE RESTRICT` на обох FK. `AnnotationsService` отримує
явний метод на кшталт `purgeForReview(workspaceId, reviewId)`, який видаляє
вкладення (і їхні блоби у сховищі) перед тим, як ревʼю можна буде видалити;
`ReviewService.deleteReview` викликає його явно. Якщо команда вважає, що тут
каскад справді доречний — це треба написати в описі PR і узгодити окремо;
дефолт — `restrict`.

### B4. Модуль annotations пише в чужу таблицю `reviews`

`repository.ts:24-32`, `repository.ts:34-50`, `repository.ts:52-61`, `repository.ts:63-68`

```ts
.update(t.reviews).set({ annotationText: ..., annotationAuthorId: ..., annotatedAt: ... })
```

**Чому це проблема.** `t.reviews` — таблиця модуля `reviews`. Імпорт
`../reviews/repository.js` впав би на правилі `no-cross-module-internals`
(`server/.dependency-cruiser.cjs:83`), а той самий запит, написаний інлайн через
`db/schema`, проходить depcruise зеленим — імпортується ж лише схема, легальна
звідусіль. Звʼязаність рівно та сама: форма чужої таблиці тепер ваша, щоб її
зламати. Різниця лише в тому, що збірка лишається зеленою. Так само й
`getReview()` (`repository.ts:24`) дублює `ReviewRepository.getReview()`, яка вже
існує (`server/src/modules/reviews/repository.ts:69`) і вже лежить на контейнері
як `container.reviewRepo` (`server/src/platform/container.ts:111`).

**Як правильно.** Перевірку існування ревʼю брати з контейнера:
`this.container.reviewRepo.getReview(...)` — і викинути `AnnotationsRepository.getReview`.
Записи анотацій — у власну таблицю модуля (B1), тоді `AnnotationsRepository`
взагалі перестає торкатися `t.reviews`. Зверніть увагу: `container.reviewRepo.getReview(reviewId)`
не приймає `workspaceId`, тож перевірку тенансі треба зробити явно на результаті
(або додати скоуповану сигнатуру в `ReviewRepository` — це коректне місце для такої зміни).

### B5. `deleteAttachment` не скоупиться по `workspaceId`

`repository.ts:94-98`

```ts
async deleteAttachment(attachmentId: string): Promise<void> {
  await this.db.delete(t.annotationAttachments).where(eq(t.annotationAttachments.id, attachmentId));
}
```

**Чому це проблема.** Правило репозиторію — «кожен запит скоупиться по
`workspaceId`»; коментар у `server/src/db/schema.ts:4-6` формулює це як інваріант
схеми. Тут його немає: маючи будь-який `attachment_id`, метод видаляє вкладення
чужого воркспейсу. Зараз маршруту, який його викликає, у вирізці немає — тобто це
ще й мертвий код, який `no-orphans` не побачить (правило рівня модулів, не методів).
Мертвий метод із дірою в тенансі — це заряджена міна: перший, хто додасть
`DELETE /attachments/:id`, візьме готову сигнатуру й не помітить.

**Як правильно.** Або видалити метод до появи маршруту, або привести до форми
решти файлу: `deleteAttachment(workspaceId, attachmentId)` з
`and(eq(..workspaceId, workspaceId), eq(..id, attachmentId))` і повертати
`boolean` (як `deleteReview` у reviews), щоб маршрут міг дати 404.

### B6. `attach()` не перевіряє, що ревʼю існує і належить воркспейсу

`service.ts:46-70`

**Чому це проблема.** `upsert()` починається з `getReview` + `NotFoundError`
(`service.ts:29-30`), а `attach()` — ні. `POST /reviews/:id/attachments` із чужим
або неіснуючим `:id` спокійно вставить рядок із **вашим** `workspace_id` і
**чужим** `review_id`. FK на `reviews` пройде — він не знає нічого про воркспейс.
Далі: власник того ревʼю ваш рядок не побачить (його `listAttachments`
фільтрує по своєму `workspaceId`), а ліміт `MAX_ATTACHMENTS_PER_REVIEW` для нього
ви вже частково зʼїли. Це і крос-тенант запис, і тиха неконсистентність даних.

**Як правильно.** Той самий guard, що й в `upsert`: спершу
`reviewRepo.getReview` + перевірка воркспейсу + `NotFoundError`, і лише потім
валідації файлу та вставка.

### B7. `storage_key`, `bytes` і `content_type` приходять від клієнта

`routes.ts:46-52`, `service.ts:51-56`, `service.ts:63-69`

```ts
const { name, content_type, bytes, storage_key } = req.body;
```

**Чому це проблема.** Перевірки в сервісі — `isAllowedContentType(file.contentType)`
і `file.bytes > MAX_ATTACHMENT_BYTES` — застосовані до значень, які надіслав той
самий клієнт, що й файл. Тобто вони дорадчі: досить надіслати
`{"content_type":"image/png","bytes":1}` для чого завгодно. Гірше з `storage_key`:
клієнт вільно вказує ключ обʼєкта у сховищі, тож може привʼязати запис до чужого
обʼєкта або перетерти чужий ключ. `sanitizeFileName` застосовано до `file_name`
(`service.ts:65`), а `storageKey` іде в базу як є (`service.ts:68`) — санітизували
поле, яке ми показуємо, і пропустили те, яким адресуємо.

**Як правильно.** `storage_key` має генерувати сервер (наприклад
`${workspaceId}/${reviewId}/${randomUUID()}`), а не приймати з тіла запиту.
Розмір і content-type брати з фактично завантаженого обʼєкта (`@fastify/multipart`
або HEAD у сховище після upload), а не зі слів клієнта. Якщо потік із
пресайн-URL — сервер видає ключ у момент видачі URL і памʼятає його, а
`POST /attachments` лише підтверджує вже відомий йому ключ.

Зауваження на полях: сховище тут — ще один вихід у зовнішній світ. За архітектурою
це порт у `server/src/vendor/shared/adapters.ts` + адаптер у `server/src/adapters/`
+ лінивий геттер і `ContainerOverrides` у `container.ts` + мок у
`adapters/mocks.ts` — усі чотири, інакше шов зламаний і сервіс не юніт-тестується.
У вирізці порту немає взагалі; якщо блоби кладе клієнт напряму — це варто
написати в PR явно, бо з коду цього не видно.

---

## Суттєве

### M1. Міграція в такому вигляді не застосується

`0043_review_annotations.sql` (файл цілком)

Три речі одразу:

1. **Немає запису в `src/db/migrations/meta/_journal.json`.** Drizzle виконує те,
   що перелічене в журналі; файл, який просто лежить у теці, не виконається ніколи.
   Останній запис — `idx: 17`, `0017_shallow_swordsman`.
2. **Номер `0043` при наступному вільному `0018`.** Журнал і імена файлів мають
   збігатися; `0043` розриває послідовність.
3. **Немає `--> statement-breakpoint` між стейтментами.** У журналі стоїть
   `"breakpoints": true`, і всі наявні міграції розділені цим маркером
   (напр. `src/db/migrations/0016_yielding_brother_voodoo.sql:7`). Тут шість
   стейтментів злиті в один блок.

**Як правильно.** Не писати міграцію руками: змінити Drizzle-схему й запустити
`drizzle-kit generate` — він проставить і номер, і журнал, і breakpoints. Далі
`cd server && pnpm db:migrate` (на завантаженні міграції не застосовуються).
Важливо: генератор питає інтерактивно, якщо дифф одночасно додає й дропає —
тримайте міграцію суто адитивною (це вже зафіксовано в `INSIGHTS.md`, див.
коментар у `server/src/db/schema/reviews.ts:54-57`).

### M2. `CREATE INDEX` на `reviews` без `CONCURRENTLY`

`0043_review_annotations.sql:25-26`

Побудова індексу по `reviews` бере `SHARE`-лок на всю таблицю й блокує записи на
час побудови — на найгарячішій таблиці системи це рівно сценарій INC-42, тільки
з іншого боку. При цьому індекс по `annotated_at` не має жодного споживача в цій
гілці: жоден запит у `repository.ts` не фільтрує й не сортує по ньому.

**Як правильно.** Прибрати індекс. Разом із B1 колонки на `reviews` зникають, і
питання знімається саме собою. Якщо колись знадобиться сортування за датою
анотації — індекс буде на власній таблиці, де він дешевий.

### M3. Контрактів немає в жодній копії `vendor/shared`

`routes.ts:3`, `service.ts:1`, `repository.ts:2`

`Annotation`, `AnnotationInput`, `AttachmentInput`, `AttachmentRecord` імпортуються
з `@devdigest/shared`, але grep по `server/src/vendor/shared/` і
`client/src/vendor/shared/` не знаходить жодного з них. Тобто гілка не збереться.

**Як правильно.** Схеми додати в `server/src/vendor/shared` (канонічна копія) і
**віддзеркалити** в `client/src/vendor/shared` — усе, що перетинає дріт,
живе у двох копіях, і правити лише одну не можна. Одна Zod-схема має обслуговувати
і валідацію запиту, і серіалізацію відповіді.

### M4. Модуль не зареєстрований

`routes.ts:17`

У вирізці немає правки `server/src/modules/index.ts`. Без одного імпорту + одного
запису в `modules` маршрути просто не існують, а сам файл впаде на `no-orphans`
(`server/.dependency-cruiser.cjs:43`) з повідомленням «missing registration in
modules/index.ts». Реєстрація навмисно статична — динамічний `import()` `.ts` не
портується між tsx, бандлером і vitest.

### M5. Видалення анотації лишає вкладення сиротами

`service.ts:72-77`, `repository.ts:63-68`

`removeAnnotation` чистить три колонки на `reviews` і не торкається
`annotation_attachments`. Після `DELETE /reviews/:id/annotation` залишаються
вкладення, привʼязані до ревʼю, у якого нотатки більше немає:
`GET /reviews/:id/attachments` їх і далі повертає, а обʼєкти у сховищі не
видаляються ніколи. Це та сама діра, що й у B3, але з боку застосунку.

**Як правильно.** Видалення нотатки — це транзакція: вкладення (рядки + блоби у
сховищі), потім сама анотація. З власною таблицею (B1) це один `DELETE` по
`review_annotations` плюс явне прибирання дітей у сервісі — саме те, чого вимагає
рішення «видалення йдуть через сервіс-власник».

### M6. `row!` в `saveAnnotation` дає 500 замість 404

`repository.ts:39-49`

`.update(...).returning()` на неіснуючому або чужому ревʼю поверне порожній масив,
`row!` перетвориться на `TypeError: Cannot read properties of undefined` і
користувач отримає 500. Зараз від цього рятує `getReview` у сервісі
(`service.ts:29-30`), але це TOCTOU: між перевіркою й записом ревʼю можуть
видалити. Плюс сам метод репозиторію небезпечний при будь-якому іншому виклику.

**Як правильно.** `if (!row) throw new NotFoundError('Review not found')` замість
non-null assertion. Те саме стосується `inserted!` у `insertAttachment`
(`repository.ts:76`).

---

## Дрібне

- **`repository.ts:52-61`** — `getAnnotation` робить `select()` усього рядка
  `reviews` (включно з `summary`, `trace`-суміжними полями), щоб віддати три поля.
  Достатньо явного `select({ ... })`, як у `getReview` поруч.
- **`routes.ts:21-59`** — жоден маршрут не оголошує `response:`. Конвенція
  «одна схема на валідацію і на серіалізацію» реалізована в `brief`
  (`server/src/modules/brief/routes.ts:43`) і `onboarding`
  (`server/src/modules/onboarding/routes.ts:30`); коментарі в `blast`/`smart-diff`,
  що «жоден маршрут не оголошує», уже застарілі. Варто додати — інакше
  внутрішні поля витікають у відповідь без фільтра.
- **`routes.ts:46-52`** — перейменування `content_type → contentType`,
  `storage_key → storageKey` зроблене руками в хендлері. Це трансформація
  контракту: їй місце в Zod-схемі (`.transform(...)`) або в `helpers.ts`, щоб
  маршрут лишався делегуванням.
- **`0043_review_annotations.sql:22-23` + `repository.ts:83-88`** — індекс лише
  по `review_id`, а запит фільтрує по `(workspace_id, review_id)`. Складений
  індекс у цьому порядку відповідав би запиту й тенансі-інваріанту.
- **`schema.excerpt.ts:5-9`** — імпорти вказують на `./workspaces.js`,
  `./pull-requests.js`, `./users.js`. Таких файлів немає: `workspaces` і `users`
  лежать у `./core`, `pullRequests` — у `./pulls`, і всі імпорти в
  `server/src/db/schema/*.ts` безрозширенні. У такому вигляді файл не збереться.
- **`schema.excerpt.ts:35-54`** — `annotation_attachments` не має `created_by`,
  хоча коментар у `server/src/db/schema.ts:4-6` описує `created_by` (FK→users)
  як частину тенансі-конвенції там, де це доречно. Для завантаженого людиною
  файлу це доречно.
- **`repository.ts:104`** — `text: row.annotationText ?? ''` стирає різницю між
  «немає анотації» і «порожній текст». Із власною таблицею (B1) поле стає
  `NOT NULL` і питання зникає.
- **`service.ts:58-61`** — перевірка ліміту вкладень check-then-insert, тобто
  гоночна: два паралельні POST пройдуть обидва. Або обмеження на рівні БД, або
  вставка в транзакції з перерахунком.
- **Тестів у вирізці немає.** Мінімум: `annotations.it.test.ts` (саме такий суфікс
  — юніт- та інтеграційна лінії CI розходяться рівно по цьому глобу) на скоупінг
  по воркспейсу (B5, B6) і на видалення з вкладеннями (M5); плюс юніт на
  `sanitizeFileName`/`isAllowedContentType` — чисті функції, контейнер їм не
  потрібен. Адаптери підмінюються через
  `new Container(config, db, { ... })`, а не `vi.mock` шляху модуля.
- **`helpers.ts` і `constants.ts` у вирізку не потрапили** — `sanitizeFileName`,
  `isAllowedContentType`, `MAX_ATTACHMENTS_PER_REVIEW`, `MAX_ATTACHMENT_BYTES`
  не перевірені. Нагадування: `constants.ts` і `types.ts` — це публічна поверхня
  модуля, решта файлів приватні для інших модулів.

---

## Що зробити перед повторним ревʼю

1. Перенести анотацію у власну таблицю `review_annotations` (B1) — це знімає
   B1, B2 частково, B4, M2 і M6.
2. Усі нові FK перевести на `RESTRICT`, видалення дітей зробити явним у
   `AnnotationsService` і викликати його з `ReviewService.deleteReview` (B2, B3, M5).
3. Закрити тенансі-діри: guard у `attach()`, `workspaceId` у `deleteAttachment`
   (B5, B6).
4. `storage_key` генерує сервер; розмір і тип брати з фактичного обʼєкта (B7).
5. Перегенерувати міграцію через `drizzle-kit generate` (M1).
6. Додати контракти в обидві копії `vendor/shared` і зареєструвати модуль (M3, M4).
7. Прогнати `node scripts/verify.mjs --slice backend` — але памʼятайте, що
   B1–B7 depcruise **не побачить**: там немає жодного забороненого імпорту.
   Зелений CI тут нічого не доводить.
