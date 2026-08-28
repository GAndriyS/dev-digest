# Ревʼю: злиття `watchlist-module` у `server/src/modules/watchlist`

Джерело: `.claude/skills/onion-architecture-workspace/fixtures/watchlist-module/`
({`service.ts`, `repository.ts`, `watchlist.test.ts`}).
Ціль: `server/src/modules/watchlist/`.

**Короткий вердикт: у поточному вигляді модуль мерджити не можна.** Він не
скомпілюється — половина того, що він імпортує, у репозиторії просто не існує
(таблиця `watchlist`, контракти `WatchlistEntry`/`WatchlistDigest`, `helpers.ts`,
`constants.ts`, `test/helpers/db.ts`, клас `ReviewRepository` за вказаним шляхом).
Крім цього є два дефекти ізоляції орендарів (крос-workspace видалення) і одна
помилка коректності в дайджесті, які варто виправити ще до того, як код почне
збиратися.

Нижче — 20 знахідок, згрупованих за важкістю. Рядки — за файлами фікстури, якщо
не вказано інше.

---

## A. Блокери — код не збереться

### A1. Таблиці `watchlist` не існує в схемі

`repository.ts:4` (`import * as t from '../../db/schema.js'`), використання —
`repository.ts:18, 26-27, 33, 37, 42`.

`grep -rni watchlist` по `server/`, `client/`, `reviewer-core/` дає **нуль**
збігів. У `server/src/db/schema/` є 14 доменних файлів (`core`, `pulls`,
`reviews`, `ops`, …) — жодного `watchlist`. Тобто `t.watchlist` — це і TS-помилка,
і падіння в рантаймі.

Чому це проблема: `AGENTS.md` обіцяє, що «схема містить усі таблиці для всіх
уроків курсу», тож автор модуля, схоже, вважав таблицю наявною. Вона не наявна —
її треба завести.

Як правильно:
1. Додати таблицю в `server/src/db/schema/` (найближчий за змістом файл —
   `ops.ts`, де вже живуть `jobs`, `installedPlugins`, `digests`; або новий
   `watchlist.ts` + рядок `export * from './schema/watchlist'` у
   `src/db/schema.ts`).
2. Обовʼязково `workspaceId` (FK→`workspaces`, `onDelete: 'cascade'`) і
   `userId` (FK→`users`) — правило орендності з `src/db/schema.ts:3-7`.
3. `pnpm db:generate`, потім `pnpm db:migrate`. **Не** редагувати вже застосовані
   `src/db/migrations/*.sql` (остання — `0017_shallow_swordsman.sql`).
4. Одразу закласти `uniqueIndex` на `(workspace_id, user_id, pr_id)` — див. A14.

### A2. Контрактів `WatchlistEntry` / `WatchlistDigest` не існує

`service.ts:1`, `repository.ts:2` — обидва імпортують з `@devdigest/shared`.

Типів немає в `server/src/vendor/shared/contracts/*` (10 файлів, барель —
`src/vendor/shared/index.ts`).

Як правильно:
- Новий `server/src/vendor/shared/contracts/watchlist.ts`, **Zod-first**, як усе
  решта: `export const WatchlistEntry = z.object({...}); export type WatchlistEntry
  = z.infer<typeof WatchlistEntry>;`. Одна схема має обслуговувати і валідацію
  запиту, і серіалізацію відповіді (конвенція з кореневого `AGENTS.md`) — самого
  `type` для `routes.ts` не вистачить.
- Реекспорт у `src/vendor/shared/index.ts`.
- **Продзеркалити** в `client/src/vendor/shared` — контракт перетинає дріт, а
  копія клієнта вже й так дрейфує.
- `snake_case` у полях (`pr_id`, `seen_sha`, `created_at`) — тут фікстура
  вгадала правильно, порівняйте з `contracts/platform.ts:180-198` (`PrMeta`
  використовує `head_sha`, `files_count`, `opened_at`).

### A3. `ReviewRepository` імпортується звідти, де його немає

`service.ts:4`:

```ts
import { ReviewRepository } from '../reviews/repository/review.repo.js';
```

Три окремі проблеми в одному рядку:

1. **Класу там немає.** `server/src/modules/reviews/repository/review.repo.ts` —
   це модуль вільних функцій (`export async function getReview(db, …)`), його
   імпортують як namespace. Клас `ReviewRepository` живе в
   `server/src/modules/reviews/repository.ts:27` і лише композує ці функції.
2. **`getPull` взагалі не в тому файлі.** `ReviewRepository.getPull`
   (`repository.ts:31-33`) делегує в `./repository/pull.repo.js`, не в
   `review.repo.js`.
3. **Навіть з правильним шляхом це порушення межі.** Правило
   `no-cross-module-internals` (`server/.dependency-cruiser.cjs:83-97`) забороняє
   імпорт `service`/`repository`/`helpers` чужого модуля; публічна поверхня
   модуля — тільки `constants.ts`, `types.ts`, `index.ts`.

Як правильно: брати санкціонований шов із контейнера —
`container.reviewRepo` (`server/src/platform/container.ts:111-113`; коментар на
рядках 79-81 прямо пояснює, що геттер існує саме для цього). Взірець —
`server/src/modules/blast/service.ts:30-33`:

```ts
private repo: Container['reviewRepo'];
constructor(private container: Container) {
  this.repo = container.reviewRepo;
}
```

### A4. `./helpers.js` і `./constants.js` відсутні у фікстурі

`service.ts:6` (`rankByStaleness`), `service.ts:7` (`MAX_WATCHED_PULLS`).

У теці фікстури лише три файли. Тобто `rankByStaleness` — ключова функція, яка
власне і рахує «що зрушило» — не існує в природі, і її поведінку неможливо
відревʼювати. `MAX_WATCHED_PULLS` теж ніде не визначено (тест припускає, що це
25 — див. A17).

Як правильно: обидва файли треба написати. Врахуйте, що на `helpers.ts` теж діє
правило `service-stays-http-agnostic` (`.dependency-cruiser.cjs:68` — патерн
`(service|repository|helpers)\.ts$`): жодного `fastify` там. `rankByStaleness`
має лишитися чистою функцією — це єдиний шов, який дасть протестувати логіку
staleness без Postgres.

### A5. `test/helpers/db.ts` не існує

`watchlist.test.ts:2`:

```ts
import { makeDb, resetDb, seedWorkspace, seedPull } from '../../../test/helpers/db.js';
```

У `server/test/helpers/` є рівно два файли: `pg.ts` і `runs.ts`. `pg.ts`
експортує `PgFixture`, `dockerAvailable()`, `startPg()` — і все. Жодного з
чотирьох імпортованих імен у репозиторії немає.

Як правильно: переписати сетап на наявний `startPg()`, як у
`server/test/blast.it.test.ts:13-23`, і посіяти workspace/PR явно через
`src/db/seed.ts` + прямі `db.insert(t.repos/t.pullRequests)`. Якщо хочеться
хелперів — виносити їх у `test/helpers/`, а не припускати, що вони вже є.

---

## B. Порушення конвенцій модуля та тестових лейнів

### B6. Немає `routes.ts` і немає реєстрації в `modules/index.ts`

Анатомія модуля за `server/AGENTS.md` — `modules/<name>/{routes,service,repository}.ts`,
і «додати модуль = плагін у `routes.ts` + один запис у `src/modules/index.ts`».
Фікстура дає лише 2 з 3 шарів і нічого не реєструє.

Наслідки:
- модуль недосяжний → спрацює `no-orphans` (`.dependency-cruiser.cjs:43-48`,
  severity `warn`) — «недосяжний модуль: мертвий код або забута реєстрація»;
- нема zod-валідації на краю, тож немає й обіцяного 422 до входу в хендлер;
- нема `getContext(app.container, req)` — а це єдине місце, звідки
  `workspaceId`/`userId` беруться правильно (`src/modules/_shared/context.ts:14-23`).
  Зараз сервіс просто приймає їх параметрами, і ніхто не гарантує, що вони
  прийдуть з автентифікації.

Як правильно: `modules/watchlist/routes.ts` за взірцем
`server/src/modules/repos/routes.ts:25-51` (плагін за замовчуванням,
`withTypeProvider<ZodTypeProvider>()`, `schema: { params: IdParams }`,
`getContext` у кожному хендлері) + один імпорт і один запис у
`src/modules/index.ts`.

### B7. Ім'я тестового файлу відправляє його в неправильний лейн

`watchlist.test.ts` — файл ходить у справжню БД, але названий як unit-тест.

Правило (`AGENTS.md` корінь і `server/AGENTS.md`): DB-backed тест **мусить**
закінчуватися на `.it.test.ts`. Лейни розділяються саме за цим глобом:
`.github/workflows/server-unit.yml:106` — `vitest run --exclude '**/*.it.test.ts'`,
`.github/workflows/server-integration.yml:65` — `vitest run .it.test`.

Наслідок: у поточному вигляді тест потрапить у unit-лейн, де Docker немає, і
покладе CI. Плюс `vitest.config.ts:14` включає `src/**/*.test.ts`, тож він
підхопиться навіть із теки модуля.

Як правильно: `watchlist.it.test.ts`. Розташування — у `server/test/`, як 30+
інших тестів; тримати тест усередині `src/modules/` є лише один прецедент
(`src/modules/conventions/helpers.test.ts`), і той для чистого хелпера без БД.

### B8. `vi.mock` на конкретному адаптері — і мок узагалі мертвий

`watchlist.test.ts:7-13`:

```ts
vi.mock('../../adapters/github/octokit.js', () => ({ OctokitGitHubClient: class { … } }));
```

Дві проблеми:
1. **Мок нічого не мокає.** `WatchlistService` ніде не звертається до GitHub — він
   читає PR із власної БД через `reviews.getPull`. Мок вводить читача в оману:
   виглядає, ніби `headSha: 'deadbeef'` кудись впливає, а він не впливає.
2. **Це саме той анти-патерн, проти якого існує контейнер.** `server/AGENTS.md`:
   «до адаптерів — тільки через DI-контейнер, це і є те, що робить підміну
   `src/adapters/mocks.ts` робочою». Підміна класу через `vi.mock` обходить
   `ContainerOverrides` (`platform/container.ts:45-63`) і ламається щоразу, коли
   змінюється шлях до файлу адаптера.

Як правильно: видалити мок; якщо GitHub справді знадобиться — `new Container(config,
db, { github: mockGitHubClient })`.

### B9. Немає гейта `dockerAvailable()` — тест падатиме, а не скіпатиметься

`watchlist.test.ts:15-25`.

Усі DB-тести репозиторію відкриваються однаково
(`server/test/blast.it.test.ts:22-23`):

```ts
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
```

Без цього в оточенні без Docker (пісочниця, локальна машина без демона) тест не
пропуститься, а впаде.

Додатково: `const db = makeDb()` (`watchlist.test.ts:16`) — синхронний виклик на
рівні модуля. Підняття Postgres асинхронне (`startPg()` повертає проміс), тож
таку форму сетапу все одно доведеться переписати на `beforeAll`.

### B10. Сервіс конструює репозиторії сам і тримає мертве поле

`service.ts:18-24`.

`new ReviewRepository(container.db)` — вже покрито в A3. Для власного
`WatchlistRepository` конструювання в конструкторі — нормальна практика, але тоді
`private container: Container` більше ніде не використовується: це мертве поле,
яке до того ж штучно тримає сервіс привʼязаним до всього контейнера.

Як правильно: після переходу на `container.reviewRepo` залишити
`constructor(private container: Container)` (як `BlastService`) — тоді поле
живе; або, якщо контейнер справді не потрібен, приймати `Db`.

---

## C. Коректність і безпека

### C11. `remove` в репозиторії ігнорує `workspaceId` — крос-орендне видалення

`repository.ts:32-34`:

```ts
async remove(workspaceId: string, entryId: string): Promise<void> {
  await this.db.delete(t.watchlist).where(eq(t.watchlist.id, entryId));
}
```

`workspaceId` приймається і мовчки викидається. Хто знає UUID запису — видаляє
його з **будь-якого** воркспейсу. Це прямо суперечить правилу орендності,
записаному в шапці `server/src/db/schema.ts:3-7` («усі запити скоупляться по
workspace_id»), і найгірший різновид такого багу: сигнатура виглядає безпечною,
тож на ревʼю виклику ніхто нічого не помітить.

Як правильно:

```ts
const deleted = await this.db.delete(t.watchlist)
  .where(and(eq(t.watchlist.id, entryId), eq(t.watchlist.workspaceId, workspaceId)))
  .returning({ id: t.watchlist.id });
if (deleted.length === 0) throw new NotFoundError('Watchlist entry not found');
```

(`and` уже імпортовано на `repository.ts:1`.) Порожній `returning()` має давати
`NotFoundError`, а не тихий успіх — інакше DELETE неіснуючого запису відповідає
204 і приховує помилку клієнта.

### C12. `service.remove` не перевіряє власника запису

`service.ts:55-57`.

Навіть після виправлення C11 будь-який учасник воркспейсу зможе зняти watch
іншого користувача: запис належить парі (workspace, user), а фільтрується лише
по workspace. Зверніть увагу на асиметрію з `add`
(`service.ts:26`), який `userId` приймає.

Як правильно: `remove(workspaceId, userId, entryId)` і фільтр по всіх трьох
колонках у репозиторії.

### C13. `countForPull` — мертвий код без скоупу

`repository.ts:36-39`.

Три зауваження одразу: метод ніхто не викликає; він фільтрує лише по `prId`, тож
порахує чужі воркспейси; і він тягне всі рядки в памʼять заради `.length` замість
`count()`.

Як правильно: видалити. Якщо лічильник знадобиться — додати з `workspaceId` і
через `db.select({ n: count() })`.

### C14. Витіснення за лімітом: гонка, дублікати і неповне відновлення ліміту

`service.ts:30-33`:

```ts
const watched = await this.repo.listForUser(workspaceId, userId);
if (watched.length >= MAX_WATCHED_PULLS) {
  await this.repo.remove(workspaceId, watched[watched.length - 1]!.id);
}
return this.repo.insert({ … });
```

- **Не транзакційно.** Два паралельні `add` обидва прочитають `length === MAX-1`,
  жоден нічого не витіснить, обидва вставлять → ліміт перевищено. Read-modify-write
  без транзакції.
- **Ліміт не відновлюється.** Якщо список уже довший за ліміт (константу зменшили,
  або спрацювала гонка вище), знімається рівно один запис. Треба цикл або зріз
  `watched.slice(MAX_WATCHED_PULLS - 1)`.
- **Немає захисту від дубліката.** Другий `add` того самого PR створює другий
  запис, зʼїдає квоту і подвоює цей PR у дайджесті.

Як правильно: unique-індекс `(workspace_id, user_id, pr_id)` у міграції (A1) +
`onConflictDoUpdate` для оновлення `seen_sha`, а витіснення — усередині
`db.transaction(...)`.

Окремо, дрібниця, але варта коментаря: `watched[watched.length - 1]` справді дає
**найстаріший** запис, бо `listForUser` сортує `desc(createdAt)`
(`repository.ts:27`). Логіка вірна, але вона мовчки залежить від порядку
сортування в іншому файлі — варто або сортувати явно тут, або лишити коментар
про цей звʼязок.

### C15. `digest`: масиви `entries` і `pulls` розʼїжджаються після `filter`

`service.ts:45-52`:

```ts
const pulls = await Promise.all(entries.map((e) => this.reviews.getPull(workspaceId, e.prId)));
return { watched: entries.length, moved: rankByStaleness(entries, pulls.filter((p) => p != null)) };
```

`rankByStaleness` отримує два паралельні масиви й, очевидно, парує їх за
індексом. Але `.filter()` зсуває індекси: щойно один PR видалено (`getPull`
поверне `undefined`), усі наступні `entry` спаруються **не зі своїм** PR.
Результат — staleness рахується для чужого PR, і в дайджесті зʼявляються хибні
«зрушення». Тихий баг, який виявиться тільки на реальних даних.

Як правильно: парувати **до** фільтрації:

```ts
const pairs = entries
  .map((entry, i) => ({ entry, pull: pulls[i] }))
  .filter((p): p is { entry: WatchlistEntry; pull: PullRow } => p.pull != null);
```

і передавати `rankByStaleness(pairs)`.

### C16. `digest` робить N+1 запитів

`service.ts:45-47` — окремий `getPull` на кожен запис, тобто до
`MAX_WATCHED_PULLS` (≈25) запитів на один виклик дайджесту, при тому що всі PR
лежать в одній таблиці.

Як правильно: один запит із `inArray(t.pullRequests.id, entries.map(e => e.prId))`.
Це заодно природно вирішує C15 — повертайте `Map<prId, PullRow>` і шукайте по
ключу, а не по індексу.

### C17. Тест хардкодить ліміт замість `MAX_WATCHED_PULLS`

`watchlist.test.ts:38` (`i < 26`) і `:45` (`toBe(25)`).

Тест виводить константу з голови — вона в цій фікстурі навіть не визначена (A4).
Коли ліміт зміниться, тест або впаде без зрозумілої причини, або, гірше, пройде
з неправильних міркувань.

Як правильно: імпортувати `MAX_WATCHED_PULLS` і писати
`for (let i = 0; i < MAX_WATCHED_PULLS + 1; i++)` / `toBe(MAX_WATCHED_PULLS)`.
`constants.ts` — публічна поверхня модуля за `no-cross-module-internals`, тож
імпорт легальний.

### C18. Тест використовує seed-хелпер як апдейтер

`watchlist.test.ts:53`:

```ts
await seedPull(db, workspaceId, { id: prId, headSha: 'bbb222' });
```

Навіть коли хелпер зʼявиться (A5), «посіяти PR із вже існуючим id» — це не
сівба, а оновлення. У схемі є `uniqueIndex('pr_repo_number_uq')`
(`src/db/schema/pulls.ts:31`), тож наївний insert просто впаде на конфлікті.
Сценарій тесту («head sha змінилася») треба виражати явним
`db.update(t.pullRequests).set({ headSha: 'bbb222' }).where(eq(t.pullRequests.id, prId))`.

### C19. `add` мовчки викидає чужий запис

`service.ts:26-41`. Коли ліміт досягнуто, користувач додає один PR і **непомітно
для себе** втрачає інший. Сервіс не повертає жодної ознаки того, що сталося
витіснення.

Як правильно: повертати з `add` не голий `WatchlistEntry`, а щось на кшталт
`{ entry, evicted?: string }`, щоб `routes.ts` міг це показати. Не блокер, але
для фічі, чия єдина мета — «не забути про PR», тиха втрата запису неприємна.

### C20. Дайджест не має відповіді на видалений PR

`service.ts:44-52`. Записи, чий PR зник із БД, залишаються в `watched`
(лічильник рахує `entries.length`), але випадають з `moved`. Виходить
«стежу за 12, зрушило 0», де насправді трьох PR уже не існує.

Як правильно: або каскадне видалення на рівні FK (`prId` → `pull_requests.id`,
`onDelete: 'cascade'` — закладається в міграції A1, і тоді проблема зникає сама),
або явне поле «застарілих» записів у `WatchlistDigest`.

---

## Що прогнати перед мерджем

Коли блокери A1-A5 закриті:

```
node scripts/verify.mjs --slice backend      # tsc + depcruise + unit-лейн
node scripts/verify.mjs --slice integration  # *.it.test.ts, потрібен Docker
```

`--slice backend` має зловити B6 (`no-orphans`) і A3 (`no-cross-module-internals`)
автоматично — не покладайтеся на прозу, `.github/workflows/**` є істиною в
останній інстанції.

Окремо не забути: `cd server && pnpm db:migrate` (міграції не застосовуються на
буті) і дзеркалення контракту в `client/src/vendor/shared` (A2).
