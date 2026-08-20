# Implementation run: l05-sdd-pr-why-risk-brief

Plan: `.claude/plans/l05-sdd-pr-why-risk-brief.md` · Spec:
`specs/SPEC-04-pr-why-risk-brief-20-08-2026.md` (approved) · Mode: multi-agent ·
Branch: `L05-SDD` · Base: `5d82522d6bd6ad2139fa11b067aa4a7fc2ddffe9`

| Stage | Result | Agent tokens | Note |
|---|---|---|---|
| 1 read plan | 5 хвиль · 3 смуги в піку | — | DAG узято з плану; смуги A і B розділені дрібніше, ніж пропонував план |
| 2 implement | 14/14 кроків | ~1 016k | 6 смуг + інтеграційний прохід; жодної повторної делегації |
| 2b targeted fixes | AC-36 закрито · телеметрія падіння закрита | 66k + 86k | Обидва знайдені виконавцями й заявлені, не приховані |
| 3 find | arch: PASS 0 знахідок · code-review: 3 · security: 0 | 137k ∥ — ∥ 90k | `/code-review medium` за бюджетом дифу (~7000 рядків) |
| 3b review loop | PASS за 1 прохід | 104k | Усі 3 знахідки виправлені; перевірено власним прогоном оркестратора |
| 4 verify | 87 MET · 0 NOT MET · 1 UNVERIFIABLE | 185k | UNVERIFIABLE — лише NFR-1 без заміру |
| 4b NFR-1 measurement | **MET** — p95 3.7 мс проти межі 300 мс | 59k | n=250 на шлях, справжній Postgres; замір на вимогу людини |
| 5 docs | `server/README.md`, `client/README.md` | 157k | Коміт `761729c` |
| 6 pr | — | — | |

## Execution brief — l05-sdd-pr-why-risk-brief

Mode: multi-agent · Spec: `specs/SPEC-04-pr-why-risk-brief-20-08-2026.md`
(approved) · Slices: contracts, backend, frontend, e2e, meta · Steps this run:
**14 of 15** (рядок 15 — `doc-writer`, це стадія 5) · DAG: **stated in plan**
(колонка **Depends on** заповнена).

| Wave | Lane | Steps | Owns (paths) | Depends on | Slice(s) | Verification |
|---|---|---|---|---|---|---|
| 1 | K | 1 | обидві копії `vendor/shared/contracts/brief.ts` + `index.ts` | — | contracts | `verify.mjs --slice backend --slice frontend` |
| 1 | A1 | 2, 3, 4 | `db/schema/reviews.ts`, нова міграція, `modules/blast/{types,service}.ts`, `platform/container.ts`, `adapters/mocks.ts`, `modules/_shared/linked-issue.ts`, `modules/reviews/intent-inputs.ts` | — | backend | `verify.mjs --slice backend` |
| 2 | A2 | 5, 6, 7 | `modules/brief/**`, `modules/index.ts`, `prompts/brief.system.md` | 1, 3, 4, 2 | backend | `verify.mjs --slice backend` |
| 2 | A3 | 12 | `db/seed.ts` | 1, 2 | backend | `verify.mjs --slice backend` |
| 2 | B1 | 9, 10 | `lib/hooks/brief.ts`, `PrBriefCard/**`, `OverviewTab/**`, `messages/en/brief.json` | 1 | frontend | `verify.mjs --slice frontend` |
| 3 | A4 | 8 | `server/test/**` | 7 | backend | `verify.mjs --slice backend`; далі `pnpm db:migrate` → `--slice integration` |
| 3 | B2 | 11 | `page.tsx`, `DiffTab/**`, `SmartDiffViewer/helpers.ts`, `diff-viewer/index.ts` | 10 | frontend | `verify.mjs --slice frontend` |
| 4 | E | 13 | `e2e/specs/12-pr-why-risk-brief.flow.json`, `e2e/README.md` | 10, 11, 12 | e2e | `./scripts/e2e.sh` |
| 5 | INT | 14 | — (перевіряє шви, не переписує) | 8, 11, 12 | backend + frontend | `verify.mjs --slice backend --slice frontend --slice integration`; `./scripts/e2e.sh` |

**Notes.**

- **Відхилення від секції Execution плану (свідоме).** План пропонував одну
  смугу A (кроки 2-8, 12) і одну смугу B (9-11). Розділено на A1/A2/A3/A4 і
  B1/B2, бо смуга з восьми кроків не вкладається в правило `/implement` «не
  більше 3 агентів у польоті, кожна смуга ~5 хвилин»: на попередньому рані всі
  три зависання сторожового таймера сталися саме на довгих смугах. DAG плану не
  порушено — розділ іде рівно по ребрах колонки **Depends on**, власність
  шляхів лишається неперетинною.
- Кроки 2, 3, 4 не залежать ні від чого (у т.ч. від контракту), тож смуга A1 іде
  в одній хвилі з K, а не після неї.
- Крок 15 (`doc-writer`) — не цей ран; він виконується як стадія 5 після
  верифікації.
- `test-writer` у ланцюг не входить (рішення `/implement`, економія токенів):
  серверні тести — це крок 8 у смузі A4, клієнтські — частина кроків 10 і 11.
- Прогалин власності не виявлено: дзеркало `client/src/vendor/shared` явно
  належить смузі K тим самим кроком, що й канонічна копія.
- Вісім Open questions плану мають дефолти; вони перенесені у handoff brief і
  виконавці приймають їх без перепитування.

## Заявлені відхилення (для стадії 3 і `plan-verifier`)

Кожне — свідоме, обґрунтоване виконавцем і **не** приховане. Рев'юери мають їх
бачити як заявлені, а не відкривати як знахідки.

1. **`MockBlast` структурний, а не `implements Blast`** (смуга A1, крок 3).
   `infrastructure-points-inward` забороняє `adapters/**` імпортувати
   `modules/**` навіть type-only; `depcruise` це підтвердив червоним на першій
   спробі. План казав «скопіювати прецедент `container.projectContext` точно», але
   той прецедент мока в `adapters/mocks.ts` не має взагалі — інструкція не
   переноситься на фасад, який мокають.
2. **Логування невдалої генерації** (смуга A2, крок 6/7). `service.generate`
   кидає `ExternalServiceError` (AC-16), тож рядок логу з повним `inputs[]`
   (поправка A4) пишеться **лише на успіху**; невдала спроба йде через штатний
   обробник помилок Fastify і статуси джерел у логах не лишає.
   **Оркестратор вважає це прогалиною проти наміру поправки A4** — саме
   постмортем невдалої генерації найбільше потребує відповіді «джерело було
   недоступне чи модель нічого не знайшла». Внесено у fix-loop стадії 3b
   **незалежно** від того, чи знайдуть це рев'юери.
3. **Заземлення endpoint'ів через регулярку по `title + explanation`** (смуга
   A2, крок 5). У `Risk` немає структурного поля endpoint (AC-42 забороняє
   змінювати контракт), тож ризик, що згадує незаземлений endpoint,
   відкидається **цілком** — вільний текст не можна відредагувати частково, як
   масив `file_refs`.
4. **Бюджет документів Project Context** — `MAX_BRIEF_CONTEXT_DOCS = 8`,
   `MAX_BRIEF_CONTEXT_CHARS = 20_000` (смуга A2). План чисел не називав; це
   власні числа виконавця.
5. **Смуга B1 торкнулась `OverviewTab.test.tsx`**, якого делегація не називала.
   Монтаж третьої картки ламає наявну перевірку «в сітці двоє дітей» — таблиця
   **Ownership** плану дає смузі `.../OverviewTab/**` цілком, тож це в межах
   плану, вужчою була моя делегація.
6. **`PrBriefCard` не приймає `headSha`** (смуга B1), на відміну від сусідніх
   карток: `stale` рахує сервер, клієнт лише показує.

## Reports

Повні звіти смуг зберігаються в транскриптах агентів; тут — те, що переживає
контекст.

**Хвиля 1** — K 1/1 (крок 1), A1 3/3 (кроки 2, 3, 4). Коміт `e95a7a6`.
**Хвиля 2** — A2 3/3 (кроки 5, 6, 7), A3 1/1 (крок 12), B1 2/2 (кроки 9, 10).
Коміт `bf66584`. Frontend-зріз зелений (416 тестів); backend — typecheck і
depcruise зелені, тестів модуля ще немає (їх пише A4).
**Хвиля 3** — у роботі: A4 (крок 8, серверні тести) ∥ B2 (крок 11, адресація
файла).

### NFR-1 — замір (стадія 4b, на вимогу людини)

`GET /pulls/:id/brief`, n=250 на шлях плюс 30 запитів прогріву, справжній
Postgres 16 у Docker через Testcontainers, Node 22, M2 Pro:

| Шлях | min | median | **p95** | p99 | max |
|---|---|---|---|---|---|
| Кешований бриф, реальний HTTP-сокет | 1.564 | 3.024 | **3.678** | 4.611 | 5.524 |
| `null` (брифу ще немає), реальний сокет | 1.607 | 3.149 | **3.608** | 4.495 | 4.793 |
| Кешований бриф, `app.inject` | 1.024 | 1.298 | **1.750** | 2.207 | 2.780 |

Усе в мілісекундах. Межа NFR-1 — 300 мс p95; запас ~80×. Понад те, замір
зафіксував лічильник `completeStructured` до і після всіх 560 GET-запитів і
показав, що він не змінився — шлях читання **доказово** не робить викликів
моделі, а не лише виглядає таким у коді.

Застереження, чесно назване виконавцем: це послідовні запити одного клієнта на
незавантаженій машині з прогрітим пулом. Це підлога, а не поведінка під
навантаженням чи на холодному старті. Тимчасовий файл заміру видалено —
таймінгові асерти флакують у CI.

### Кандидати в INSIGHTS (стадія 7)

- `adapters/**` не може імпортувати `modules/**` навіть type-only, тож мок
  крос-модульного фасаду мусить бути структурно сумісним, а не `implements`
  (смуга A1).
- `SpecFile.content` wire-nullable навіть у результаті `readDoc()`, який його
  завжди заповнює: споживач без `?? ''` падає на typecheck (смуга A2).
- Додавання нової картки в `OverviewTab` вимагає правки спільного
  `OverviewTab.test.tsx` (моки хуків + перевірка кількості дітей сітки) — зв'язок
  не видно з теки самої картки (смуга B1).
