# Ревʼю модуля `alerts` перед вливанням у `server/src/modules/alerts`

Перевірено файли фікстури (нічого не редаговано):

- `.claude/skills/onion-architecture/evals/fixtures/alerts-module/service.ts`
- `.claude/skills/onion-architecture/evals/fixtures/alerts-module/repository.ts`

## Спершу про «депкруз зелений»

Зелений `depcruise` тут **не є доказом**, що межі дотримані, і не є доказом, що
код взагалі збереться. Дві причини, обидві конкретні:

1. Правило `routes-through-service` (`server/.dependency-cruiser.cjs:52-59`)
   забороняє шлях `src/modules/*/routes.ts → src/db/(schema|client)`. Для
   `service.ts` такого правила **немає навмисно** — репозиторій зобовʼязаний
   імпортувати схему, і конфіг не вміє відрізнити репозиторій від сервіса в
   тій самій теці. Тому прямий Drizzle-запит із сервіса проходить мовчки.
2. Правило `no-cross-module-internals` (`server/.dependency-cruiser.cjs:83-97`)
   матчить шляхи виду `^src/modules/<x>/`. Читання **чужих таблиць** через
   спільний барель `src/db/schema.ts` для нього невидиме — це обхід межі
   стороною, яку конфіг не бачить.

Плюс `depcruise` не типізує: щонайменше одна помилка нижче (П5) — червоний
`tsc`, а не червоний depcruise.

Рекомендований прогін перед PR: `node scripts/verify.mjs --slice backend`.

---

## Блокери

### П1. Сервіс сам ходить у БД замість репозиторія

**Файл:** `service.ts`, рядки **35-56** (і як наслідок імпорт на рядку **5**:
`import * as t from '../../db/schema.js'`).

**Чому це проблема.** Чеклист модуля: `repository.ts` — «the only place that
touches its tables». Тут `evaluate()` будує `select().from().innerJoin()`
безпосередньо на `this.container.db`, минаючи `AlertsRepository`, який лежить
поруч. Наслідки не косметичні: цей запит неможливо перевикористати з джоби чи
CLI, його не видно з боку репозиторія (тобто наступний, хто читатиме
`repository.ts`, не знатиме про нього), і `AlertsService` більше не тестується
без живої БД — підміна репозиторія його не перехопить.

**Як правильно.** Прибрати SQL із сервіса. Сервіс залишає собі рішення
(«скільки днів назад», «що вважати збігом»), а вибірку рядків делегує —
див. П2, куди саме. Разом із запитом має зникнути й `import * as t` із
`service.ts`: сервіс не має знати імен таблиць.

---

### П2. Модуль читає чужі таблиці — `reviews` і `pull_requests`

**Файл:** `service.ts`, рядки **46-47** (`.from(t.reviews)`,
`.innerJoin(t.pullRequests, ...)`), поля на рядках **37-44**.

**Чому це проблема.** Ці таблиці належать модулю `reviews`, і це записано
явно в `server/src/modules/reviews/repository.ts:5-9`:

> «A2 — review data-access. The ONLY layer touching the DB for the review
> domain. Owns `reviews`, `findings`, `pr_intent` …»

`alerts` щойно завів другого власника цих таблиць. Будь-яка зміна форми даних
у `reviews` (перейменування колонки, зміна семантики `kind`, додавання
soft-delete чи фільтра за видимістю) тихо розʼїде `alerts`, бо власник модуля
`reviews` не має жодного способу дізнатися, що хтось читає його таблиці збоку.
Це той самий клас порушення, що й `import { ReviewRepository } from
'../reviews/repository.js'` — просто зроблений через `db/schema.ts`, тому
`no-cross-module-internals` його й не спіймав.

**Як правильно.** Композиційний корінь уже має для цього гетер:
`server/src/platform/container.ts:111-113` віддає `container.reviewRepo`
(`ReviewRepository`), і саме для цього він там існує — коментар на
`container.ts:81` каже «`container.agentsRepo` instead of reaching into another
module's folder». Тож:

1. Додати в `ReviewRepository` метод під потребу alerts — щось на кшталт
   `listForWorkspaceSince(workspaceId, since, limit)`, що повертає рядки
   ревʼю разом із `pr_number` / `pr_title` (join живе у власника таблиць).
2. У `AlertsService.evaluate()` викликати `this.container.reviewRepo.<метод>(...)`.
3. `AlertsRepository` при цьому залишається власником **тільки** `alert_rules`
   і `alert_runs` — як і обіцяє його докблок на `repository.ts:10`.

---

### П3. `remove()` не скоупиться по `workspaceId` — крос-тенантне видалення

**Файли:** `service.ts` рядки **72-74**, `repository.ts` рядки **43-45**.

```ts
// service.ts:72
async remove(ruleId: string): Promise<void> {
  await this.repo.remove(ruleId);
}

// repository.ts:43
async remove(ruleId: string): Promise<void> {
  await this.db.delete(t.alertRules).where(eq(t.alertRules.id, ruleId));
}
```

**Чому це проблема.** `workspaceId` не бере участі ані в сигнатурі, ані в
`where`. Достатньо знати `id` чужого правила — і воно видаляється з іншого
воркспейсу. Це прямо суперечить тенант-правилу, записаному в шапці
`server/src/db/schema.ts:4-7` («All queries scope by workspace_id»), і
контрастує з рештою цього ж файлу: `get()` (**19-27**), `listForWorkspace()`
(**29-37**) і `recordRun()` (**39-41**) скоуп мають. Тобто це не прийнята
конвенція модуля, а пропущений рядок саме в деструктивній операції — найгіршій
із можливих.

**Як правильно.**

```ts
// repository.ts
async remove(workspaceId: string, ruleId: string): Promise<boolean> {
  const deleted = await this.db
    .delete(t.alertRules)
    .where(and(eq(t.alertRules.workspaceId, workspaceId), eq(t.alertRules.id, ruleId)))
    .returning({ id: t.alertRules.id });
  return deleted.length > 0;
}
```

а в сервісі — `remove(workspaceId, ruleId)` і `throw new NotFoundError(...)`,
якщо нічого не видалилося (порівняй з `evaluate()`, `service.ts:31`, де
`NotFoundError` уже кидається правильно — з `platform/errors.ts:21`).
`workspaceId` має прийти з `getContext()` на роуті, а не з тіла запиту.

---

### П4. Вибирається неіснуюча колонка `t.reviews.findings`

**Файл:** `service.ts`, рядок **42** — `findings: t.reviews.findings`.

**Чому це проблема.** У таблиці `reviews` такої колонки немає. Її поля —
`id, workspaceId, prId, agentId, runId, kind, verdict, summary, score, model,
createdAt` (`server/src/db/schema/reviews.ts:9-26`). `findings` — це **окрема
таблиця** (`server/src/db/schema/reviews.ts:28`), звʼязана через
`review_id`. Тобто `pnpm typecheck` на цьому впаде — це не стилістика.

До того ж поле й не потрібне: у `hits` (рядки **58-66**) воно не потрапляє,
`matches()` отримує весь рядок, але результат мапиться без `findings`. Тож
або це залишок, який треба просто прибрати, або `matches()` насправді має
судити за findings — і тоді потрібен окремий join/довантаження з таблиці
`findings`, а не неіснуюча колонка. Якщо це другий випадок — це ще один
аргумент за П2: такий join зобовʼязаний жити в `ReviewRepository`.

---

### П5. Модуль неповний — у такому вигляді PR не збереться

Фікстура містить лише `service.ts` і `repository.ts`. За чеклістом нового
модуля бракує:

| Чого бракує | Де це видно | Що зробити |
|---|---|---|
| `helpers.ts` з `matches()` | імпорт `service.ts:7` | чисті трансформи модуля |
| `constants.ts` з `LOOKBACK_DAYS`, `MAX_HITS` | імпорт `service.ts:8` | літерали; це ще й публічна поверхня модуля |
| `routes.ts` | — | Fastify-плагін із Zod `params`/`body`, делегує в сервіс |
| запис у `src/modules/index.ts` | `server/src/modules/index.ts:31-46` | реєстрація статична навмисно; без неї впаде ще й `no-orphans` |
| типи `AlertRule` / `AlertHit` | імпорт `service.ts:2`, `repository.ts:2` | у `server/src/vendor/shared` їх зараз немає (grep порожній) |
| таблиці `alert_rules` / `alert_runs` | `repository.ts:15,20,40,44` | у `server/src/db/schema.ts` та `schema/**` їх немає |

Три уточнення до таблиці:

- **Контракти.** `AlertRule`/`AlertHit` треба додати у **серверну** копію
  `server/src/vendor/shared` (вона канонічна), а оскільки вони перетинають
  дріт (їх віддає роут), — віддзеркалити в `client/src/vendor/shared`. Правити
  тільки одну копію не можна.
- **Схема.** Потрібні і опис таблиць у `server/src/db/schema/`, і **нова**
  міграція. Наявні `.sql` у `src/db/migrations/` уже застосовані — їх не
  редагують. Міграції не накочуються на буті: `cd server && pnpm db:migrate`.
- **Валідація на межі.** Коли зʼявиться `routes.ts` — Zod-схеми оголошуються
  в `schema: { params, body }` самого роуту, щоб невалідний вхід віддавав 422
  ще до хендлера. Не `Schema.parse(req.body)` всередині. Одна схема обслуговує
  і валідацію запиту, і серіалізацію відповіді.

---

## Суттєве, але не блокер

### П6. `MAX_HITS` обмежує не те, що обіцяє назвою

**Файл:** `service.ts`, рядок **56** (`.limit(MAX_HITS)`) у парі з рядком **58**
(`rows.filter((row) => matches(rule, row))`).

`limit` застосовується до **кандидатів**, тобто *до* фільтра `matches`.
Правило з вузьким `path_glob` поверне майже порожній результат навіть тоді,
коли глибше в межах `LOOKBACK_DAYS` збіги є — їх просто відрізало лімітом до
перевірки. Це прямо бʼє по обіцянці з докблоку (`service.ts:14-16`): «a rule
created today can immediately show what it would have caught».

Варіанти: або перенести умову правила в SQL і лімітувати вже збіги, або
залишити як є, але перейменувати константу на щось на кшталт `SCAN_LIMIT` і
чесно сказати в докблоці, що це ліміт сканування. Мовчазна назва `MAX_HITS`
гірша за обидва.

### П7. Мапінг рядка в DTO живе в сервісі

**Файл:** `service.ts`, рядки **58-66**.

Перетворення `row → AlertHit` (snake_case, `toISOString()`) — чиста функція без
жодної залежності. За чеклістом її місце — `helpers.ts`; там її можна
протестувати без контейнера взагалі. Зразок уже є поруч: `toDto()` у
`repository.ts:48-56` робить рівно те саме для правил. Зараз два однакові за
природою перетворення лежать у двох різних шарах.

### П8. `row!` замість перевірки

**Файл:** `repository.ts`, рядок **17** — `return toDto(row!)`.

Non-null assertion на результаті `.returning()`. Для `insert` це майже завжди
істина, але assertion глушить компілятор замість того, щоб описати інваріант.
Дрібниця — на розсуд автора.

---

## Підсумок

| # | Файл:рядок | Тяжкість |
|---|---|---|
| П1 | `service.ts:35-56`, `:5` | блокер |
| П2 | `service.ts:46-47` | блокер |
| П3 | `service.ts:72-74`, `repository.ts:43-45` | блокер (крос-тенантність) |
| П4 | `service.ts:42` | блокер (не типізується) |
| П5 | модуль загалом | блокер (не збереться) |
| П6 | `service.ts:56`+`:58` | суттєве |
| П7 | `service.ts:58-66` | суттєве |
| П8 | `repository.ts:17` | дрібниця |

Головне, що варто винести з цього ревʼю: **П2 — читання чужих таблиць — це
саме той клас порушення, який `depcruise` не ловить за побудовою**. Зелений
прогін тут означає лише «жоден заборонений *шлях імпорту* не задіяний», а не
«межі власності даних дотримані». Перед PR модуль треба провести через
`ReviewRepository` на контейнері, а не через `db/schema.ts`.
