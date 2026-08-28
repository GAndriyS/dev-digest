# Ревʼю: `summarizer.ts` → `reviewer-core/src/summarizer.ts`

Ревʼюєний файл (поточне розташування):
`.claude/skills/onion-architecture-workspace/fixtures/core-digest/summarizer.ts`
Цільове розташування: `reviewer-core/src/summarizer.ts`

**Вердикт: не комітити в такому вигляді.** Файл у цьому місці не збереться
(`npm run typecheck` = build пакета), не пройде depcruise-гейт і порушує головне
правило `reviewer-core`. Нижче 16 зауважень: 3 блокери архітектури,
4 блокери компіляції, 3 з безпеки, решта — надійність і гігієна пакета.

Опорні джерела в репо, на які я посилаюсь:

- `reviewer-core/AGENTS.md:13-17` — «The iron rule: no database, no GitHub, no
  filesystem… New inputs arrive as resolved strings — skill *bodies*, not slugs».
- `server/.dependency-cruiser.cjs` — машинне enforcement цього правила
  (`core-has-no-io`, `core-does-not-import-server`, `no-orphans`).
- `reviewer-core/src/review/run.ts` — еталон того, як тут виглядає вхід у core.
- `server/src/modules/reviews/run-executor.ts` — еталон того, як caller резолвить
  I/O перед викликом core.

---

## Блокери — архітектура (порушення iron rule + падіння CI-гейта)

### 1. Файлові операції всередині ядра

**Де:** `summarizer.ts:1-2` (`import { readFile } from 'node:fs/promises'`,
`import { join } from 'node:path'`), використання — `summarizer.ts:32-36`.

**Чому це проблема.** `reviewer-core` — це домейн-ядро, і його єдиний
дозволений сайд-ефект — виклик інʼєктованого `LLMProvider`. Це не стилістична
преференція, а зафіксоване правило (`reviewer-core/AGENTS.md:13`) з машинною
перевіркою: правило `core-has-no-io` у `server/.dependency-cruiser.cjs` явно
забороняє ядру імпортувати `fs`, `fs/promises`, `path`, `child_process`, `os`,
`net`, `http`, `https` тощо. Тобто `depcruise` завалить білд з severity `error`,
незалежно від того, чи файл робочий.

Друга частина шкоди — тестованість. Зараз `summarizeReview()` не можна викликати
з тесту без реальної файлової системи з реальним layout-ом репозиторію. Порівняй
із `reviewer-core/test/run.test.ts:47`, де весь пайплайн ганяється через
`MockLLMProvider` і не торкається диска.

**Як правильно.** Ядро приймає вже резольвлені рядки. У `SummarizeInput` замість
`skillSlugs: string[]` має бути `skillBodies: string[]` — рівно так, як це вже
зроблено в `reviewer-core/src/review/run.ts:56`:

```ts
/** Resolved skill bodies (NOT slugs). */
skills?: string[];
```

Резолвінг переїжджає в caller. Готовий приклад — `run-executor.ts:230-234`, де
сервер тягне тіла скілів із БД через репозиторій і передає масив рядків далі.

### 2. Імпорт із `server/` у ядро

**Де:** `summarizer.ts:4`
(`import { loadConfig } from '../../server/src/platform/config.js'`),
використання — `summarizer.ts:30`.

**Чому це проблема.** Тут три окремі поламки.

По-перше, це пряме порушення правила `core-does-not-import-server`
(`server/.dependency-cruiser.cjs`): ядру дозволено знати про сервер рівно одну
річ — канонічну копію контрактів `server/src/vendor/shared`, і саме тому вона
підключається через аліас `@devdigest/shared`, а не відносним шляхом. Все інше
під `server/src/` — заборонено, severity `error`.

По-друге, це інверсія залежностей у неправильний бік: ядро споживається двома
різними хостами (студія-сервер і CI-runner). CI-runner збирається окремо і не
зобовʼязаний мати робочий `server/src/platform/`. Прив'язавши summarizer до
конфіга сервера, ти робиш ядро неперевикористовуваним у другого споживача — а
це рівно та причина, заради якої `reviewer-core` взагалі виділили в пакет
(див. хедер `reviewer-core/src/index.ts:1-12`).

По-третє, це транзитивно втягує I/O: `server/src/platform/config.ts:1-4` починає
з `import 'dotenv/config'` і `node:os` / `node:path`. Тобто навіть якби прямий
імпорт `node:path` із зауваження #1 прибрали, ядро все одно отримало б файлову
систему через задні двері. Плюс `dotenv` нема в `reviewer-core/package.json` —
пакет має власний lockfile і власний список залежностей (`openai`, `zod`), тож
це прихована незадекларована залежність.

**Як правильно.** Модель — це параметр, а не глобальний конфіг. Так само, як у
`run.ts:47`:

```ts
/** Model id understood by the injected provider (e.g. 'deepseek/deepseek-v4-flash'). */
model: string;
```

Додай `model: string` у `SummarizeInput` (або окремим аргументом поруч із `llm`)
і хай caller читає `loadConfig()` у себе.

### 3. Мережевий виклик до GitHub із ядра

**Де:** `summarizer.ts:38` (виклик) та `summarizer.ts:57-67` (`fetchCommitSubjects`,
`fetch('https://api.github.com/...')`).

**Чому це проблема.** «No GitHub» — друга третина iron rule. Формально
`depcruise` цей конкретний рядок не зловить (глобальний `fetch` — не імпорт
модуля, а `octokit` у списку заборонених пакетів обходиться голим `fetch`), і
саме тому це особливо небезпечно: правило порушене, а гейт зелений. Тут ревʼюер —
єдиний захист.

Наслідки практичні: ядро стає нетестованим без мокання глобального `fetch`,
детермінований юніт-тест перетворюється на мережевий, а CI-runner і студія
отримують два різні шляхи автентифікації до GitHub замість одного.

**Як правильно.** Так само — резольвити в caller-і й передавати рядками:

```ts
export interface SummarizeInput {
  prTitle: string;
  prBody: string;
  findings: Finding[];
  skillBodies: string[];
  /** Commit subjects, already fetched by the caller. */
  commits: string[];
  model: string;
}
```

Поля `repoFullName` і `headSha` після цього з `SummarizeInput` зникають — ядру
вони не потрібні, це чисті I/O-координати. У сервера для цього вже є порти:
`GitHubClient` (`server/src/vendor/shared/adapters.ts:143`) і `GitClient.log()`
(`adapters.ts` — секція «Git (simple-git, heavy)», повертає `GitCommit[]` з полем
`message`), обидва резолвяться через контейнер (`server/src/platform/container.ts:199`).
Якщо потрібного методу в `GitHubClient` нема — додається метод у порт, а не
`fetch` у ядро.

---

## Блокери — файл не скомпілюється

Нагадування: у `reviewer-core` `npm run typecheck` **і є** build
(`reviewer-core/package.json` — `"build": "tsc --noEmit -p tsconfig.json"`), тож
будь-яка з цих чотирьох помилок валить пакет.

### 4. Імпорт із неіснуючого модуля `./prompts.js`

**Де:** `summarizer.ts:5`.

**Чому це проблема.** У `reviewer-core/src/` немає `prompts.ts` — є `prompt.ts`
(однина). Крім того, символів `SUMMARY_SCHEMA` і `buildSummaryMessages` не існує
ніде в репозиторії (перевірено grep-ом по `server/src`, `client/src`,
`reviewer-core/src`, `mcp/src` — нуль збігів). Тобто це імпорт з файлу, який
треба ще написати.

**Як правильно.** Або додати ці два експорти у `reviewer-core/src/prompt.ts`
(поруч із `assemblePrompt` / `wrapUntrusted`) і виправити шлях на `./prompt.js`,
або занести summarizer-специфічні промпти в новий `src/summary-prompt.ts` — але
тоді цей файл має бути частиною того самого коміту. Комітити імпорт у порожнечу
не можна.

### 5. `ReviewSummary` не існує в `@devdigest/shared`

**Де:** `summarizer.ts:3` (в імпорті) та `:29`, `:40`, `:54` (у сигнатурі).

**Чому це проблема.** `Finding` і `LLMProvider` у shared справді є
(`server/src/vendor/shared/index.ts:5`, `adapters.ts:82`), а `ReviewSummary` —
ні, у репозиторії немає жодного входження цього імені. Компіляція впаде на рядку 3.

**Як правильно.** Оголосити контракт у канонічній копії
`server/src/vendor/shared/contracts/` як Zod-схему (конвенція репо — Zod-first:
одна схема валідує і серіалізує), вивести тип через `z.infer`, і — важливо —
віддзеркалити зміну в `client/src/vendor/shared`, якщо `ReviewSummary` перетинає
дріт до UI. Правило з `AGENTS.md`: «Edit the server copy, then mirror
wire-crossing changes into the client copy — never edit only one».

### 6. `result.value` — такого поля немає

**Де:** `summarizer.ts:54` (`return result.value;`).

**Чому це проблема.** `LLMProvider.completeStructured<T>()` повертає
`StructuredResult<T>` (`server/src/vendor/shared/adapters.ts:73-81`), і корисне
навантаження там лежить у полі **`data`**, а не `value`:

```ts
export interface StructuredResult<T> {
  data: T;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  raw: string;
  attempts: number;
}
```

**Як правильно.** `return result.data;`. Заодно варто не викидати
`tokensIn` / `tokensOut` / `costUsd` — у решті пайплайна вартість прогону
обліковується, і summarize-виклик має потрапляти в ту саму бухгалтерію.

### 7. `config.rootDir` і `config.defaultModel` не існують на `AppConfig`

**Де:** `summarizer.ts:34` (`config.rootDir`), `summarizer.ts:41`
(`config.defaultModel`).

**Чому це проблема.** Тип `AppConfig` у `server/src/platform/config.ts:55-98`
містить `databaseUrl`, `apiPort`, `webPort`, `cloneDir`, `secretsPath`,
`nodeEnv`, `logLevel`, `webOrigin`, `embeddingsEnabled`, `repoIntelEnabled`,
`contextRoots`, `contextFiles`, `contextFilesDropped`. Полів `rootDir` і
`defaultModel` серед них немає — обидва звернення це помилки компіляції.

Окремо зауваж: «дефолтної моделі» в цій системі концептуально не існує — модель
належить агенту (`agent.provider` / `agent.model`, див. `run-executor.ts:187`).
Тобто це не «забули поле в конфізі», а невірна ментальна модель.

**Як правильно.** Прибрати `loadConfig()` (див. #2), взяти `model` з входу.

---

## Безпека

### 8. Path traversal через `skillSlugs`

**Де:** `summarizer.ts:34` —
`join(config.rootDir, SKILLS_DIR, `${slug}.md`)`.

**Чому це проблема.** `slug` приходить ззовні (`input.skillSlugs`) і
конкатенується у шлях без жодної валідації. Слаг виду `../../../../etc/passwd`
або `../../server/src/platform/config` виводить `join()` за межі каталогу скілів,
і вміст довільного файлу з диска потрапляє прямо в промпт до зовнішньої LLM.
Це класичний path traversal з ексфільтрацією.

**Як правильно.** Основний фікс — той самий, що в #1: ядро взагалі не читає з
диска, і вразливість зникає разом із `readFile`. Якщо аналогічне читання зʼявиться
на стороні сервера — там слаг має валідуватися Zod-ом на краю
(`z.string().regex(/^[a-z0-9-]+$/)`), а результат `join()` додатково перевірятися
на префікс базового каталогу через `path.resolve` + `startsWith`.

### 9. Untrusted-вхід не обгорнутий `wrapUntrusted()`

**Де:** `summarizer.ts:44-49` — у `buildSummaryMessages` передаються сирі
`input.prBody` та `commits`.

**Чому це проблема.** І тіло PR, і повідомлення коміта пише зовнішня людина —
це рівно та поверхня, через яку заходить prompt injection. Конвенція пакета тут
однозначна (`reviewer-core/AGENTS.md:23-25`): «Injection defense is one shared
rule — `INJECTION_GUARD` in `prompt.ts`… Wrap anything external with
`wrapUntrusted()`». Еталон уже написаний — `reviewer-core/src/prompt.ts:107`:

```ts
userSections.push(`## PR description\n${wrapUntrusted('pr-description', prDescription)}`);
```

Зверни увагу, що `wrapUntrusted` (`prompt.ts:30-34`) ще й екранує спробу закрити
власний делімітер `</untrusted>` — саморобне обгортання лапками цього не дає.

Додатково: системний промпт цього виклику має включати `INJECTION_GUARD`,
як це робить `prompt.ts:86`. Зараз `summarizeReview` будує повідомлення власним
шляхом і повністю обходить спільний захист.

**Як правильно.** Обгортати `prBody` як `wrapUntrusted('pr-description', ...)`,
кожен commit subject — як `wrapUntrusted('commit', ...)`, і склеювати системний
промпт із `INJECTION_GUARD`. Тіла скілів вважаються «trusted-ish»
(`prompt.ts` — коментар до `PromptParts.skills`), тож їх можна лишити як є.

### 10. Немає обмеження довжини `prBody`

**Де:** `summarizer.ts:46`.

**Чому це проблема.** `prBody` іде в промпт цілком. Автор PR контролює його
розмір, тож мегабайтне тіло або роздуває вартість виклику, або вибиває
контекстне вікно і валить summarize. У `prompt.ts` для цього вже є константа
`MAX_PR_DESCRIPTION_CHARS = 4000` з коментарем «Cap the PR description so a huge
author body can't blow the token budget» — тут її просто не застосували.

**Як правильно.** Перевикористати ту саму константу й ту саму логіку обрізання,
а не вводити другий ліміт.

### 11. Параметри без екранування в URL + запит без автентифікації

**Де:** `summarizer.ts:58-61`.

**Чому це проблема.** `repoFullName` і `headSha` вставляються в шлях URL сирими.
Значення на кшталт `owner/repo/../../orgs/secret` змінює адресований ендпоінт
GitHub API — тобто зовнішній вхід керує тим, який ресурс запитується. Плюс
запит іде без `Authorization`: анонімний ліміт GitHub — 60 запитів на годину на
IP, а будь-який приватний репозиторій відповість `404`, і за логікою рядка 62 це
мовчки перетвориться на порожній список комітів.

**Як правильно.** Разом із зауваженням #3 цей код їде з ядра. У caller-і запит
має йти через існуючий `GitHubClient`-порт, який уже отримує токен через
контейнер (`server/src/platform/container.ts:199-205`, `OctokitGitHubClient`), а
не через голий `fetch`. Токен — із `SecretsProvider`, ніколи не з `process.env`
напряму (`server/src/platform/config.ts:6-13`).

---

## Надійність

### 12. `SKILLS_DIR = 'server/skills'` вказує в нікуди

**Де:** `summarizer.ts:7`, використання — `:34`.

**Чому це проблема.** Каталогу `server/skills` у репозиторії не існує. Скіли
зберігаються в базі — таблиця `skills` із колонкою `body`
(`server/src/db/schema/skills.ts:5`), і саме звідти їх бере робочий код
(`run-executor.ts:234`: `skillBodies = linkedSkills.map((l) => l.skill.body)`).
Тобто навіть якби I/O в ядрі був дозволений, цей код падав би `ENOENT` на
першому ж прогоні з непорожнім `skillSlugs` — і не в тесті, а в проді, бо
масив зазвичай непорожній.

Це, до речі, найкраще підтвердження зауваження #1: слаги неможливо резольвити з
ядра в принципі, бо джерело істини — БД, до якої ядру заборонено ходити. Саме
тому в `run.ts` контракт — «bodies, NOT slugs».

**Як правильно.** Прибрати константу разом із `readFile`.

### 13. Послідовне читання в циклі

**Де:** `summarizer.ts:33-36` — `await readFile(...)` всередині `for`.

**Чому це проблема.** N скілів = N послідовних round-trip-ів до диска на
кожен summarize, хоча читання незалежні. На локальному диску це дрібниця, але
патерн «await у циклі без причини» тут не має жодного виправдання — порядок
результатів зберігається і при `Promise.all`.

**Як правильно.** Зауваження зникає разом із фіксом #1. Якщо аналогічний цикл
переїде в caller — `await Promise.all(slugs.map(...))`.

### 14. `fetch` без таймауту й з непослідовною обробкою помилок

**Де:** `summarizer.ts:58-66`.

**Чому це проблема.** Дві різні поведінки на дві схожі ситуації. HTTP-помилка
(`!res.ok`) → тихо повертається `[]`. А мережева помилка, DNS-збій чи таймаут →
`fetch` кидає, виняток не ловиться, і весь `summarizeReview()` падає, хоча
commit subjects — це другорядне збагачення промпту, а не обовʼязковий вхід.
Таймауту немає взагалі (`AbortSignal.timeout` не заданий), тож завислий запит
тримає весь ран. Порівняй із `run-executor.ts:460`, де відсутність
repo-intel-контексту описана як best-effort-деградація з логом.

**Як правильно.** Після переносу в caller (#3): обгорнути в `try/catch`,
задати `AbortSignal.timeout(...)`, а неуспіх логувати як `warn` (`runLog`), а не
ковтати. Тиха деградація без сліду в логу — це те, що потім неможливо
діагностувати.

---

## Гігієна пакета

### 15. Модуль не експортується з `index.ts` → orphan

**Де:** відсутній запис у `reviewer-core/src/index.ts`.

**Чому це проблема.** `reviewer-core/src/index.ts` — єдина публічна поверхня
пакета (`assemblePrompt`, `groundFindings`, `reviewPullRequest`,
`toReviewPayload` тощо). `summarizeReview` там не зареєстрований, тож жоден
споживач його не побачить: і сервер, і runner імпортують саме
`@devdigest/reviewer-core`, а не окремі файли (`run-executor.ts:3`).
Крім того, `depcruise` має правило `no-orphans` (severity `warn`,
`server/.dependency-cruiser.cjs`) з коментарем «Unreachable module — dead code,
or a missing registration» — цей файл під нього підпаде.

**Як правильно.** Додати в `index.ts` блок у стилі сусідніх:

```ts
// Summary: finished review → the two paragraphs a human reads.
export { summarizeReview, type SummarizeInput } from './summarizer.js';
```

### 16. Немає тесту

**Де:** відсутній `reviewer-core/test/summarizer.test.ts`.

**Чому це проблема.** Це нова публічна функція ядра. Після фіксів #1-#3 вона
стає чистою (вхід — рядки, єдиний сайд-ефект — інʼєктований `llm`), тобто
тестується тривіально. Зараз же вона нетестована саме тому, що нечиста — і це
рівно та петля зворотного звʼязку, заради якої iron rule існує.

**Як правильно.** Юніт-тест за патерном `reviewer-core/test/run.test.ts:47`
(`new MockLLMProvider('openai', { structured: fixture })`) або за патерном
рекордера з `run.test.ts:109`, який перехоплює `completeStructured` і перевіряє
зібрані повідомлення. Мінімум два кейси: (а) повертається `result.data`;
(б) `prBody` і commit subjects потрапили в промпт всередині `<untrusted>`.
Ім'я файлу — без суфікса `.it.` (це не DB-тест; конвенція — root `AGENTS.md`).

---

## Підсумок: як має виглядати підпис після фіксів

```ts
import type { LLMProvider, Finding, ReviewSummary } from '@devdigest/shared';
import { SUMMARY_SCHEMA, buildSummaryMessages } from './prompt.js';

export interface SummarizeInput {
  prTitle: string;
  /** Untrusted — delimiter-wrapped and capped downstream. */
  prBody: string;
  findings: Finding[];
  /** Resolved skill bodies (NOT slugs) — the caller reads them from the DB. */
  skillBodies: string[];
  /** Commit subjects, already fetched by the caller through the GitHub port. */
  commits: string[];
  /** Model id understood by the injected provider. */
  model: string;
}

export async function summarizeReview(
  llm: LLMProvider,
  input: SummarizeInput,
): Promise<ReviewSummary> { /* … */ }
```

Після цього з файлу зникають усі чотири заборонені імпорти (`node:fs/promises`,
`node:path`, `server/src/platform/config.js`, глобальний `fetch`), і функція
складається рівно з одного виклику `llm.completeStructured(...)` — тобто робить
те, чим `reviewer-core` і має бути.

**Порядок робіт:** спочатку #4, #5 (без них нема що компілювати), далі #1-#3
(вони самі знімають #8, #12, #13, #14 і половину #11), потім #6, #7, #9, #10,
наприкінці #15 і #16. Перед комітом прогнати
`node scripts/verify.mjs --slice reviewer-core` — саме там і лежать
`typecheck` та depcruise-гейт.
