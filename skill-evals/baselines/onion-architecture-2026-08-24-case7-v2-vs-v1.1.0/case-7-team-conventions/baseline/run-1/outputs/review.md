# Ревʼю гілки `annotations` (L06 — нотатки до ревʼю + вкладення)

Перевірено проти конвенцій DevDigest (onion-architecture, `AGENTS.md`,
`server/.dependency-cruiser.cjs`) і проти реального стану репозиторію.
Шляхи фікстур скорочені до `annotations-branch/<file>`
(повний префікс: `/Users/andriigorbatiuk/Documents/dev-digest/.claude/skills/onion-architecture/evals/fixtures/annotations-branch/`).

Вердикт: **мерджити не можна**. 6 блокерів, з них два ламають деплой (міграція
не застосується, схема не збереться), один — тихо видаляє дані, три —
порушення межі модуля й tenant-ізоляції.

---

## Блокери

### 1. Міграція ніколи не виконається — немає запису в журналі, і номер не той

- **Файл:** `annotations-branch/0043_review_annotations.sql:1` (весь файл)
- **Проблема:** `pnpm db:migrate` → `server/src/db/migrate.ts:30` викликає
  drizzle-мігратор (`drizzle-orm/postgres-js/migrator`), а він бере список
  міграцій **не з диска, а з `src/db/migrations/meta/_journal.json`**. Журнал
  зараз закінчується на `{"idx": 17, "tag": "0017_shallow_swordsman"}`, тобто
  наступний вільний номер — `0018`, а не `0043`, і запису для цього файла в
  журналі немає. Плюс немає `meta/0018_snapshot.json`. Практичний наслідок:
  міграція мовчки не застосується, `db:migrate` вийде з кодом 0 і надрукує
  «✓ migrations applied», а колонок у БД не буде — впаде вже рантайм на
  першому запиті. Це найгірший клас поломки: зелений CI, зелений мігратор,
  червоний прод.
- **Як правильно:** міграції в цьому репо не пишуться руками. Змінити
  `src/db/schema/reviews.ts`, потім `cd server && pnpm db:generate` — drizzle-kit
  сам створить `0018_*.sql`, снапшот і запис у `_journal.json`. Файл `0043_*`
  видалити.

### 2. `schema.excerpt.ts` імпортує файли, яких не існує — пакет не збереться

- **Файл:** `annotations-branch/schema.excerpt.ts:6-9`
- **Проблема:** імпорти вказують на `./workspaces.js`, `./pull-requests.js`,
  `./users.js`. У `server/src/db/schema/` таких файлів немає: `workspaces` і
  `users` живуть у `./core`, `pullRequests` — у `./pulls`. До того ж реальний
  `server/src/db/schema/reviews.ts:1-5` імпортує **без розширення `.js`**
  (`from './core'`, `from './pulls'`, `from './_shared'`) — гілка ще й ламає
  стиль імпортів усередині `db/schema`.
- **Як правильно:**
  ```ts
  import { workspaces, users } from './core';
  import { pullRequests } from './pulls';
  import { now } from './_shared';
  ```

### 3. `onDelete: 'cascade'` на авторі нотатки видаляє саме ревʼю

- **Файл:** `annotations-branch/schema.excerpt.ts:28-30`
- **Проблема:** `annotationAuthorId` — це «хто залишив нотатку», а не власник
  рядка. З `references(() => users.id, { onDelete: 'cascade' })` видалення
  користувача каскадно **видалить увесь рядок `reviews`**: вердикт агента,
  score, summary і всі `findings` (у них свій каскад по `review_id`).
  Звільнився розробник — зникла історія ревʼю його PRів. Каскади в цій схемі
  свідомо йдуть тільки по власнику (`workspace_id`, `pr_id` —
  `server/src/db/schema/reviews.ts:11-18`), і жодна таблиця не каскадить по
  «автору».
- **Як правильно:** `onDelete: 'set null'` (колонка вже nullable, а
  `toAnnotation` у `repository.ts:105` вже вміє `author_id: null`).

### 4. Розбіжність міграції і Drizzle-схеми: FK у SQL просто немає

- **Файли:** `annotations-branch/0043_review_annotations.sql:8` проти
  `annotations-branch/schema.excerpt.ts:28-30`
- **Проблема:** SQL додає `annotation_author_id uuid` **без жодного
  зовнішнього ключа**, а Drizzle декларує FK на `users`. Схема і БД
  розʼїжджаються: наступний `pnpm db:generate` у будь-якої людини згенерує
  «догоняючу» міграцію з `ADD CONSTRAINT`, якої ніхто не планував, а до того
  моменту в колонці можуть лежати id неіснуючих користувачів.
- **Як правильно:** те саме, що в п.1 — не тримати два джерела правди, а
  генерувати SQL зі схеми.

### 5. Модуль пише в чужу таблицю — межа модуля порушена, хоч depcruise мовчить

- **Файл:** `annotations-branch/repository.ts:24-68` (`getReview`,
  `saveAnnotation`, `getAnnotation`, `clearAnnotation` — усі по `t.reviews`)
- **Проблема:** таблицею `reviews` володіє модуль `reviews`:
  `server/src/modules/reviews/repository.ts:5-8` прямо каже «The ONLY layer
  touching the DB for the review domain. Owns `reviews`, `findings`,
  `pr_intent`». `annotations` тепер теж читає і **оновлює** її. Правило
  `no-cross-module-internals` цього не спіймає: імпортується лише
  `db/schema`, що дозволено звідусіль — але звʼязаність рівно та сама, що й
  від `import '../reviews/repository.js'`. Форма поламки типова: модуль
  `reviews` міняє форму рядка або додає свій `.set({...})` поруч — і два
  модулі мовчки перетирають колонки один одного.
- **Як правильно:** два законні варіанти, обидва краще за поточний:
  1. Винести нотатку у власну таблицю `review_annotations`
     (`review_id` PK/unique + `workspace_id`) — тоді модуль володіє своїми
     таблицями, а `attachments` уже й так окрема таблиця. Плюсом зникає
     `UPDATE` по чужому рядку.
  2. Якщо колонки лишаються на `reviews` — ходити через
     `container.reviewRepo` (`server/src/platform/container.ts:111-113`, він
     існує саме для цього) і додати туди workspace-scoped методи. Зауваж, що
     наявний `ReviewRepository.getReview(reviewId)`
     (`server/src/modules/reviews/repository.ts:69`) **не** скоупиться по
     воркспейсу — його теж треба доповнити, а не обходити.

### 6. `attach()` не перевіряє, що ревʼю належить цьому воркспейсу

- **Файл:** `annotations-branch/service.ts:46-70`
- **Проблема:** `upsert` починається з `getReview(workspaceId, reviewId)` і
  кидає 404 (`service.ts:29-30`), а `attach` — ні. Вкладення вставляється з
  `workspaceId` викликача і **довільним** `reviewId`; FK у міграції перевіряє
  лише існування `reviews.id`, не збіг воркспейсів
  (`0043_review_annotations.sql:13-14`). Наслідок — крос-тенантний запис:
  користувач воркспейсу A чіпляє файли до ревʼю воркспейсу B, і вони
  спокійно віддадуться через `GET /reviews/:id/attachments`, бо той запит
  фільтрує по `workspace_id` **і** `review_id` одночасно (`repository.ts:83-89`)
  — тобто рядок став невидимим для власника ревʼю, але не для чужинця.
- **Як правильно:** та сама преамбула, що в `upsert`:
  ```ts
  const review = await this.repo.getReview(workspaceId, reviewId);
  if (!review) throw new NotFoundError('Review not found');
  ```

### 7. `deleteAttachment` не скоупиться по воркспейсу

- **Файл:** `annotations-branch/repository.ts:94-98`
- **Проблема:** `where(eq(t.annotationAttachments.id, attachmentId))` — без
  `workspaceId`. Це прямо суперечить тенантному правилу репозиторію
  (`server/src/db/schema.ts:3-6`: «All queries scope by workspace_id», і
  зразок — `server/src/modules/repos/repository.ts:20-40`, де **кожен** метод
  бере `workspaceId` першим аргументом). Метод зараз нікому не викликається,
  тому це «заряджена рушниця»: перший роут, який його підключить, отримає
  міжворкспейсне видалення.
- **Як правильно:** `and(eq(...workspaceId, workspaceId), eq(...id, attachmentId))`
  і `workspaceId` першим параметром — або видалити метод, поки він не потрібен.

---

## Важливе (не блокує збірку, але поїде в прод як баг)

### 8. `storage_key` і `bytes` приходять від клієнта

- **Файли:** `annotations-branch/routes.ts:46-52`, `annotations-branch/service.ts:49,54-56,68`
- **Проблема:** ліміт `MAX_ATTACHMENT_BYTES` перевіряється по числу, яке
  надіслав клієнт — тобто це не ліміт, а прохання. А `storage_key` дозволяє
  клієнту вказати довільний ключ у сховищі: як мінімум перетерти/зачитати
  чужий обʼєкт, як максимум — вийти за префікс воркспейсу. `sanitizeFileName`
  застосовується тільки до `name` (`service.ts:65`), до `storageKey` — ні.
- **Як правильно:** `storage_key` генерує сервер
  (`${workspaceId}/${reviewId}/${randomUUID()}`), розмір береться з реального
  завантаження/HEAD у сховищі, а не з тіла запиту. Якщо на цьому етапі
  завантаження ще немає, приймати `bytes` як підказку, але перевіряти після
  факту.

### 9. `row!` перетворює гонку на 500

- **Файл:** `annotations-branch/repository.ts:39-49`
- **Проблема:** `UPDATE ... .returning()` поверне порожній масив, якщо ревʼю
  зникло між перевіркою в `service.ts:29` і записом. `toAnnotation(row!)` дасть
  `TypeError` і 500 замість чесного 404.
- **Як правильно:** `if (!row) return null` і кинути `NotFoundError` у сервісі
  (або `throw new NotFoundError('Review not found')` прямо тут — але краще у
  сервісі, де вже є така гілка).

### 10. Видалення нотатки лишає вкладення-сироти

- **Файли:** `annotations-branch/service.ts:72-77`, `annotations-branch/repository.ts:63-68`
- **Проблема:** за коментарем міграції «attachments hang off it»
  (`0043_review_annotations.sql:5`), тобто вкладення належать нотатці.
  `clearAnnotation` занулює три колонки на `reviews`, а рядки
  `annotation_attachments` лишаються: `DELETE /annotation` → `GET /attachments`
  досі повертає файли неіснуючої нотатки. FK-каскад теж не спрацює — він
  на `review_id`, а ревʼю нікуди не поділося.
- **Як правильно:** видаляти вкладення в одній транзакції з нотаткою, або
  свідомо задокументувати, що вкладення живуть на ревʼю, а не на нотатці — і
  тоді прибрати з міграції формулювання про «hang off it». Мовчазної третьої
  опції тут немає.

### 11. Індекси: один зайвий у SQL, один відсутній у схемі, один не по тій формі запиту

- **Файли:** `annotations-branch/0043_review_annotations.sql:22-26`,
  `annotations-branch/schema.excerpt.ts:51-53`
- **Проблема, три штуки:**
  1. `reviews_annotated_at_idx` створюється в SQL, але **в Drizzle-схемі його
     немає** — наступний `db:generate` згенерує `DROP INDEX`.
  2. `annotation_attachments_review_idx` — тільки по `review_id`, а єдиний
     реальний запит фільтрує по парі `(workspace_id, review_id)`
     (`repository.ts:83-89`). Конвенція репо — саме композитний тенантний
     індекс: `0014_conventions_tenant_index.sql` існує рівно для того, щоб
     переробити одноколонковий індекс у `("workspace_id","repo_id")`, а
     `server/src/db/schema/knowledge.ts:77` це закріплює.
  3. `IF NOT EXISTS` у `CREATE TABLE`/`CREATE INDEX` не зустрічається в жодній
     згенерованій міграції репо (у `0000_init.sql` — 0 входжень), як і
     розділювачі `--> statement-breakpoint`, які є в кожній
     (`0017_shallow_swordsman.sql`). Ще один симптом того, що файл написали
     руками замість `db:generate`.

### 12. Жоден маршрут не оголошує response-схему

- **Файл:** `annotations-branch/routes.ts:21,26-33,35,41-54,56`
- **Проблема:** `server/src/modules/_shared/schemas.ts:14-27` формулює це як
  вимогу, а не побажання: серіалізатор валідує те, що виходить із процесу, і
  без `response` хендлер, який почав повертати сирий Drizzle-рядок (з
  `workspaceId`, внутрішніми полями), мовчки розширює публічний API. Тут це не
  теорія: `getAnnotation` повертає результат `select()` **усього рядка
  `reviews`** (`repository.ts:53-57`) — досить одного недогляду в мапері, щоб
  віддати назовні чужі колонки. Зразки правильного оформлення:
  `server/src/modules/brief/routes.ts:43,53`,
  `server/src/modules/onboarding/routes.ts:30`.
- **Як правильно:** `response: { 200: Annotation.nullable() }`,
  `{ 200: AttachmentRecord }`, `{ 200: z.array(AttachmentRecord) }`, а для
  `DELETE` — готовий `OkResponse` з `_shared/schemas.ts:26` замість
  рукописного `{ ok: true }` (`routes.ts:38`). До речі, `OkResponse` досі ніде
  не використаний — цей роут його перший законний споживач.

### 13. `getAnnotation` тягне всі колонки чужої таблиці

- **Файл:** `annotations-branch/repository.ts:52-57`
- **Проблема:** `select()` без списку колонок по `t.reviews`, тоді як сусідній
  `getReview` (`repository.ts:25-29`) робить правильно — явний список. Разом з
  п.12 це і є той шлях, яким внутрішні поля ревʼю опиняються у відповіді.
- **Як правильно:** `select({ id, annotationText, annotationAuthorId, annotatedAt })`.

---

## Дрібніше

### 14. Порожній текст має відсікатися Zod на межі, а не в сервісі

- **Файл:** `annotations-branch/service.ts:32-33`
- Конвенція — «parse at the boundary; inside the rings the data is already
  trusted». `input.text.trim().length === 0` у сервісі означає, що схема
  `AnnotationInput` пропускає `"   "`. Правильно: `z.string().trim().min(1)` у
  контракті — тоді 422 віддасть валідатор до входу в хендлер, а сервіс не
  дублює перевірку. Окремо: `new AppError('empty_annotation', ..., 422)`
  дублює готовий `ValidationError` (`server/src/platform/errors.ts:27-31`) —
  свій код лишати варто лише якщо UI на нього реагує окремо.

### 15. Мапінг snake→camel живе в роуті

- **Файл:** `annotations-branch/routes.ts:46-52`
- Роут — це транспорт: розпарсити, викликати, віддати. Розпакування
  `content_type/storage_key` у доменні імена — трансформація, її місце в
  `helpers.ts` модуля (або в сервісі, який приймає DTO як є). Решта роутів у
  файлі тонкі й гарні — цей один вибивається.

### 16. Перевірка ліміту вкладень — гонка

- **Файл:** `annotations-branch/service.ts:58-61`
- `listAttachments().length >= MAX` між читанням і вставкою нічим не захищено;
  два паралельні POST пройдуть обидва. Для UI-ліміту це терпимо, але якщо
  ліміт справді жорсткий — потрібен констрейнт/`INSERT ... WHERE` у БД, а не
  перевірка в памʼяті.

---

## Не входить у фікстуру — перевірити перед мерджем

Це не претензії до коду, а очевидні дірки в наборі файлів гілки:

1. **`helpers.ts` і `constants.ts`** — `service.ts:5-6` імпортує
   `sanitizeFileName`, `isAllowedContentType`, `MAX_ATTACHMENTS_PER_REVIEW`,
   `MAX_ATTACHMENT_BYTES`, але самих файлів у гілці немає. Нагадування: саме
   `constants.ts`/`types.ts` є публічною поверхнею модуля.
2. **Контракти `@devdigest/shared`** — `Annotation`, `AnnotationInput`,
   `AttachmentInput`, `AttachmentRecord` не існують ані в
   `server/src/vendor/shared/contracts/`, ані в клієнтській копії. Треба:
   новий файл контрактів + експорт у `server/src/vendor/shared/index.ts`, а
   потім **дзеркало** в `client/src/vendor/shared/contracts/` — це прямий
   пункт `AGENTS.md` («ніколи не правити лише одну копію»), і саме тут його
   найлегше забути, бо серверна збірка від цього не зламається.
3. **Реєстрація модуля** — `annotations` немає в
   `server/src/modules/index.ts:30-46`. Без одного імпорту і одного рядка в
   реєстрі жоден із пʼяти маршрутів не підніметься, а depcruise додатково
   поскаржиться `no-orphans`.
4. **Тести** — DB-backed тести модуля мають називатися `*.it.test.ts`
   (юніт- і інтеграційна доріжки CI розділяються рівно за цим глобом), а
   підміна портів — через `new Container(config, db, overrides)`, не `vi.mock`.

---

## Що зроблено правильно

Щоб не створювати враження, ніби гілка вся червона — каркас якраз онійний:

- Роути тонкі: `getContext` → сервіс → повернення, жодного Drizzle на межі
  (`routes.ts:21-59`) — `routes-through-service` чистий.
- Сервіс приймає **resolved values** (`workspaceId`, `userId`, `reviewId`,
  розпакований DTO), а не `FastifyRequest` — його можна викликати з джоби
  (`service.ts:23-28,46-50`).
- Сервіс бере `Container` і будує свій репозиторій з `container.db`
  (`service.ts:19-21`) — рівно форма `modules/repos/service.ts`.
- Помилки — доменні `AppError`/`NotFoundError` зі статусами, роути їх руками
  не мапають.
- Репозиторій — єдине місце з SQL, і має мапери рядок→DTO
  (`repository.ts:101-119`).

Тобто виправляти треба не структуру, а межі даних: чужа таблиця (п.5),
tenant-скоуп (п.6, 7), і весь блок міграції/схеми (п.1-4, 11).
