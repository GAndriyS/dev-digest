# Ревʼю гілки `annotations` (L06) — перед мерджем

Матеріал ревʼю: `.claude/skills/onion-architecture/evals/fixtures/annotations-branch/`
(`0043_review_annotations.sql`, `schema.excerpt.ts`, `routes.ts`, `service.ts`, `repository.ts`).
Правки не вносив — нижче тільки перелік проблем.

Загальне враження: форма модуля правильна (routes → service → repository, сервіс бере
`Container`, значення в сервіс приходять уже розібрані, помилки — `AppError`/`NotFoundError`).
Проблеми не у формі, а в тому, чого dependency-cruiser не бачить: чужа таблиця,
міграція, яка ніколи не застосується, і межа довіри на аттачментах.

Вердикт: **мерджити не можна** — 4 блокери.

---

## Блокери

### 1. Модуль `annotations` читає й пише чужу таблицю `reviews`

`repository.ts:24-32` (`getReview`), `repository.ts:39-50` (`saveAnnotation`),
`repository.ts:52-61` (`getAnnotation`), `repository.ts:63-68` (`clearAnnotation`).

Усі чотири методи ходять напряму в `t.reviews` через власний `Db`. Таблиця `reviews`
належить модулю `reviews` — це прямо записано в його репозиторії:
`server/src/modules/reviews/repository.ts:5-8` — «A2 — review data-access. The ONLY layer
touching the DB for the review domain. Owns `reviews`, `findings`, `pr_intent`».

Чому це проблема, хоча CI зелений: `no-cross-module-internals` спрацював би на
`import ... from '../reviews/repository.js'`, але тут імпортується лише `db/schema` —
легальний імпорт звідусіль. Звʼязаність від цього нікуди не ділася: форма рядка
`reviews` тепер належить і цьому модулю теж, і будь-яка зміна в модулі `reviews`
(перейменування колонки, звуження `select`, зміна тенант-скоупінгу) мовчки ламає
анотації. Це саме той випадок, коли білд лишається зеленим, а межа зламана.

Як правильно: дані чужого модуля беруться з його репозиторію на контейнері —
`container.reviewRepo` вже існує (`server/src/platform/container.ts:111-113`).
Практично:

- `getReview` замінити на виклик `container.reviewRepo`. Увага: наявний
  `ReviewRepository.getReview(reviewId)`
  (`server/src/modules/reviews/repository.ts:69-71`) **не скоупиться по workspace** —
  тож правильний рух не «викликати як є», а додати в `ReviewRepository`
  workspace-скоуплений геттер і використати його.
- Запис/читання/очищення анотації — теж методи `ReviewRepository`
  (`setAnnotation` / `getAnnotation` / `clearAnnotation`), бо вони мутують рядок
  `reviews`. Модуль `annotations` тоді володіє тільки `annotation_attachments` —
  своєю власною таблицею, і це чесно.

Альтернатива, яка розвʼязує вузол архітектурно, а не косметично: винести анотацію в
окрему таблицю-сателіт `review_annotations` (PK = `review_id`, FK → `reviews`, як уже
зроблено для `pr_intent` та `pr_brief` у `server/src/db/schema/reviews.ts:47-49,74-77`).
Тоді модуль володіє обома своїми таблицями, `container.reviewRepo` потрібен лише щоб
перевірити існування ревʼю, а `ALTER TABLE reviews` з міграції зникає взагалі.
Це найчистіший варіант і він відповідає патерну, який у схемі вже двічі застосований.

### 2. Міграція ніколи не застосується

`0043_review_annotations.sql` — увесь файл.

Три окремі поламки:

- **Немає запису в журналі.** `server/src/db/migrate.ts:29-30` застосовує міграції
  через `drizzle-orm/postgres-js/migrator`, а той читає `src/db/migrations/meta/_journal.json`
  і виконує лише те, що там перелічено. Файлу `0043_review_annotations` у журналі нема
  → `pnpm db:migrate` відпрацює, вийде з кодом 0 і не зробить нічого. Помилки не буде —
  буде 500 на першому ж запиті до `annotation_text`.
- **Номер поза послідовністю.** Останнє в `src/db/migrations/` — `0017_shallow_swordsman.sql`,
  останній `idx` у журналі — 17. Наступний вільний номер `0018`, а не `0043`.
- **Міграція написана руками.** Конвенція репозиторію — `pnpm db:generate`
  (`server/package.json:13`, `drizzle.config.ts` з `schema: './src/db/schema.ts'`).
  Ручний SQL і згенерований журнал розʼїжджаються за визначенням.

Як правильно: змінити тільки `src/db/schema/*.ts`, потім `cd server && pnpm db:generate` —
drizzle-kit сам покладе `0018_*.sql` і додасть запис у `meta/_journal.json`. Далі
`pnpm db:migrate`. Ручний файл видалити.

(Побічно, як окремий крок: `.../AGENTS.md` забороняє редагувати вже застосовані
`src/db/migrations/*.sql` — новий файл додавати можна, але саме згенерований.)

### 3. `annotation_author_id`: FK є в схемі, немає в SQL — і сам `onDelete` неправильний

`schema.excerpt.ts:28-30` проти `0043_review_annotations.sql:8`.

Drizzle оголошує `annotationAuthorId` з `.references(() => users.id, { onDelete: 'cascade' })`,
а SQL додає просто `uuid` без жодного `REFERENCES`. Дві незалежні проблеми в одному місці:

- **Розʼїзд схеми й БД.** Наступний `db:generate` побачить відсутній констрейнт і
  згенерує «догоняючу» міграцію — або, гірше, drizzle-kit піде в інтерактивний промпт
  (цей граблі вже задокументовані в `server/src/db/schema/reviews.ts:55-57`, посилання
  на `INSIGHTS.md:91-96`). У БД тим часом жодної гарантії цілісності на автора немає.
- **`onDelete: 'cascade'` тут — руйнівний.** Це колонковий FK на рядку `reviews`:
  видалення користувача каскадом знесе **весь рядок ревʼю**, а разом із ним (по FK
  `findings.review_id ON DELETE CASCADE`, `server/src/db/schema/reviews.ts:29-31`) —
  усі його findings. Тобто видалення однієї людини стирає результати роботи агента.
  Має бути `onDelete: 'set null'`: автор зник — анотація лишається, підпис знімається.
  Колонка вже nullable, тож `set null` пройде без додаткових змін.

Як правильно: у `schema/reviews.ts` поставити `{ onDelete: 'set null' }` і
перегенерувати міграцію — SQL тоді отримає FK автоматично й обидві сторони збіжаться.

### 4. `attach` не перевіряє, що ревʼю існує і належить цьому workspace

`service.ts:46-70`, разом із `repository.ts:70-77` (`insertAttachment`).

`upsert` (`service.ts:29-30`) сумлінно робить `getReview` і кидає `NotFoundError`.
`attach` цю перевірку не робить взагалі: `workspaceId` береться з контексту виклику,
`reviewId` — з URL, і рядок вставляється як є.

Наслідок — крос-тенантне псування даних. Клієнт із workspace A передає `:id` ревʼю з
workspace B: FK `review_id → reviews.id` задоволений (ревʼю справді існує), запис
проходить, і в `annotation_attachments` зʼявляється рядок, у якого `workspace_id`
суперечить `workspace_id` самого ревʼю. Далі `listAttachments` цього вкладення не
покаже (воно фільтрує по workspace A і по review B — збіг є, тож насправді **покаже**),
а ось модуль `reviews` про нього не знатиме ніколи. У будь-якому разі інваріант
«workspace_id вкладення = workspace_id ревʼю» БД не тримає, а код не перевіряє.

Як правильно: на початку `attach` — той самий guard, що і в `upsert`, через
workspace-скоуплений геттер ревʼю (див. блокер 1), і `NotFoundError`, якщо ревʼю нема
в цьому workspace. Тенант-правило репозиторію сформульоване в
`server/src/db/schema.ts:4-6`: «All queries scope by workspace_id».

---

## Важливе (полагодити до мерджу, але не архітектурні блокери)

### 5. `deleteAttachment` не скоуплений по workspace

`repository.ts:94-98`.

```ts
async deleteAttachment(attachmentId: string): Promise<void> {
  await this.db.delete(t.annotationAttachments).where(eq(t.annotationAttachments.id, attachmentId));
}
```

Єдиний запит у файлі без `workspaceId` у `where` — прямий IDOR, щойно зʼявиться
роут, який його викличе. Правило репозиторію («кожен запит скоупиться по
`workspaceId`») тут порушене буквально.

Додатково: метод зараз **мертвий** — його не викликає ні `service.ts`, ні `routes.ts`,
і DELETE-роута для вкладення в модулі немає. Або приберіть його з цієї гілки, або
додайте роут і сигнатуру `deleteAttachment(workspaceId: string, attachmentId: string)`
з `and(eq(workspaceId), eq(id))`.

### 6. Ліміт на кількість вкладень — read-then-write без транзакції

`service.ts:58-61`.

`listAttachments` → перевірка `>= MAX_ATTACHMENTS_PER_REVIEW` → `insertAttachment`:
три окремі запити, нічим не звʼязані. Два паралельні POST на ліміті обидва прочитають
`existing.length === MAX - 1`, обидва пройдуть перевірку, обидва вставлять. Ліміт, який
можна обійти двома одночасними запитами, — це не ліміт.

Як правильно: або обгорнути перевірку+вставку в одну транзакцію репозиторію (щоб і
читання, і запис були в одному місці — це, до речі, знову аргумент тримати логіку
підрахунку в repository), або підперти інваріант у БД. Мінімум — транзакція.

### 7. `bytes` і `storage_key` приходять від клієнта і не перевіряються

`routes.ts:46-52` → `service.ts:49,54,63-69`.

`byte_size` — це те число, яке клієнт написав у тілі запиту, а не реальний розмір
обʼєкта у сховищі. Перевірка `file.bytes > MAX_ATTACHMENT_BYTES` (`service.ts:54`)
таким чином перевіряє чесність клієнта, а не файл.

`storage_key` — теж довільний рядок від клієнта, який осідає в БД як вказівник у
сховище. Ніде не звіряється, що ключ належить цьому workspace / цьому ревʼю. Хто
завгодно може привʼязати до свого ревʼю ключ чужого обʼєкта і потім прочитати його
через `GET /reviews/:id/attachments`.

Zod на межі тут не рятує — він валідує форму, а не походження. Це саме той випадок,
про який каже правило «parse at the boundary; inside the rings the data is already
trusted»: дані *не* можна вважати довіреними, бо вони не резолвлені, а заявлені.

Як правильно: `storageKey` має **породжуватися** сервером (наприклад
`${workspaceId}/${reviewId}/${uuid}`), а не прийматися; `byteSize` — братися з
метаданих реального обʼєкта у сховищі після завантаження. Якщо сховище зʼявиться
пізніше, воно має прийти як **порт** у `server/src/vendor/shared/adapters.ts` +
адаптер у `server/src/adapters/` + лінивий геттер і запис у `ContainerOverrides` у
`container.ts` + мок у `adapters/mocks.ts` — усі чотири кроки, інакше шов не працює.
Поки що як мінімум приберіть `storage_key` з `AttachmentInput`.

### 8. Нова таблиця, схоже, не додана в обʼєкт `schema`

`schema.excerpt.ts:35-54` оголошує `annotationAttachments`, і барель
`server/src/db/schema.ts:18` (`export * from './schema/reviews'`) її підхопить. Але
типізація клієнта йде не через барель, а через явний обʼєкт-константу:
`server/src/db/client.ts:5,19` — `PostgresJsDatabase<typeof schema>`, де `schema`
перелічений вручну в `server/src/db/schema.ts:49-93`.

У вирізці гілки цього запису нема. Наслідок: `db.insert(t.annotationAttachments)`
працюватиме, а `db.query.annotationAttachments` — ні, і relational-запити по новій
таблиці будуть недоступні. Додайте `annotationAttachments` в імпорт із
`./schema/reviews` і в обʼєкт `schema`.

### 9. Розбіжність вирізки схеми з реальним деревом імпортів

`schema.excerpt.ts:6-9`.

```ts
import { workspaces } from './workspaces.js';
import { pullRequests } from './pull-requests.js';
import { users } from './users.js';
import { now } from './_shared.js';
```

Жодного з перших трьох файлів у `server/src/db/schema/` не існує: `workspaces` і
`users` живуть у `./core`, `pullRequests` — у `./pulls`
(`server/src/db/schema/reviews.ts:3-5`). До того ж реальні файли схеми імпортують
**без** розширення `.js` (`from './_shared'`, `from './core'`), а вирізка — з ним.
Якщо це справжній стан гілки — файл не компілюється; якщо це артефакт вирізки —
все одно варто звірити, бо саме цей файл визначає, що згенерує `db:generate`.

---

## Дрібне

### 10. `DELETE` повертає `{ ok: true }` замість наявної спільної схеми

`routes.ts:38`. У `server/src/modules/_shared/schemas.ts:25-27` уже є `OkResponse`
саме для «дій, чий єдиний результат — успіх/невдача». Використайте її і оголосіть
`response: { 200: OkResponse }` — коментар у тому ж файлі (рядки 14-22) пояснює,
навіщо: серіалізатор валідує те, що виходить із процесу, і сира Drizzle-строка з
`workspaceId` не протече в публічний API мовчки. Прецедент є —
`server/src/modules/brief/routes.ts:43,53`, `server/src/modules/onboarding/routes.ts:30,48`.
Роути з `Annotation` / `AttachmentRecord[]` теж варто накрити.

### 11. `getAnnotation` тягне весь рядок `reviews`

`repository.ts:53-57` — `.select()` без проєкції. Сусідній `getReview`
(`repository.ts:25-26`) робить правильно: `select({ id, prId })`. Тут же в память
приїжджають `verdict`, `summary`, `score`, `model` — усе, що модулю не потрібно, і
все, що зміниться в чужому модулі. Обмежте проєкцію трьома колонками анотації + `id`
(після виправлення блокера 1 це взагалі переїде в `ReviewRepository`).

### 12. `row!` ховає реальну гілку виконання

`repository.ts:49` (`toAnnotation(row!)`) і `repository.ts:76` (`toAttachment(inserted!)`).

У `saveAnnotation` це не теоретично: між `getReview` у сервісі (`service.ts:29`) і
`update ... returning()` є вікно, в якому ревʼю можуть видалити
(`DELETE /reviews/:id` існує — `server/src/modules/reviews/routes.ts:159`). Тоді
`UPDATE` не зачепить жодного рядка, `row` буде `undefined`, і `row!` дасть
`TypeError` → 500 замість чесного 404. Перевіряйте `if (!row) return null` / кидайте
`NotFoundError`, а не глушіть тайпчекер.

### 13. Індекси

- `0043_review_annotations.sql:22-23` — індекс тільки по `review_id`, а обидва запити
  фільтрують по парі `(workspace_id, review_id)` (`repository.ts:83-88`). Потрібен
  композитний `(workspace_id, review_id)`.
- `0043_review_annotations.sql:25-26` — `reviews_annotated_at_idx` не використовує
  жоден запит у гілці (по `annotated_at` ніде не фільтрують і не сортують). Це індекс,
  який лише сповільнює запис. Приберіть, доки не зʼявиться запит, що його виправдовує.
- `0043_review_annotations.sql:7-9` — `ADD COLUMN` без `IF NOT EXISTS`, тоді як
  `CREATE TABLE` і `CREATE INDEX` у тому самому файлі — з ним. Непослідовно; після
  переходу на `db:generate` питання зникає само.

### 14. Дрібниці по API-шару

- `routes.ts:46-52` — перекладання `content_type`/`storage_key` у `contentType`/`storageKey`
  розкидане по хендлеру. Це мапінг, а не транспорт; він належить або в `helpers.ts`
  модуля, або в сам Zod-схему через `.transform()`, щоб роут лишався «розібрати →
  викликати → повернути».
- `service.ts:72` — метод називається `removeAnnotation`, тоді як сусіди — `get`,
  `upsert`, `attach`, `listAttachments`. Або всі з суфіксом сутності, або жоден;
  зараз читається так, ніби є ще якийсь `remove`.
- `service.ts:42-44` — `get` повертає `null`, роут віддає його як тіло з 200. Це
  задокументовано в шапці `routes.ts:11`, тож свідомо — але тоді це має бути в
  `response`-схемі як `Annotation.nullable()`, за прикладом
  `server/src/modules/brief/routes.ts:43`.
- `service.ts:72-77` — видалення анотації лишає вкладення висіти на ревʼю без нотатки.
  Або чистити їх у тій самій транзакції, або свідомо задокументувати, що вкладення
  переживають нотатку.

---

## Чого немає у вирізці гілки — звірити перед мерджем

Це не зауваження до написаного, а чек-лист: файли нижче потрібні, щоб гілка взагалі
зібралася, і в наданому наборі їх немає.

1. **`modules/annotations/helpers.ts` і `constants.ts`** — імпортуються
   (`service.ts:5-6`: `sanitizeFileName`, `isAllowedContentType`,
   `MAX_ATTACHMENTS_PER_REVIEW`, `MAX_ATTACHMENT_BYTES`), у вирізці відсутні.
   `sanitizeFileName` варто прочитати окремо — це чиста функція над недовіреним
   вводом, і вона напрошується на юніт-тест без контейнера.
2. **Запис у `server/src/modules/index.ts`** — один імпорт + один рядок у `modules`
   (файл сам це й пояснює, рядки 21-25). Без нього роутів просто не існує.
3. **Контракти в `@devdigest/shared`** — `Annotation`, `AnnotationInput`,
   `AttachmentRecord`, `AttachmentInput`. Зараз у `server/src/vendor/shared/` їх нема
   (grep по `Annotation`/`Attachment` порожній). Додавати треба в **канонічну** копію
   `server/src/vendor/shared`, а потім **дзеркалити** в `client/src/vendor/shared` —
   типи перетинають дріт, і правило «ніколи не редагувати лише одну копію» тут
   застосовне буквально.
4. **Тести.** У наборі жодного. Мінімум: юніт на `helpers.ts` (контейнер не потрібен)
   і `*.it.test.ts` на репозиторій — саме з таким суфіксом, бо юніт- та
   інтеграційна лінії CI розділяються рівно по цьому глобу. Підстановка залежностей —
   через `new Container(config, db, { ... })`, не через `vi.mock` шляху модуля.

---

## Що перевірити локально перед PR

```bash
cd server && pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs
node scripts/verify.mjs --slice backend
node scripts/verify.mjs --slice integration
```

Наперед: `depcruise` на цю гілку, найімовірніше, буде **зелений** — блокери 1 і 4 він
не бачить принципово, бо це не імпорти. Зелений прогін тут нічого не доводить.
