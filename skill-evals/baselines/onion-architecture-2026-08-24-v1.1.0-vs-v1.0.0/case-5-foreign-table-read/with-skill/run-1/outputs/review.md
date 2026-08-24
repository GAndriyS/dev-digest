# Ревʼю модуля `alerts` перед вливанням у `server/src/modules/alerts`

Джерело: `.claude/skills/onion-architecture/evals/fixtures/alerts-module/`
(`service.ts`, `repository.ts`). Нічого не редаговано.

**Вердикт: не вливати як є.** Є блокери двох родів — порушення межі модуля
(читання чужих таблиць у сервісі) і діра в tenancy (видалення без
`workspaceId`). Плюс код у цьому вигляді не пройде `tsc`: таблиць
`alert_rules` / `alert_runs` і контрактів `AlertRule` / `AlertHit` у репозиторії
не існує.

Про «депкруз зелений»: він і має бути зеленим. dependency-cruiser читає
**імпорти**, а інлайн-запит по чужій таблиці імпортує лише `db/schema`, який
дозволений усюди. Це прямо описаний сліпий пляск конфіга
(`.claude/skills/onion-architecture/SKILL.md:151-179`, пункт 3). Зелений
депкруз тут не є свідченням про межі.

---

## Блокери

### 1. Сервіс читає таблиці чужих модулів інлайном

**Файл:** `service.ts:35-56` (`this.container.db.select(...).from(t.reviews).innerJoin(t.pullRequests, ...)`)

`reviews` належить модулю `reviews` (`server/src/modules/reviews/repository.ts:1-14`
— «The ONLY layer touching the DB for the review domain»), `pull_requests` —
модулю `pulls`. Тут `alerts` бере обидві таблиці собі: тепер форма чужих
таблиць — ваша, і будь-яка їх зміна ламає `alerts` мовчки, у рантаймі.

Чому це не ловиться: `import { ReviewRepository } from '../reviews/repository.js'`
впав би на правилі `no-cross-module-internals`
(`server/.dependency-cruiser.cjs:83-97`). Той самий запит, написаний руками
через `container.db`, імпортує тільки `db/schema` — легально скрізь, а
звʼязаність рівно та сама. Різниця лише в тому, що збірка лишається зеленою.

**Як правильно.** Дані чужого модуля беруться з його репозиторію на контейнері.
`ReviewRepository` там уже є — `server/src/platform/container.ts:111-113`
(`container.reviewRepo`). Потрібного методу («ревʼю воркспейсу за період, з
номером і заголовком PR») у нього поки немає — саме його і треба додати в
`modules/reviews/repository.ts`, а сервіс алертів має викликати:

```ts
const rows = await this.container.reviewRepo.listForWorkspaceSince(
  workspaceId, since, MAX_HITS,
);
```

Тоді знання про схему `reviews`/`pull_requests` лишається в одному місці, а
`alerts` залежить від методу, а не від колонок.

---

### 2. Доступ до даних узагалі не має жити в сервісі

**Файл:** `service.ts:35-56`

Навіть якби таблиці були свої, запит у `service.ts` порушує чекліст модуля:
`repository.ts` — єдине місце, що торкається таблиць
(`SKILL.md:118-124`). У самому фікстурі це правило задеклароване
(`repository.ts:10`: «The only place that touches `alert_rules` and
`alert_runs`»), і тут же зламане сусіднім файлом.

У `server/src/modules/*/service.ts` немає жодного прецеденту прямих запитів:
єдина згадка `db/schema` у сервісах — коментар у `smart-diff/service.ts:27`.
Ґрандфазернутий борг (`polling`, `pulls`, `settings`, `workspace`) стосується
роутів без сервісу і новим модулям не дозволений (`SKILL.md:145-149`).

**Як правильно.** Уся SQL — у `repository.ts` (свої таблиці) або в репозиторії
власника на контейнері (чужі). Сервіс лишає собі `since`, фільтрацію правилом і
запис прогону.

---

### 3. Колонки `reviews.findings` не існує — код не компілюється

**Файл:** `service.ts:40` (`findings: t.reviews.findings`)

У `server/src/db/schema/reviews.ts:9-26` таблиця `reviews` має
`id, workspace_id, pr_id, agent_id, run_id, kind, verdict, summary, score,
model, created_at`. Знахідки лежать в окремій таблиці `findings`
(`schema/reviews.ts:28-45`) і приєднуються по `review_id`.

Це показова ціна пункту 1: модуль пише запит по схемі, якої не знає, і
помиляється вже в першому ж рядку. Через `container.reviewRepo` цей запит
неможливо було б написати неправильно.

**Як правильно.** Якщо правилу потрібні знахідки (а `matches(rule, row)`,
судячи з `severity` у правилі, їх, найпевніше, потребує) — метод у
`ReviewRepository` має повертати ревʼю разом із його `findings`
(там уже є `reviewsForPull`, що робить саме таку композицію).

---

### 4. Видалення правила не скоуплене воркспейсом

**Файли:** `repository.ts:43-45`, `service.ts:72-74`

```ts
async remove(ruleId: string): Promise<void> {
  await this.db.delete(t.alertRules).where(eq(t.alertRules.id, ruleId));
}
```

Знаючи `id`, будь-який воркспейс видаляє чуже правило. Це порушення правила
тенансі («every query scoped by `workspaceId`», `SKILL.md:120-121`;
`server/src/db/schema.ts:3-7`) і водночас IDOR. Сигнатура сервісу теж вибивається:
`create` і `evaluate` беруть `workspaceId`, `remove` — ні.

**Як правильно** — як у `server/src/modules/repos/repository.ts:80-84`:

```ts
async remove(workspaceId: string, id: string): Promise<boolean> {
  const [row] = await this.db.delete(t.alertRules)
    .where(and(eq(t.alertRules.workspaceId, workspaceId), eq(t.alertRules.id, id)))
    .returning();
  return Boolean(row);
}
```

І `AlertsService.remove(workspaceId, ruleId)`, з `NotFoundError`, коли повернуло
`false`, — щоб «не моє» і «немає» не розрізнялися для клієнта.

---

### 5. Модуль спирається на таблиці та контракти, яких у репозиторії немає

**Файли:** `repository.ts:2,15,40`, `service.ts:2`

- `t.alertRules` / `t.alertRuns` — у `server/src/db/schema/**` таких таблиць
  немає (грепом по `alert` — жодного збігу).
- `AlertRule` / `AlertHit` — немає ні в `server/src/vendor/shared` (канонічна
  копія), ні в `client/src/vendor/shared`.

Тобто «депкруз зелений» — так, а `pnpm typecheck` впаде. Перевіряти треба
`node scripts/verify.mjs --slice backend`, не лише депкруз.

**Як правильно.** Перед вливанням: нова міграція в
`server/src/db/migrations/` (наявні `.sql` не чіпати) + таблиці в
`db/schema/`; контракти Zod — у `server/src/vendor/shared` і дзеркалом у
`client/src/vendor/shared`, бо `AlertRule`/`AlertHit` перетинають дріт
(AGENTS.md: правити серверну копію, потім дзеркалити).

---

## Суттєве, але не блокуюче

### 6. Wire-форма DTO підсовується прямо в Drizzle `insert`

**Файл:** `repository.ts:6-8` та `15`

`InsertRule extends Omit<AlertRule, 'id'>` успадковує snake_case поля контракту
(`path_glob`, `created_at` — видно з `toDto`, `repository.ts:48-56`), а
`values(rule)` чекає колонок Drizzle (`pathGlob`, `createdAt`). Мапінг зроблено
лише в один бік — на читанні. Або тип входу описується в колонках таблиці
(`typeof t.alertRules.$inferInsert`), або поруч з `toDto` зʼявляється `toRow`.

### 7. `limit(MAX_HITS)` стоїть перед фільтрацією

**Файли:** `service.ts:56` і `service.ts:58`

`MAX_HITS` обмежує вибірку **до** застосування `matches`, тож константа
означає не «максимум хітів», а «максимум переглянутих ревʼю»: правило з рідким
збігом поверне майже порожньо, і при цьому старіші реальні збіги будуть мовчки
відкинуті. Фільтр за правилом (severity, path_glob) має жити у `WHERE` — тоді
`limit` знову значить те, що написано в назві.

### 8. Nullable-колонки чужої таблиці течуть у `AlertHit`

**Файл:** `service.ts:62-63`

`reviews.verdict` і `reviews.score` — nullable (`db/schema/reviews.ts:21,23`).
Хіт віддає їх назовні як є. Власний репозиторій домену нормалізував би це на
межі; тут нормалізації немає, бо межі теж немає. Ще один наслідок пункту 1.

### 9. Модуль неповний як модуль

**Файл:** `service.ts:7-8` — імпортує `./helpers.js` і `./constants.js`, яких у
фікстурі немає; немає також `routes.ts` і запису в `src/modules/index.ts`
(реєстрація статична — `SKILL.md:125-126`). Якщо це свідомо частковий вливок —
зафіксувати; якщо ні, чекліст нового модуля не закритий.

Коли зʼявиться `routes.ts`: Zod-схеми `params`/`body` оголошуються на роуті,
`Schema.parse(req.body)` у хендлері не пишеться, `workspaceId` резолвиться на
краю і передається сервісу значенням — `FastifyRequest` у сервіс не заходить
навіть як `import type` (`SKILL.md:164-170`).

### 10. `evaluate` пише в БД

**Файл:** `service.ts:68` — `recordRun` робить читальну на вигляд операцію
записувальною. Саме по собі нормально, але вішати `evaluate` на `GET` не можна;
це `POST /alerts/:id/evaluate`.

---

## Що в модулі зроблено правильно

- Сервіс бере `Container` і будує репозиторій з `container.db`
  (`service.ts:21-23`) — рівно патерн `modules/repos/service.ts`.
- Кидає `NotFoundError` з `platform/errors` (`service.ts:31`), а не мапить
  статус руками.
- Сервіс приймає розвʼязані значення (`workspaceId`, `ruleId`), не запит.
- `repository.ts` тримає мапінг рядок→DTO в одному місці (`toDto`).
- Запити по власних таблицях у `repository.ts` скоуплені воркспейсом — крім
  `remove` (пункт 4).

---

## Мінімальний список до вливання

1. Прибрати запит із `service.ts` — метод у `ReviewRepository`, виклик через
   `container.reviewRepo` (пункти 1, 2, 3, 8).
2. `remove` — скоупити воркспейсом у репозиторії та сервісі (пункт 4).
3. Додати міграцію + таблиці `alert_rules` / `alert_runs`, контракти
   `AlertRule` / `AlertHit` в обидві копії `vendor/shared` (пункт 5).
4. Розвести тип вставки й wire-DTO (пункт 6); перенести фільтр правила у `WHERE`
   (пункт 7).
5. Прогнати `node scripts/verify.mjs --slice backend` — депкруза недостатньо.
