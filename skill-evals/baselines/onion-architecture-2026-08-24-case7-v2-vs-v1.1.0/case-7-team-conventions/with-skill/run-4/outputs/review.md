# Ревʼю гілки `annotations` (L06)

Матеріал: `.claude/skills/onion-architecture/evals/fixtures/annotations-branch/`
(`0043_review_annotations.sql`, `schema.excerpt.ts`, `routes.ts`, `service.ts`, `repository.ts`).

**Вердикт: не мерджити.** Шар routes/service/repository зроблено правильно (роут делегує,
сервіс бере `Container` і резолвнуті значення, репозиторій — єдине місце з Drizzle), і
depcruise на цьому буде зелений. Але гілка порушує обидва командні рішення щодо схеми,
які жоден лінтер не бачить, і має кілька дірок у тенант-скоупінгу. Нижче — за
пріоритетом.

---

## Блокери

### B1. Нові колонки додано в `reviews` — таблиця закрита для нових колонок

- `0043_review_annotations.sql:7-9` — `ALTER TABLE "reviews" ADD COLUMN "annotation_text" / "annotation_author_id" / "annotated_at"`
- `schema.excerpt.ts:27-31` — ті самі три поля в `pgTable('reviews', …)`

Командне рішення від 12/06/2026 (після INC-42): `reviews` — найгарячіша таблиця, її
читає кожен екран, і додавання `model` свого часу переписало таблицю на демо-інстансі,
тримаючи `ACCESS EXCLUSIVE` майже чотири хвилини; ревʼю, яке в той момент виконувалось,
померло на пів-дорозі й лишилось напівзаписаним рядком. Тому **per-review дані, які не є
самим вердиктом — анотації, стан доставки, розбивка вартості — живуть у власній таблиці з
ключем `review_id` і джойняться на читанні.** `findings` і `trace` широкі та
grandfathered; це причина, чому таблиця важка, а не дозвіл додати третє.

Анотація — це рівно той випадок, від якого рішення й захищає: людський коментар, який не
є вердиктом агента.

**Як правильно.** Окрема таблиця, наприклад:

```sql
CREATE TABLE "review_annotations" (
  "review_id" uuid PRIMARY KEY REFERENCES "reviews"("id") ON DELETE RESTRICT,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  "text" text NOT NULL,
  "author_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "annotated_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
```

`reviews` не чіпаємо взагалі. Це заодно прибирає B3, D2 і D3 нижче: `getAnnotation`
перестає читати `SELECT *` з гарячої таблиці, `saveAnnotation` перестає її оновлювати, а
"немає анотації" стає відсутністю рядка замість `annotation_text IS NULL`. І `PRIMARY KEY
(review_id)` дає обмеження «одна нотатка на ревʼю» на рівні БД, чого зараз немає ніде.

### B2. Усі нові FK — `ON DELETE CASCADE`; за домовленістю нові FK — `RESTRICT`

- `0043_review_annotations.sql:13` — `workspace_id … REFERENCES "workspaces"("id") ON DELETE CASCADE`
- `0043_review_annotations.sql:14` — `review_id … REFERENCES "reviews"("id") ON DELETE CASCADE`
- `schema.excerpt.ts:28-30` — `annotationAuthorId … references(() => users.id, { onDelete: 'cascade' })`
- `schema.excerpt.ts:41`, `schema.excerpt.ts:44` — те саме для `annotation_attachments`

Рішення від 03/05/2026: після того як прибирання воркспейсу тихо винесло репозиторій разом
із 40k findings і аудит-рядками (помітили через два тижні — помилки ж не було), **нові FK
не каскадять**; видалення дітей робить сервіс-власник явно, у порядку, який сам обирає, і
може залогувати чи відмовити. Наявні каскади лишаються — це окрема міграція окремого дня —
але копіювати їх у нову таблицю не можна. У схемі зараз 50 FK і всі до одного `cascade`;
саме тому це рішення й записане: **схема тут сперечатиметься з вами, і наслідування
навколишнього стилю — хибний інстинкт**.

Найгірший із трьох — `annotation_author_id → users ON DELETE CASCADE` у
`schema.excerpt.ts:28-30`. Це FK-колонка **на самій `reviews`**, тож видалення користувача
видаляє не його нотатку, а **весь рядок ревʼю** — з findings і trace по існуючому каскаду.
Звільнився автор нотатки — зникло ревʼю. Це той самий сценарій, тільки дорожчий.

**Як правильно.** `ON DELETE RESTRICT` на всіх трьох нових FK. Видалення ревʼю
(`ReviewRepository.deleteReview(workspaceId, reviewId)`) має спершу явно видалити анотацію
та її вкладення — і це вже друга причина, чому анотація має бути окремою таблицею з
власним репозиторієм: тоді сервіс ревʼю викликає `container.annotationsRepo.deleteForReview(…)`
перед видаленням ревʼю. Якщо команда вважає, що тут каскад справді доречний — це треба
проговорити в описі PR і отримати згоду, а не лишити дефолтом.

### B3. Модуль анотацій пише в таблицю чужого модуля

- `repository.ts:24-32` (`getReview`), `repository.ts:34-50` (`saveAnnotation`),
  `repository.ts:52-61` (`getAnnotation`), `repository.ts:63-68` (`clearAnnotation`)

Усі чотири методи звертаються до `t.reviews` через `container.db`. Формально це імпорт
лише `db/schema` — легально скрізь, depcruise промовчить (`no-cross-module-internals`
ловить імпорт `../reviews/repository.js`, а не інлайн-запит до `t.reviews`). По суті
звʼязаність та сама: форма таблиці чужого модуля тепер ваша, і зламати її може будь-хто.
Тим паче що `saveAnnotation` і `clearAnnotation` **мутують** рядки `reviews` повз
`ReviewRepository`, який уже висить на контейнері (`container.reviewRepo`,
`platform/container.ts:111-113`) і має власний `getReview`.

**Як правильно.** Після B1 записи анотації йдуть у власну таблицю, і `t.reviews` лишається
потрібним рівно для однієї перевірки «ревʼю існує в цьому воркспейсі» — а її треба брати з
`container.reviewRepo`, а не переписувати `getReview` тут. Якщо потрібного методу там
немає — це і є зміна, яку треба зробити (додати його в `ReviewRepository`), а не обходити
її локальним запитом.

### B4. `attach()` не перевіряє, що ревʼю існує й належить воркспейсу

- `service.ts:46-70` — на відміну від `upsert()` (`service.ts:29-30`), тут немає
  `getReview` + `NotFoundError`
- `routes.ts:41-54` — `reviewId` приходить прямо з URL

`insertAttachment` (`repository.ts:70-77`) підставляє `workspaceId` з контексту, а
`reviewId` — з параметра, і FK на `reviews` перевіряє лише існування рядка, не його
воркспейс. Тобто користувач воркспейсу A може прикріпити файл до ревʼю воркспейсу B: рядок
пройде FK, збережеться з `workspace_id = A`, і власник ревʼю його не побачить, а квоти й
сторедж витратяться. Це крос-тенантний запис.

**Як правильно.** Той самий guard, що й в `upsert`:

```ts
const review = await this.repo.getReview(workspaceId, reviewId); // краще — container.reviewRepo
if (!review) throw new NotFoundError('Review not found');
```

І так само в `listAttachments` (`service.ts:79-81`) — зараз неіснуюче/чуже ревʼю віддає
порожній масив 200 замість 404.

### B5. `deleteAttachment` не скоупиться за `workspaceId`

- `repository.ts:94-98` — `.delete(t.annotationAttachments).where(eq(t.annotationAttachments.id, attachmentId))`

Кожен запит репозиторію має бути обмежений `workspaceId` — це пункт чек-листа модуля, і
єдине, що стоїть між знанням UUID і видаленням чужого рядка. Метод зараз нікуди не
підключений (роута немає), тобто це мертвий код із готовою IDOR-дірою — його або приберіть
до наступної гілки, або одразу зробіть правильно:

```ts
async deleteAttachment(workspaceId: string, attachmentId: string): Promise<void> {
  await this.db.delete(t.annotationAttachments).where(
    and(
      eq(t.annotationAttachments.workspaceId, workspaceId),
      eq(t.annotationAttachments.id, attachmentId),
    ),
  );
}
```

### B6. Клієнт диктує `storage_key` і `bytes` — ліміт розміру неможливо забезпечити

- `routes.ts:46-52` — `const { name, content_type, bytes, storage_key } = req.body`
- `service.ts:54-56` — `if (file.bytes > MAX_ATTACHMENT_BYTES)`
- `repository.ts:70-77` — обидва значення пишуться як є

`bytes` — це те, що надіслав клієнт, а не розмір реального обʼєкта, тож перевірка ліміту
перевіряє чуже число: `{"bytes": 1}` проходить для файла будь-якого розміру. `storage_key`
теж прийшов ззовні — це фактично керований користувачем шлях у сторедж, з усім, що з цього
випливає (вказати на чужий обʼєкт, перезаписати, вийти за префікс).

**Як правильно.** Ключ генерує сервер (`workspaceId/reviewId/uuid`), розмір бере з
результату завантаження або з `Content-Length` самого стріму, а не з тіла JSON. Якщо
завантаження робить окремий крок — сервер має видати presigned-ключ і потім звірити
фактичний розмір обʼєкта перед вставкою рядка.

---

## Важливе

### M1. Міграція і Drizzle-схема розʼїхались у трьох місцях

1. `schema.excerpt.ts:28-30` оголошує FK `annotation_author_id → users`, а
   `0043_review_annotations.sql:8` створює просто `uuid` **без `REFERENCES`**. У БД
   обмеження не буде взагалі.
2. `0043_review_annotations.sql:25-26` створює `reviews_annotated_at_idx`, якого немає в
   `schema.excerpt.ts` (у `reviews` взагалі не оголошено індексів у цій вирізці).
3. `annotation_attachments` у SQL має індекс лише по `review_id`, і в схемі так само — але
   всі запити фільтрують `workspace_id + review_id` (`repository.ts:83-89`).

Drizzle-схема — джерело правди для `db:generate`; будь-який наступний `generate` побачить
цей дрейф і згенерує міграцію, яка «доробить» FK і **прибере** незадекларований індекс.
Правте схему й перегенеровуйте міграцію, а не пишіть SQL руками поверх.

### M2. Міграція не зареєстрована в журналі — вона просто не застосується

- файл `0043_review_annotations.sql` при тому, що в `server/src/db/migrations/` останній —
  `0017_shallow_swordsman.sql`

`pnpm db:migrate` іде через `drizzle-orm/postgres-js/migrator`
(`server/src/db/migrate.ts:29`), який читає `meta/_journal.json`, а не лістинг теки. Файл,
якого немає в журналі, тихо ігнорується: команда виходить з кодом 0, сервер стартує, і
кожен запит анотацій падає в рантаймі на `column "annotation_text" does not exist`. Плюс
номер 0043 при поточному 0017 лишає дірку в нумерації. Міграцію треба отримати з
`pnpm db:generate` після правки схеми — тоді і номер, і журнал будуть узгоджені.

### M3. `CREATE INDEX` без `CONCURRENTLY` на найгарячішій таблиці

- `0043_review_annotations.sql:25-26`

Навіть якщо забути про B1, побудова індексу по `reviews` бере `SHARE`-лок і блокує всі
записи в таблицю на час побудови — той самий клас інциденту, що й INC-42, тільки мʼякший.
Після переїзду анотацій в окрему таблицю індекс по `annotated_at` будується на маленькій
таблиці й проблема зникає сама; якщо індекс усе ж потрібен на `reviews` — тільки
`CREATE INDEX CONCURRENTLY` окремою міграцією (і памʼятайте, що drizzle обгортає міграції
в транзакцію, тож `CONCURRENTLY` потребує `--> statement-breakpoint` / окремого файлу).

### M4. Контракти `@devdigest/shared` у гілці відсутні й не задзеркалені в клієнт

- `routes.ts:3` — `import { AnnotationInput, AttachmentInput } from '@devdigest/shared'`
- `service.ts:1`, `repository.ts:2` — `Annotation`, `AttachmentRecord`

Жодного з цих чотирьох імен зараз немає в `server/src/vendor/shared/contracts/*`, і в
матеріалах гілки їх теж немає. Нагадування: `@devdigest/shared` існує **двічі** —
канонічна копія в `server/src/vendor/shared`, урізана в `client/src/vendor/shared`; усе,
що перетинає дріт (а ці схеми перетинають), треба додати в серверну копію й
**віддзеркалити в клієнтську**. Правити лише одну — гарантований дрейф.

Там же варто вирішити долю `helpers.ts` і `constants.ts`: `service.ts:5-6` імпортує
`sanitizeFileName`, `isAllowedContentType`, `MAX_ATTACHMENTS_PER_REVIEW`,
`MAX_ATTACHMENT_BYTES`, але цих файлів у гілці немає — без них модуль не збереться. І
`routes.ts` не зареєстровано в `server/src/modules/index.ts` (один імпорт + один запис),
тож зараз він нікуди не підключений.

### M5. Гонка на ліміті вкладень

- `service.ts:58-61` — `listAttachments` → перевірка `>= MAX_ATTACHMENTS_PER_REVIEW` → `insertAttachment`

Класичний TOCTOU: два паралельні POST бачать однакову кількість і обидва вставляють. Ліміт
у коді без обмеження в БД — це побажання. Або рахуйте й вставляйте в одній транзакції з
блокуванням, або (простіше) додайте порядковий номер вкладення з `UNIQUE (review_id, seq)`.

---

## Дрібне

### L1. `row!` після `UPDATE … RETURNING` дасть 500 замість 404

`repository.ts:39-49` — `saveAnnotation` робить `UPDATE … RETURNING` і бере `row!`. Між
перевіркою існування в `service.ts:29` і цим апдейтом ревʼю можуть видалити; тоді
`returning()` поверне порожній масив, `toAnnotation(undefined)` кине `TypeError`, і клієнт
отримає 500 замість 404. Перевіряйте `if (!row) throw new NotFoundError(…)`.

### L2. `getAnnotation` тягне весь рядок `reviews`

`repository.ts:52-57` — `select()` без списку колонок з таблиці, яка містить `summary`,
`trace`-суміжні поля тощо, щоб дістати три значення. Після B1 це зникає; доти —
перелічуйте колонки явно, як це вже зроблено в `getReview` (`repository.ts:26`).

### L3. Нотатка перезаписується мовчки

`service.ts:23-40` — `upsert` затирає чужий текст і підставляє нового `author_id` без
жодної ознаки, що там уже щось було. Одна нотатка на ревʼю — нормальне рішення, але тоді
або віддавайте 409 на спробу переписати чужу, або зберігайте попередню версію. Зараз
«єдине місце, де ця відповідь виживає» (за коментарем у `service.ts:11-14`) перезаписується
одним PUT.

### L4. Немає `response`-схем

`routes.ts` оголошує `params`/`body`, але не `response`. За конвенцією одна Zod-схема має
керувати і валідацією запиту, і серіалізацією відповіді — тоді `Annotation` /
`AttachmentRecord` не зможуть тихо розʼїхатись із тим, що реально летить у клієнт.
Кодова база тут непослідовна (`brief`, `onboarding` оголошують, решта — ні), тож це не
блокер, але нові роути варто писати за конвенцією. Заодно `{ ok: true }` у
`routes.ts:38` — єдина відповідь, зібрана руками.

---

## Що зроблено добре

- Роути — чистий транспорт: `getContext` для тенансі, Zod на `params`/`body`, делегування
  в сервіс, жодного SQL на краю.
- Сервіс бере `Container` і резолвнуті значення (`workspaceId`, `userId`, `reviewId`),
  ніде не згадує `FastifyRequest` — навіть як тип.
- Репозиторій будується з `container.db` у конструкторі сервісу — рівно за формою
  `modules/repos/service.ts`.
- Помилки кидаються як `AppError` / `NotFoundError` зі статусами; роут не мапить їх руками.
- Мапери `toAnnotation` / `toAttachment` тримають snake_case дроту окремо від camelCase
  Drizzle, і `storage_key` не витікає в `AttachmentRecord`.

## Порядок правок

1. Перенести анотацію в `review_annotations` (B1) — це знімає B3 частково, M3 і L2.
2. Усі нові FK → `RESTRICT`, видалення дітей — у сервісі ревʼю (B2).
3. Закрити тенансі-дірки: guard в `attach`/`listAttachments` (B4), `workspaceId` у
   `deleteAttachment` (B5).
4. Ключ і розмір вкладення генерує/перевіряє сервер (B6).
5. Перегенерувати міграцію з `pnpm db:generate` (M1, M2), додати контракти в обидві копії
   `vendor/shared`, дописати `helpers.ts`/`constants.ts` і запис у `modules/index.ts` (M4).
