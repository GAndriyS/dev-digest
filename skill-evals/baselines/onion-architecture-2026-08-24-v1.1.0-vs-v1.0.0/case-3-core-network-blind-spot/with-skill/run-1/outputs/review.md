# Ревʼю: `reviewer-core/src/enrich.ts`

Файл, що ревʼюється: `.claude/skills/onion-architecture/evals/fixtures/core-enrich/enrich.ts`
(цільове місце — `reviewer-core/src/enrich.ts`). Нічого не редаговано.

**Вердикт: до PR не готовий.** Є одне блокуюче архітектурне порушення
(вихідна мережа в доменному ядрі) і кілька похідних від нього, плюс два дефекти
коректності, які зелений тайпчек фікстури не ловить, бо фікстура ізольована від
реальних контрактів.

Зелені депкруз і тайпчек тут нічого не гарантують — це саме та сліпа зона, про
яку прямо сказано в скілі `onion-architecture` (розділ «Blind spots», пункт 1):
`core-has-no-io` перелічує **модулі** (`node:http`, `octokit`, …), а глобальний
`fetch` не імпортується, тож жоден імпорт не зʼявляється в графі й правило
мовчить. Див. `server/.dependency-cruiser.cjs:123-135`.

---

## Блокуючі

### 1. Вихідний HTTP-виклик у доменному ядрі

`enrich.ts:4`, `enrich.ts:24`, `enrich.ts:37-57` (ключовий рядок — `enrich.ts:44`)

`lookupAdvisories()` ходить у мережу (`fetch(...)`) прямо з `reviewer-core`.

**Чому це проблема.** Залізне правило ядра: «no DB, no GitHub, no filesystem, no
HTTP server; єдиний побічний ефект — інʼєктований `LLMProvider`»
(`reviewer-core/AGENTS.md`, `reviewer-core/src/index.ts:1-12`, скіл
`onion-architecture` → «reviewer-core: the iron rule»). Правило про **побічний
ефект**, а не про імпорт. Наслідки конкретні:

- ядро перестає бути чистим і однаково запускним із двох місць (studio-сервер і
  CI-runner) — адреса `advisories.internal.acme.dev` для них різна, а
  сконфігурувати її нема де: у ядра немає конфігу;
- зникає можливість підмінити залежність через `ContainerOverrides` — див. п. 2;
- ядро отримує ще один канал вихідних даних (імена змінених пакетів PR ідуть на
  зовнішній хост), тобто exfil-path у сенсі lethal-trifecta, який сам же
  ревʼювер має ловити в чужому коді.

Єдиний `fetch` у ядрі сьогодні — `reviewer-core/src/llm/openrouter.ts:124`, і це
рівно та карбована виїмка: сама реалізація `LLMProvider`. Прецедентом для
довільних HTTP-викликів вона не є.

**Як правильно.** I/O переїжджає до caller-а, а в ядро дані приходять уже
резолвленими — так само, як skill *bodies* замість slugs і spec *chunks* замість
шляхів:

```ts
export interface EnrichInput {
  findings: Finding[];
  /** Уже резолвлені advisories: package name → advisory ids. */
  advisories: Record<string, string[]>;
  model: string;
}
```

`changedPackages` при цьому з ядра зникає — воно більше не має підстав знати про
маніфест. Сам лукап оформлюється як порт+адаптер, і це всі чотири кроки, інакше
шов зламаний (скіл → «Ports and adapters»):

1. інтерфейс `AdvisoryClient` у `server/src/vendor/shared/adapters.ts`
   (канонічна копія);
2. адаптер у `server/src/adapters/advisories/…` — саме там живуть URL, таймаут,
   ретраї й ключ через `SecretsProvider`;
3. лінивий геттер + запис у `ContainerOverrides` у
   `server/src/platform/container.ts` (async, якщо потрібен секрет);
4. мок у `server/src/adapters/mocks.ts`.

Якщо тип `EnrichedFinding` перетинає wire — віддзеркалити контракт у
`client/src/vendor/shared`.

### 2. Тестовий шов зламано

`enrich.ts:20-35`

`enrichFindings` неможливо покрити unit-тестом: `LLMProvider` інʼєктується (це
добре), але advisory-клієнт функція конструює сама всередині. Єдиний спосіб
тестувати — стабити глобальний `fetch`, тобто прив'язувати тест до реалізації, а
не до порту. Скіл прямо про це: «A service that constructs its own adapter
cannot be unit-tested», і підміна робиться через `ContainerOverrides`, а не через
`vi.mock` / глобали. Після фікса п.1 функція стає чистою відносно мережі й
тестується голими даними.

### 3. Недовірений зовнішній контент іде в промпт без `wrapUntrusted()`

`enrich.ts:30` (у звʼязці з `enrich.ts:50`)

`advisories` — це тіло відповіді стороннього сервісу, яке одразу передається в
`buildEnrichMessages(...)` і потрапляє в повідомлення до моделі.

**Чому це проблема.** Конвенція ядра: «Wrap anything external with
`wrapUntrusted()`» (`reviewer-core/AGENTS.md`), захист — один спільний
`INJECTION_GUARD` у `reviewer-core/src/prompt.ts:16-33`, який працює лише для
контенту, загорнутого в `<untrusted>…</untrusted>`. Незагорнутий рядок з чужого
API — це інструкції в промпті ревʼювера безпеки, тобто саме той клас атаки, який
ядро має тримати закритим за замовчуванням.

**Як правильно.** У `buildEnrichMessages` кожен advisory-фрагмент подавати як
`wrapUntrusted('advisory-<pkg>', text)`, а не конкатенувати сирим; жодного
keyword-скану натомість не додавати (це теж прописано в конвенціях).

### 4. Інфраструктурна конфігурація зашита в ядро

`enrich.ts:4-5`

`ADVISORY_API` і `ADVISORY_TIMEOUT_MS` — це знання зовнішнього кільця
(конкретний хост і мережева політика) у найглибшому. Навіть якби виклик робив
хтось інший, константам тут не місце: ядро не читає env, не має конфігу і не
може відрізнити dev від CI. Обидві константи їдуть в адаптер (п.1), таймаут — у
його конструктор/конфіг контейнера.

---

## Коректність (тайпчек фікстури це пропускає)

### 5. `result.value` — у порту такого поля немає

`enrich.ts:34`

`StructuredResult<T>` оголошений як `{ data, model, tokensIn, tokensOut,
costUsd, raw, attempts }` — `server/src/vendor/shared/adapters.ts:72-80`.
Правильно `result.data.findings`; реальний виклик у ядрі виглядає так:
`reviewer-core/src/review/run.ts:174-187`. Тайпчек зелений лише тому, що фікстура
лежить поза `reviewer-core` і `@devdigest/shared` там не резолвиться — у
`reviewer-core/src/enrich.ts` цей рядок не збереться.

### 6. Порівняння severity з неправильним регістром

`enrich.ts:60`

`f.severity === 'critical'` не збіжиться ніколи: контракт —
`Severity = z.enum(['CRITICAL', 'WARNING', 'SUGGESTION'])`
(`server/src/vendor/shared/contracts/findings.ts:11`). `summarizeSeverity`
завжди рапортуватиме `0 critical`. Правильно — `'CRITICAL'`, і краще звіряти з
типом `Severity`, а не з рядковим літералом.

### 7. Результат моделі повертається без валідації та без grounding

`enrich.ts:26-34`

`result.data.findings` віддається назовні як є. Два наслідки:

- **Grounding.** У цьому пакеті він обовʼязковий: findings, чиї рядки не
  перетинають реальний hunk діфа, відкидаються
  (`reviewer-core/src/grounding.ts:1-21`, `reviewer-core/AGENTS.md`). Якщо
  збагачення може міняти `file`/`start_line`/`end_line` — результат треба
  проганяти через `groundFindings`, інакше збагачення стає дірою в обхід гейта.
  Якщо ж воно гарантовано лише додає `advisoryIds` — це варто зафіксувати в
  docstring і зберігати позиційні поля вхідних findings, а не довіряти їх моделі.
- **Облік.** `tokensIn`/`tokensOut`/`costUsd`/`raw` мовчки губляться, тоді як
  `run.ts:182-186` їх акумулює й повертає caller-у. Виклик коштує грошей, який
  ніде не зʼявиться. Повертати `{ findings, tokensIn, tokensOut, costUsd }`.

### 8. Мережеві помилки ковтаються мовчки

`enrich.ts:48`, `enrich.ts:52`

Будь-який збій — таймаут, 500, невалідний JSON, підмінений хост — перетворюється
на «відомих advisories немає». Для безпекової фічі це тихий false negative:
ревʼювер побачить «0 with a published advisory» і не відрізнить «нічого не
знайдено» від «лукап взагалі не відпрацював». Плюс `res.json()` кастується до
`{ advisories?: … }` без перевірки — форма відповіді чужого сервісу нічим не
підтверджена.

**Як правильно.** Після переносу в адаптер (п.1): валідувати відповідь Zod-ом на
межі, а деградацію робити явною — або підіймати помилку до caller-а, або
повертати ознаку (`{ advisories, degraded: true }`), яку сервіс покладе у
відповідь/лог, щоб «не змогли перевірити» ніколи не читалося як «чисто».

---

## Дрібне

### 9. Параметри URL не кодуються

`enrich.ts:44`

`packages.join(',')` іде в query-рядок як є: імена на кшталт `@scope/pkg`
ламають розбір на боці сервісу, а великий PR легко впирається в ліміт довжини
URL. Потрібен `encodeURIComponent` (або POST з тілом і чанкування). Питання
знімається разом із переїздом в адаптер, але переїхати має вже виправлений код.

### 10. Імпорт вказує на неіснуючий модуль

`enrich.ts:2`

`./prompts.js` — у ядрі файл називається `prompt.ts` (однина), і ні
`ENRICH_SCHEMA`, ні `buildEnrichMessages` в ньому немає
(`reviewer-core/src/prompt.ts`). У теперішньому вигляді файл у
`reviewer-core/src/` не збереться. Або додати ці експорти в `prompt.ts`, або
завести `enrich-prompt.ts` і поправити імпорт.

### 11. `EnrichedFinding` відсутній у контрактах

`enrich.ts:1`

Типу немає ні в `server/src/vendor/shared`, ні в `client/src/vendor/shared`.
Додавати треба в канонічну серверну копію
(`server/src/vendor/shared/contracts/findings.ts`, поруч із `Finding`) — Zod-схема,
а не голий `interface`, бо саме вона має драйвити і структурований вихід моделі,
і серіалізацію відповіді. Якщо тип перетинає wire — віддзеркалити в клієнтську
копію тим самим PR (розсинхрон двох копій — відома пастка цього репо).

### 12. Публічна поверхня пакета не оновлена

`reviewer-core/src/index.ts` — новий entry point ядра там не експортований, тобто
для сервера й CI-runner-а функція фактично недосяжна через задекларований API
пакета. Додати `export { enrichFindings, summarizeSeverity, type EnrichInput }
from './enrich.js';`.

---

## Що зроблено правильно

- `LLMProvider` приходить параметром, а не конструюється всередині — це саме той
  шов, який робить ядро мок-тестованим.
- `temperature: 0` і структурований виклик через `completeStructured` замість
  ручного парсингу тексту.
- `summarizeSeverity` — чиста функція без залежностей (окрім бага з регістром).
- Таймаут через `AbortController` з `clearTimeout` у `finally` — у самому
  адаптері цей код і треба лишити.

---

## Мінімальний план до PR

1. Прибрати `lookupAdvisories` і обидві константи з ядра; `EnrichInput` приймає
   `advisories: Record<string, string[]>` замість `changedPackages`.
2. Завести порт `AdvisoryClient` + адаптер + геттер у `container.ts` +
   `ContainerOverrides` + мок — усі чотири кроки.
3. `result.value` → `result.data`; повертати токени/вартість.
4. `'critical'` → `'CRITICAL'`.
5. Загорнути advisory-текст у `wrapUntrusted()` у `buildEnrichMessages`.
6. Визначити `EnrichedFinding` Zod-схемою в канонічній копії shared (+ дзеркало
   в клієнт, якщо перетинає wire), поправити імпорт промптів, експортувати
   модуль з `reviewer-core/src/index.ts`.
7. Додати unit-тест на `enrichFindings` з мок-`LLMProvider` — після п.1 він не
   потребує ані мережі, ані контейнера.
