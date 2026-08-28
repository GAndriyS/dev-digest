# Ревʼю модуля `watchlist` перед вливанням у `server/src/modules/watchlist`

Джерело: `.claude/skills/onion-architecture-workspace/fixtures/watchlist-module/`
(`service.ts`, `repository.ts`, `watchlist.test.ts`).
Цільове розташування (з відносних імпортів у фікстурі): `server/src/modules/watchlist/`,
тест — `server/src/modules/watchlist/watchlist.test.ts`.

Мірило: `.claude/skills/onion-architecture/SKILL.md`, машинні правила
`server/.dependency-cruiser.cjs`, і фактичний код у `server/src`.

**Вердикт: вливати не можна.** У поточному вигляді пакет не тайпчекається
(три різні `TS2305`), тягне за собою неіснуючу таблицю БД, порушує межу
`no-cross-module-internals`, ламає тестовий шов і містить дві дірки в
tenancy-скоупінгу (видалення чужих записів).

Далі — по спаданню важкості. Рядки — за файлами фікстури.

---

## Блокери (не збереться / впаде CI)

### B1. `service.ts:4` — `ReviewRepository` імпортується з чужих нутрощів, і цього експорту там немає

```ts
import { ReviewRepository } from '../reviews/repository/review.repo.js';
```

Два окремі дефекти в одному рядку.

**a) Такого експорту не існує.** `server/src/modules/reviews/repository/review.repo.ts`
експортує *вільні функції* (`insertReview`, `insertFindings`, `reviewsForPull`,
`getReview`, `deleteReview`, …) і тип `ReviewRow`. Класу `ReviewRepository` там
немає — він оголошений у `server/src/modules/reviews/repository.ts:27`, як
композиційний фасад над трьома файлами `./repository/*`. Тобто `pnpm typecheck`
падає одразу.

Додатково: `getPull`, який сервіс викликає в `service.ts:27` і `:46`, фізично
живе не в `review.repo.ts`, а в `server/src/modules/reviews/repository/pull.repo.ts:9`.
Тобто шлях імпорту неправильний навіть за наміром.

**b) Навіть із правильним шляхом це порушення межі.** Правило
`no-cross-module-internals` (`server/.dependency-cruiser.cjs:83-98`):
публічна поверхня чужого модуля — це його `constants.ts` / `types.ts` / `index.ts`,
а `repository`/`service`/`helpers` приватні. `watchlist` → `reviews/repository/**`
під жоден `pathNot` не підпадає, тож depcruise у джобі `typecheck`
(`.github/workflows/server-unit.yml`) дасть `error`.

**Як правильно.** Спільні репозиторії живуть у композиційному корені — саме для
цього в `server/src/platform/container.ts:111-113` уже є готовий геттер:

```ts
get reviewRepo(): ReviewRepository {
  return (this._reviewRepo ??= new ReviewRepository(this.db));
}
```

Отже: викинути поле `private reviews: ReviewRepository` та його ініціалізацію в
`service.ts:19` і `:23`, і звертатися як `this.container.reviewRepo.getPull(...)`.
Це саме той випадок, який описано в `SKILL.md` («Cross-module repositories live
on the container») і в `examples.md` §5.

---

### B2. `repository.ts:18, 26, 33, 37, 42` — таблиці `watchlist` у схемі немає

Репозиторій усюди звертається до `t.watchlist`, але:

- у `server/src/db/schema.ts` (барель) `watchlist` не реекспортується і не входить
  до обʼєкта `schema`;
- у жодному файлі `server/src/db/schema/*.ts` такої `pgTable` немає;
- у `server/src/db/migrations/` слова `watchlist` немає взагалі.

Тобто `t.watchlist` — помилка типів у пʼяти місцях, і навіть після її обходу
запити падатимуть у рантаймі на `relation "watchlist" does not exist`.

**Як правильно.** Новий файл `server/src/db/schema/watchlist.ts` з `pgTable('watchlist', …)`,
рядок `export * from './schema/watchlist'` у барелі + запис у обʼєкті `schema`
(інакше типізація `Db` його не бачитиме), і **нова** міграція в
`server/src/db/migrations/` — наявні `.sql` не редагувати (`AGENTS.md`: «Do not
touch … `server/src/db/migrations/*.sql` (applied — add a new migration instead)»).
Колонки за tenancy-правилом із шапки `schema.ts`: `workspace_id` FK→`workspaces`
з `onDelete: 'cascade'`, `user_id` FK→`users`, `pr_id` FK→`pull_requests`,
`seen_sha`, `created_at`, плюс індекс по `(workspace_id, user_id)`. Міграції на
буті не застосовуються — після цього треба `cd server && pnpm db:migrate`.

Поки таблиці немає, варто одразу закласти унікальний індекс
`(workspace_id, user_id, pr_id)` — див. M2.

---

### B3. `service.ts:1` і `repository.ts:2` — контрактів `WatchlistEntry` / `WatchlistDigest` не існує

```ts
import type { WatchlistEntry, WatchlistDigest } from '@devdigest/shared';
```

У `server/src/vendor/shared/contracts/` є `brief`, `eval-ci`, `findings`,
`knowledge`, `observability`, `platform`, `productionize`, `review-api`, `trace`,
`why` — і жодної згадки `Watchlist`. Барель `server/src/vendor/shared/index.ts`
їх не реекспортує. У клієнтській копії `client/src/vendor/shared/contracts/`
теж немає. Ще один `TS2305`.

**Як правильно.** Контракти тут Zod-first — одна схема обслуговує і валідацію
запиту, і серіалізацію відповіді (`AGENTS.md`, `SKILL.md` §«Validation at the
edge»). Тобто новий `server/src/vendor/shared/contracts/watchlist.ts` у стилі
сусідів (див. `contracts/brief.ts:19-24`):

```ts
export const WatchlistEntry = z.object({ … });
export type WatchlistEntry = z.infer<typeof WatchlistEntry>;
```

плюс рядок у `vendor/shared/index.ts`. Оскільки це перетинає дріт (модуль
матиме HTTP-ручки — див. B5), зміну треба **віддзеркалити** у
`client/src/vendor/shared/` — серверна копія канонічна, але правити лише одну з
двох заборонено (`AGENTS.md`).

Іменування полів у `toDto` (`repository.ts:42-49`) — `pr_id`, `seen_sha`,
`created_at` — збігається з конвенцією репо (пор. `Finding.start_line`,
`Intent.in_scope`). Це правильно, але тільки якщо новий контракт напишуть у
тому ж snake_case; інакше DTO і схема розʼїдуться мовчки.

---

### B4. `service.ts:6-7` — `helpers.ts` і `constants.ts` у пакеті відсутні

```ts
import { rankByStaleness } from './helpers.js';
import { MAX_WATCHED_PULLS } from './constants.js';
```

У фікстурі лише три файли. Ні `rankByStaleness`, ні `MAX_WATCHED_PULLS` немає —
ще два `TS2307/TS2305`. Це не дрібниця для ревʼю: `rankByStaleness` — єдине
місце, де живе власне доменна логіка «що зрушило», і без неї не перевірити ані
M1 (позиційна відповідність), ані очікування `digest.watched === 25` у тесті
(`watchlist.test.ts:45`), бо значення кепу невідоме.

**Як правильно.** Обидва файли обовʼязкові за чеклістом `SKILL.md` §«New module
checklist» п.4: `helpers.ts` — чисті трансформації (тестуються без контейнера),
`constants.ts` — літерали, і саме `constants.ts`/`types.ts` є публічною
поверхнею модуля назовні.

---

### B5. Немає `routes.ts` і реєстрації в `src/modules/index.ts` — модуль недосяжний

Чекліст `SKILL.md` вимагає п.1 (`routes.ts` — Fastify-плагін, Zod-схеми,
делегує) і п.5 (один рядок у `server/src/modules/index.ts`; реєстрація
статична навмисно — динамічний `import()` `.ts` не портується між tsx,
бандлером і vitest).

Наслідок для CI: обидва файли модуля виявляться сиротами, тож depcruise дасть
`no-orphans` (`.dependency-cruiser.cjs:43-48`, severity `warn`) з рівно тим
формулюванням, яке тут і сталося: «dead code, or a missing registration in
modules/index.ts».

**Як правильно** — за зразком `server/src/modules/repos/routes.ts:24-45`:
`app.withTypeProvider<ZodTypeProvider>()`, `new WatchlistService(app.container)`,
`getContext(app.container, req)` для `workspaceId`/`userId`, Zod у
`schema: { body / params }` (не `Schema.parse(req.body)` в хендлері — це дасть
500 замість 422, `examples.md` §8), і `IdParams` з `modules/_shared/schemas.js`
для `DELETE /watchlist/:id`.

---

### B6. `watchlist.test.ts:2` — хелпера `test/helpers/db.js` не існує

```ts
import { makeDb, resetDb, seedWorkspace, seedPull } from '../../../test/helpers/db.js';
```

Глибина шляху правильна (`src/modules/watchlist/` → `server/test/helpers/`), але
в `server/test/helpers/` лежать лише `pg.ts` і `runs.ts`. Символів
`makeDb`, `resetDb`, `seedWorkspace`, `seedPull` немає ніде в `server/`.

**Як правильно** — реальний патерн БД-тесту в цьому репо (див.
`server/test/conventions.it.test.ts:6-19`):

```ts
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
```

`startPg()` піднімає `pgvector/pgvector:pg16` через testcontainers і **сам
проганяє міграції**; `seed()` дає `workspaceId`. Гейт `dockerAvailable()`
обовʼязковий — без нього тест не скіпнеться, а впаде там, де Docker недоступний.

---

### B7. `watchlist.test.ts` — неправильні імʼя і місце: БД-тест поїде в unit-lane

Файл називається `watchlist.test.ts`, без `.it.`, і лежить усередині
`src/modules/watchlist/`. Обидва рішення хибні.

**Імʼя.** `vitest.config.ts:14` включає `['test/**/*.test.ts', 'src/**/*.test.ts']`,
а unit-lane запускається як `pnpm exec vitest run --exclude '**/*.it.test.ts'`
(`.github/workflows/server-unit.yml:106`; те саме в `scripts/verify.mjs:117`).
Інтеграційний lane, навпаки, фільтрує `.it.test`
(`.github/workflows/server-integration.yml:65`, `scripts/verify.mjs:131`).
Отже тест, який піднімає Postgres, потрапить у lane, де ані Docker, ані БД
немає — і CI буде червоний. Це рівно те правило, що записане і в `AGENTS.md`
(«DB-backed tests must end in `.it.test.ts` — the unit and integration lanes
split on that glob»), і в `SKILL.md` §«Testing seams».

**Місце.** Усі 12 інтеграційних файлів лежать у `server/test/`
(`blast.it.test.ts`, `conventions.it.test.ts`, `reviews.it.test.ts`, …).
Усередині `src/` є рівно один тест — `src/modules/conventions/helpers.test.ts` —
і це чистий unit-тест хелперів без БД.

**Як правильно:** перейменувати й перенести у `server/test/watchlist.it.test.ts`
(і поправити відносні імпорти на `../src/...`).

---

## Високий пріоритет

### H1. `watchlist.test.ts:7-13` — `vi.mock` шляху модуля замість підміни порту (і сам мок мертвий)

```ts
vi.mock('../../adapters/github/octokit.js', () => ({ OctokitGitHubClient: class { … } }));
```

Пряме порушення `SKILL.md` §«Testing seams» та `examples.md` §9: підмінювати
треба **порт через контейнер**, а не шлях у графі імпортів:

```ts
container = new Container(loadConfig(), db, { github: new MockGitHubClient({ … }) });
```

`ContainerOverrides` (`server/src/platform/container.ts:45-62`) саме для цього й
існує; готові моки лежать у `server/src/adapters/mocks.ts`. `vi.mock` привʼязує
тест до розташування файлу — він мовчки перестане щось означати, щойно адаптер
переїде.

Окремо гірше: **цей мок взагалі ні на що не впливає**. `WatchlistService` не
торкається GitHub — ні прямо, ні через `container.github()`. Мок імітує метод
`getPull()` з полями `title`/`state`, яких сервіс не читає. Це шум, який створює
хибне враження, ніби модуль ходить у мережу, і ховає справжню поверхню
залежностей (`container.db` + `reviewRepo`).

Depcruise це не спіймає: шлях у `vi.mock` — рядковий літерал, статичного
імпорту немає, тож `no-direct-adapter-clients` мовчить. Ловити мусить людина.

---

### H2. `repository.ts:32-34` — `remove` ігнорує `workspaceId`: видалення через межу воркспейсу

```ts
async remove(workspaceId: string, entryId: string): Promise<void> {
  await this.db.delete(t.watchlist).where(eq(t.watchlist.id, entryId));
}
```

`workspaceId` прийнято в сигнатуру і не використано у `WHERE`. Тобто будь-який
`entryId` з будь-якого воркспейсу видаляється успішно — сигнатура створює
оманливе враження, що скоуп є. Порушує правило `SKILL.md` («every query scoped
by `workspaceId`») і tenancy-правило з шапки `server/src/db/schema.ts` («All
queries scope by workspace_id»).

**Як правильно** — за зразком `server/src/modules/repos/repository.ts:80-86`:

```ts
async remove(workspaceId: string, id: string): Promise<boolean> {
  const deleted = await this.db
    .delete(t.watchlist)
    .where(and(eq(t.watchlist.workspaceId, workspaceId), eq(t.watchlist.id, id)))
    .returning({ id: t.watchlist.id });
  return deleted.length > 0;
}
```

Повернення `boolean` дає сервісу підставу кинути `NotFoundError` замість тихого
no-op на неіснуючому id.

---

### H3. `service.ts:55-57` — `remove` не перевіряє власника запису

```ts
async remove(workspaceId: string, entryId: string): Promise<void> {
  await this.repo.remove(workspaceId, entryId);
}
```

Навіть після виправлення H2 лишається дірка рівнем вище: watchlist — сутність
**користувача** (`listForUser(workspaceId, userId)`), а видалення скоупиться лише
воркспейсом. Тобто будь-який учасник воркспейсу зносить чужі записи.

**Як правильно:** протягнути `userId` в аргументи сервісу й у `WHERE` репозиторію
(`and(eq(workspaceId), eq(userId), eq(id))`), і кидати `NotFoundError`, коли
репозиторій повернув `false`. Сервіс кидає доменну помилку, маршрут її не мапить
руками — це вже правильно зроблено в `service.ts:28`, тут просто пропущено.

---

### H4. `repository.ts:36-39` — `countForPull` без скоупу, лічить у памʼяті, і ніхто його не викликає

```ts
async countForPull(prId: string): Promise<number> {
  const rows = await this.db.select().from(t.watchlist).where(eq(t.watchlist.prId, prId));
  return rows.length;
}
```

Три речі:
1. **Немає `workspaceId`** — метод рахує по всіх воркспейсах одразу (та сама
   категорія проблеми, що H2).
2. Тягне всі колонки всіх рядків через дріт, щоб порахувати довжину масиву.
   Має бути агрегат у SQL (`count()`), а не `rows.length`.
3. **Мертвий код** — жоден із трьох файлів фікстури його не викликає, `routes.ts`
   не існує. Або прибрати до появи споживача, або дописати разом із ручкою, яка
   його потребує.

---

## Середній пріоритет

### M1. `service.ts:44-51` — `digest` руйнує позиційну відповідність `entries` ↔ `pulls`

```ts
const pulls = await Promise.all(entries.map((entry) => this.reviews.getPull(workspaceId, entry.prId)));
return { watched: entries.length, moved: rankByStaleness(entries, pulls.filter((p) => p != null)) };
```

`pulls` будується як index-to-index зліпок з `entries`, а тоді `.filter(...)`
зсуває індекси. Якщо `rankByStaleness` парує `entries[i]` з `pulls[i]` (а два
паралельні масиви іншого сенсу й не мають), то після першого ж видаленого PR
усі наступні пари поїдуть на одиницю: запис A порівнюватиметься з шою PR-а B.
Це тихий баг — «зрушило» покаже неправильні PR-и, а не впаде.

Перевірити напевно неможливо, бо `helpers.ts` у пакеті немає (B4) — і це саме по
собі привід не зливати.

**Як правильно** — фільтрувати парами, а не один масив із двох:

```ts
const pairs = entries
  .map((entry, i) => ({ entry, pull: pulls[i] }))
  .filter((x): x is { entry: WatchlistEntry; pull: PullRow } => x.pull != null);
```

Ще краще — щоб `rankByStaleness` приймала один масив пар; тоді розсинхрон
неможливий за конструкцією. І це чиста функція, тож тестується без контейнера
(`SKILL.md` §«Testing seams»).

---

### M2. `service.ts:30-33` — витіснення по кепу знімає рівно один запис; дублікати не перевіряються

```ts
const watched = await this.repo.listForUser(workspaceId, userId);
if (watched.length >= MAX_WATCHED_PULLS) {
  await this.repo.remove(workspaceId, watched[watched.length - 1]!.id);
}
```

1. **Один remove на один add.** Якщо в базі вже більше за кеп (кеп понизили в
   `constants.ts`, або два `add` пройшли паралельно між `listForUser` і
   `insert` — перевірка й вставка не в транзакції), кеп ніколи не відновиться.
   Має бути цикл/`delete … where id in (…)` по всьому хвосту, а перевірку +
   вставку варто загорнути в транзакцію.
2. **Дублікати.** `add` не перевіряє, чи цей `prId` вже у списку користувача.
   Той самий PR можна додати двічі, і кожен дубль зʼїдає слот кепу та ще й
   подвоїть його в `digest`. Лікується унікальним індексом
   `(workspace_id, user_id, pr_id)` у міграції з B2 + `onConflictDoUpdate`
   (оновити `seen_sha`) або явною перевіркою в сервісі.

Тест `watchlist.test.ts:36-46` це не ловить: він сідить 26 **різних** PR-ів.

---

### M3. `service.ts:32` — «найстаріший» виведено з деталі реалізації сусіднього файлу

`watched[watched.length - 1]!` правильний лише тому, що
`repository.ts:27` сортує `orderBy(desc(t.watchlist.createdAt))`. Сервіс мовчки
залежить від порядку, який ніде не задекларований у його контракті, плюс
тримається на non-null assertion. Варто винести намір у репозиторій —
`removeOldest(workspaceId, userId, keep)` або хоча б `listForUser` з явно
задокументованим порядком у JSDoc. Інакше зміна сортування (наприклад, «спочатку
ті, що зрушили») тихо почне видаляти найновіші записи.

---

### M4. `watchlist.test.ts:53` — seed-хелпер використано як update

```ts
await seedPull(db, workspaceId, { id: prId, headSha: 'bbb222' });
```

Тест «PR зрушив» оновлює наявний рядок через сідер, передаючи готовий `id`.
Навіть коли хелпер напишуть (B6), це перевірятиме поведінку сідера (upsert він
чи ні), а не сервісу. Оновлювати `head_sha` слід явним апдейтом у тілі тесту —
тоді намір «шоа змінилася» видно з коду.

---

### M5. Тест не покриває саме те, де знайдено баги

Три кейси перевіряють `add` і `digest`. Не покрито:

- `remove` — жодного тесту, тому H2 (видалення через межу воркспейсу) і H3
  (видалення чужого запису) проїхали б у main непоміченими. Потрібен кейс із
  другим воркспейсом/користувачем, який очікує, що запис **вцілів**;
- `add` для неіснуючого `prId` — гілка `NotFoundError` у `service.ts:28` не
  виконується жодного разу;
- `rankByStaleness` як чиста функція — окремим unit-тестом **без** БД і
  контейнера (тоді M1 ловиться дешево, у unit-lane).

---

## Порядок дій

1. Контракти (B3) + схема та міграція (B2) + `helpers.ts`/`constants.ts` (B4) —
   без них нічого не тайпчекається.
2. `service.ts:4` → `container.reviewRepo` (B1); прибрати поле `this.reviews`.
3. Скоупінг: `repository.ts:33` (H2), `service.ts:55` (H3), `countForPull` (H4).
4. `routes.ts` із Zod-схемами + рядок у `modules/index.ts` (B5).
5. Тест: перенести у `server/test/watchlist.it.test.ts`, переписати на
   `startPg`/`dockerAvailable`/`seed` (B6, B7), викинути `vi.mock` на користь
   `ContainerOverrides` (H1), дописати кейси з M5.
6. Дзеркалити контракт у `client/src/vendor/shared/` (B3).
7. Прогнати обидва lane:
   `node scripts/verify.mjs --slice backend` і `--slice integration`;
   міграції застосувати вручну — `cd server && pnpm db:migrate`.
