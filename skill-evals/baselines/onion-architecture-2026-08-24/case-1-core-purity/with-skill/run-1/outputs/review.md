# Ревʼю: `summarizer.ts` → `reviewer-core/src/summarizer.ts`

**Файл, що ревʼюється:** `.claude/skills/onion-architecture-workspace/fixtures/core-digest/summarizer.ts`
**Цільове місце:** `reviewer-core/src/summarizer.ts`
**Вердикт: не комітити в такому вигляді.** Файл порушує «залізне правило» `reviewer-core`
(жодних БД, GitHub, файлової системи), тягне імпорт із `server/`, і навіть не скомпілюється —
щонайменше чотири звернення до типів/символів, яких у репозиторії не існує.

Порахував **13 проблем**: 3 архітектурні блокери, 4 помилки компіляції, 4 з безпеки, 2 інші.

---

## P0 — Архітектурні блокери (ламають CI: `depcruise`)

### 1. Файлові операції всередині домейн-ядра
**Файл:** `summarizer.ts`, **рядки 1–2, 7, 32–36**

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
...
const body = await readFile(join(config.rootDir, SKILLS_DIR, `${slug}.md`), 'utf8');
```

**Чому це проблема.** `reviewer-core` — це домейн-ядро цибулі. Правило
`core-has-no-io` у `server/.dependency-cruiser.cjs` (рядки з `from: '^\\.\\./reviewer-core/src'`)
прямо забороняє `node:fs`, `node:fs/promises` і `node:path` у цьому дереві. Це не стилістика:
ядро ділять між студією (сервер) і CI-раннером, і кожен із них резолвить скіли по-своєму —
студія з Postgres (`skills` таблиця, `server/src/db/schema/skills.ts:16`), раннер із диска.
Щойно ядро саме читає файли, воно перестає бути придатним для одного з двох викликачів
і його неможливо протестувати без розкладеного на диску дерева.

Це прямо описано в `reviewer-core/AGENTS.md` і в `reviewer-core/src/review/run.ts:25`:
«Skill bodies / memory / specs are RESOLVED strings here».

**Як правильно.** Ядро приймає **тіла** скілів, а не слаги. I/O — у викликача.
Патерн уже є в `server/src/modules/reviews/run-executor.ts:234`:

```ts
skillBodies = linkedSkills.map((l) => l.skill.body);
```

Тобто в `SummarizeInput` замість `skillSlugs: string[]` має бути `skillBodies: string[]`,
а `readFile`/`join`/`SKILLS_DIR` зникають із файлу повністю.

---

### 2. Ядро імпортує сервер
**Файл:** `summarizer.ts`, **рядок 4**

```ts
import { loadConfig } from '../../server/src/platform/config.js';
```

**Чому це проблема.** Правило `core-does-not-import-server` дозволяє ядру рівно один
шматок сервера — канонічні контракти `server/src/vendor/shared` (під аліасом
`@devdigest/shared`). Усе інше — заборонено. Тут же тягнеться `platform/config.ts`,
а він на першому рядку робить `import 'dotenv/config'` — тобто ядро починає читати
`.env` процесу як побічний ефект імпорту. Це вбиває детермінізм і робить
`reviewer-core` незапускабельним у раннері з іншою конфігурацією.

Додатково: залежність на глобальний конфіг — це прихований вхід. Функція, яка
на вигляд приймає `(llm, input)`, насправді приймає ще й увесь `AppConfig`.

**Як правильно.** Модель приходить параметром, як усюди в ядрі —
`ReviewInput.model` (`reviewer-core/src/review/run.ts:47`):

```ts
/** Model id understood by the injected provider. */
model: string;
```

Отже `model` іде в `SummarizeInput`, `loadConfig()` (рядок 30) видаляється, а хто саме
вирішує, яку модель узяти (`agent.model`), — вирішує сервер, як у `run-executor.ts:299`.

---

### 3. Мережевий виклик до GitHub із ядра
**Файл:** `summarizer.ts`, **рядки 38, 57–67**

```ts
const commits = await fetchCommitSubjects(input.repoFullName, input.headSha);
...
const res = await fetch(`https://api.github.com/repos/${repoFullName}/commits/${headSha}`, ...);
```

**Чому це проблема.** «Єдиний побічний ефект — інʼєктований `LLMProvider`» — це
буквальне формулювання з `reviewer-core/AGENTS.md` і з коментаря `core-has-no-io`.
Тут ядро саме ходить у мережу, само знає адресу GitHub і сам формат його API.
Наслідки: жоден юніт-тест ядра більше не працює без мережі, а підміна через
`ContainerOverrides` (те, заради чого існують порти) обходиться стороною.

**Окремо зверніть увагу:** `depcruise` це **не зловить**. Правило `core-has-no-io`
перелічує `node:http`, `node:https`, `octokit`, `@octokit` — а глобальний `fetch`
нічого не імпортує, тому в графі залежностей його не видно. Тобто CI буде зелений
на цьому конкретному рядку, а порушення — реальне. Не сприймайте зелений
`depcruise` як дозвіл.

**Як правильно.** Тема комітів — це I/O викликача. У портах уже є два готові шляхи:

- `GitClient.log(repo, path?): Promise<GitCommit[]>` — `server/src/vendor/shared/adapters.ts:225`
  (локальний клон, без мережі й без токена);
- `GitHubClient` — якщо потрібен саме віддалений API; резолвиться через
  `await container.github()`, з токеном із `SecretsProvider`.

У ядро заходить уже готове `commitSubjects: string[]`.

---

## P1 — Це не скомпілюється (`npm run typecheck` у `reviewer-core`)

### 4. Типу `ReviewSummary` в `@devdigest/shared` не існує
**Файл:** `summarizer.ts`, **рядок 3** (і як тип результату — рядки 29, 40, 54)

```ts
import type { LLMProvider, Finding, ReviewSummary } from '@devdigest/shared';
```

`LLMProvider` і `Finding` є (`server/src/vendor/shared/adapters.ts:79`,
`contracts/findings.ts:63`). `ReviewSummary` — ні. У `server/src/vendor/shared/contracts/`
є лише `RunSummary` (`trace.ts:96`) і `OnboardingIndexSummary` (`knowledge.ts:80`).

**Як правильно.** Додати Zod-схему `ReviewSummary` у канонічну копію
`server/src/vendor/shared/contracts/` і **віддзеркалити** її в
`client/src/vendor/shared`, якщо тип перетинає дріт (правило з `AGENTS.md`:
редагувати обидві копії, ніколи одну). Zod-схема тут не опційна — вона ж потрібна
як `schema` для `completeStructured` (див. п. 5).

---

### 5. Модуля `./prompts.js` у `reviewer-core/src` не існує
**Файл:** `summarizer.ts`, **рядок 5**

```ts
import { SUMMARY_SCHEMA, buildSummaryMessages } from './prompts.js';
```

У `reviewer-core/src/` є `prompt.ts` (однина), і він не експортує ні `SUMMARY_SCHEMA`,
ні `buildSummaryMessages`. Єдиний `prompts.ts` у репозиторії — `server/src/platform/prompts.ts`,
тобто по інший бік забороненої межі.

Додатково — назва `SUMMARY_SCHEMA` натякає на JSON Schema, а `StructuredRequest.schema`
(`adapters.ts:57`) типізовано як `z.ZodType<T>`. Якщо це справді JSON Schema, то це ще
й помилка типу. Конвертація Zod → JSON Schema вже живе в ядрі: `toJsonSchema`
(`reviewer-core/src/llm/structured.ts`, реекспорт у `index.ts`).

---

### 6. `config.rootDir` і `config.defaultModel` не існують
**Файл:** `summarizer.ts`, **рядки 34 і 41**

`AppConfig` (`server/src/platform/config.ts:53–95`) містить `databaseUrl`, `apiPort`,
`webPort`, `cloneDir`, `secretsPath`, `nodeEnv`, `logLevel`, `webOrigin`,
`embeddingsEnabled`, `repoIntelEnabled`, `contextRoots`, `contextFiles`,
`contextFilesDropped`. Полів `rootDir` і `defaultModel` там немає — і `defaultModel`
не випадково: модель — це властивість агента (`agent.model`), а не глобального конфігу.
Обидва рядки — помилки компіляції ще до того, як п.2 приберемо цілком.

---

### 7. Результат `completeStructured` читається з неіснуючого поля
**Файл:** `summarizer.ts`, **рядок 54**

```ts
return result.value;
```

`StructuredResult<T>` (`server/src/vendor/shared/adapters.ts:69–77`) має поле **`data`**,
а не `value` (плюс `model`, `tokensIn`, `tokensOut`, `costUsd`, `raw`, `attempts`).
Порівняйте з `reviewer-core/src/review/run.ts:186`: `partials.push(res.data);`.

**Як правильно:** `return result.data;` — і заразом підняти нагору `tokensIn`/`tokensOut`/
`costUsd`, бо інакше вартість цього LLM-виклику ніде не обліковується, хоча ядро
акуратно акумулює її в `run.ts:182–184`.

---

## P2 — Безпека

### 8. Path traversal через слаг скіла
**Файл:** `summarizer.ts`, **рядок 34**

```ts
join(config.rootDir, SKILLS_DIR, `${slug}.md`)
```

`input.skillSlugs` — це дані, які прийшли ззовні (агент/API/маніфест), а `join`
спокійно нормалізує `../`. Слаг виду `../../../../etc/passwd%00` чи просто
`../../.devdigest/secrets` дає читання довільного файлу, вміст якого потім
відправляється в LLM-провайдера — тобто ексфільтрацію назовні. Нагадаю, що
`~/.devdigest/secrets.json` — це саме те, що не має покидати машину.

**Як правильно.** Проблема зникає разом із п.1: ядро не має читати файли взагалі.
Якщо десь на стороні сервера все ж резолвиться слаг у шлях — валідувати слаг
alowlist-регексом (`/^[a-z0-9-]+$/`) і перевіряти, що `resolve()` результату
лишається під базовою директорією.

---

### 9. Інʼєкція в URL через `repoFullName` / `headSha`
**Файл:** `summarizer.ts`, **рядки 58–61**

```ts
`https://api.github.com/repos/${repoFullName}/commits/${headSha}`
```

Жодного `encodeURIComponent`, жодної валідації формату. `repoFullName` виду
`owner/repo/../../user/keys` перепризначає ендпоїнт (SSRF у межах api.github.com),
а `?` чи `#` у значенні ламають шлях. У решті кодової бази репозиторій ходить
структурованим `RepoRef { owner, name }` (`adapters.ts:96`) саме тому, що
конкатенація рядків у URL — це клас помилок, а не деталь.

**Як правильно.** Не будувати URL руками — викликати порт (`GitHubClient`), який
приймає `RepoRef`. Якщо все ж будувати: валідувати `owner/name` регексом і
`headSha` як `/^[0-9a-f]{7,40}$/`.

---

### 10. Недовірений контент обходить `INJECTION_GUARD`
**Файл:** `summarizer.ts`, **рядки 44–49**

```ts
messages: buildSummaryMessages({
  prTitle: input.prTitle,
  prBody: input.prBody,
  ...
  commits,
}),
```

`prTitle`, `prBody` і теми комітів — це текст, який пише автор PR, тобто
класичний вектор prompt injection. У цьому репозиторії захист один і спільний:
`assemblePrompt` додає `INJECTION_GUARD` до системного повідомлення, а
`wrapUntrusted()` загортає кожен зовнішній блок у `<untrusted source="…">`
(`reviewer-core/src/prompt.ts:15–37`, `95–120`). Тіло PR там ще й обрізається
до `MAX_PR_DESCRIPTION_CHARS = 4000`.

Ця функція будує повідомлення власним шляхом, повз `assemblePrompt`, — отже
жодного гарда, жодних делімітерів, жодного обрізання. `prBody` на 200 КБ ще й
рознесе токен-бюджет.

**Як правильно.** У `buildSummaryMessages` кожен зовнішній шматок пропускати через
`wrapUntrusted('pr-title' | 'pr-description' | 'commits', …)` і додавати
`INJECTION_GUARD` у системне повідомлення. І — за `AGENTS.md` ядра — **не** додавати
сканування ключових слів: захист лишається одним спільним правилом.

---

### 11. Неавтентифікований запит і тихе проковтування помилки
**Файл:** `summarizer.ts`, **рядки 58–62**

```ts
{ headers: { accept: 'application/vnd.github+json' } }
...
if (!res.ok) return [];
```

Без токена це 60 запитів на годину з IP, і приватні репозиторії — завжди 404.
Але `!res.ok → []` робить усі ці випадки нерозрізненними від «у коміта немає теми»:
403 через ліміт, 404 через приватність, 500 у GitHub — усе дає порожній масив,
підсумок мовчки деградує, і в логах нема нічого. Немає ні таймауту, ні
`AbortSignal` — зависання GitHub підвішує весь підсумок.

**Як правильно.** Токен береться через `SecretsProvider` у контейнері (тому
`container.github()` і є `async`). Помилку піднімати як `AppError`/
`ExternalServiceError`, а деградацію — логувати явно. Прецедент «ніколи не мовчати»
уже описаний у `run-executor.ts` для Project Context.

---

## P3 — Інше

### 12. Ядро знає розкладку директорій сервера
**Файл:** `summarizer.ts`, **рядок 7**

```ts
const SKILLS_DIR = 'server/skills';
```

Директорії `server/skills` у репозиторії **не існує** — скіли зберігаються в Postgres
(таблиця `skills`, колонка `body`). Тобто константа не просто порушує напрямок
залежностей (внутрішнє кільце називає зовнішнє), вона ще й описує неіснуючу
реальність: код упаде на першому ж `readFile` у рантаймі.

Плюс `for`-цикл із `await` (рядки 33–36) читає файли послідовно; навіть у правильному
місці це мав би бути `Promise.all`.

---

### 13. Файл не потрапляє в публічну поверхню пакета
**Файл:** `reviewer-core/src/index.ts` (не змінено)

`index.ts` — це задокументований бар'єл-експорт ядра (`assemblePrompt`, `groundFindings`,
`reviewPullRequest`, `toReviewPayload`…). `summarizeReview` там не зʼявляється, тобто
жоден викликач його не побачить, а `depcruise` позначить файл як `no-orphans` (severity
`warn`). Якщо функція справді публічна — додати експорт; якщо ні — вона взагалі не
потрібна в ядрі.

---

## Як має виглядати правильний розподіл

**`reviewer-core/src/summarizer.ts`** — чиста функція, нуль I/O крім інʼєктованого LLM:

```ts
import type { LLMProvider, Finding, ReviewSummary } from '@devdigest/shared';
import { ReviewSummary as ReviewSummarySchema } from '@devdigest/shared';
import { buildSummaryMessages } from './prompt.js'; // з wrapUntrusted всередині

export interface SummarizeInput {
  model: string;            // приходить від агента, не з конфігу
  prTitle: string;
  prBody: string;
  findings: Finding[];
  skillBodies: string[];    // ТІЛА, не слаги
  commitSubjects: string[]; // РЯДКИ, не (repo, sha)
}

export async function summarizeReview(
  llm: LLMProvider,
  input: SummarizeInput,
): Promise<ReviewSummary> {
  const res = await llm.completeStructured<ReviewSummary>({
    model: input.model,
    schema: ReviewSummarySchema,
    schemaName: 'review_summary',
    messages: buildSummaryMessages(input),
    temperature: 0,
  });
  return res.data;
}
```

**Сервер (`server/src/modules/reviews/…`)** робить усе I/O перед викликом: резолвить
тіла скілів (`linkedSkills.map((l) => l.skill.body)`), бере теми комітів через
`container.git.log(...)` або `await container.github()`, бере модель з `agent.model` —
і передає в ядро вже готові рядки. Рівно так, як це вже зроблено для `reviewPullRequest`
у `run-executor.ts:296–320`.

**Перевірка перед комітом:**

```bash
node scripts/verify.mjs --slice reviewer-core
cd server && pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs
```

Памʼятайте про п.3: `depcruise` пропустить глобальний `fetch`. Зелений CI тут не
означає, що межа ціла.
