# Plan: Smart Diff v2 — узгодження реалізованої фічі з фінальним ТЗ і дизайном

## Context

Smart Diff v1 реалізовано й закомічено (`efa06cc..1c34b64`) за планом `.claude/plans/l03-subagents-smart-diff.md`; всі лейни зелені. Після цього користувач надав **фінальне ТЗ (5 пунктів) і скріншот дизайну**, які суттєво розходяться з початковою делегацією — найбільше пункт 4: клік по знахідці має вести на **картку знахідки у вкладці Agent runs** через стандартний роутинг (не скрол до рядка, як реалізовано у v1 за текстом початкової постановки). Цей план — дельта v1 → фінальне ТЗ. Складено агентом `planner` (opus) після розвідки навігаційної механіки; три ключові рішення закриті користувачем через AskUserQuestion (позначені *human-answered*).

**Кістяк дельти:** сервер не змінюється взагалі (ендпоінт лишається детермінованим, нуль нових запитів і токенів — join знахідок клієнтський, по вже завантаженому `usePrReviews`); контракти заморожені; вся робота — клієнтська + один e2e-флоу.

При старті імплементації план зберігається у `.claude/plans/l03-subagents-smart-diff-v2.md` (committed) — `implementer` і `plan-verifier` отримують його за назвою.

**Branch:** `L03-Subagents` · **Slices:** `frontend`, `e2e`, `meta` (**не** `contracts`, **не** `backend`).

---

## Відхилення від початкових вимог (v1 → фінальне ТЗ) — на запит користувача

| # | Пункт фінального ТЗ | Що є у v1 (HEAD) | Дельта, яку закриває v2 | Кроки |
|---|---|---|---|---|
| 1 | Тогл «Smart order \| Original order», у звичайному дифі анотацій немає | Тоглу немає — Smart Diff завжди увімкнений; v1-план прямо записав тогл у **Deliberately not built** | Локальний `view` у `DiffTab`; `original` рендерить `<DiffViewer>` **без `fileMeta`** — відсутність анотацій структурна | 5 |
| 2 | Хедер за дизайном: small-caps «REVIEWER-ORDERED DIFF» + code-іконка, під ним `N files · +A −D`, тогл праворуч | **Два** plain-text `SectionLabel` («Files changed · N files», хардкод EN + «Smart Diff · grouped by role») | Один хедер-блок у `DiffTab`; другий `SectionLabel` видаляється; хардкод EN → i18n | 5, 6, 7 |
| 3 | Файл понад поріг рядків підсвічується | Поріг існує лише як евристика розгортання (`AUTO_EXPAND_MAX_LINES = 200`), візуального сигналу немає | `isLarge` з **тієї ж суми**; бурштиновий тінт хедера + чип «large · N lines» — без нового поля контракту | 2, 4 |
| 4 | **Клік по знахідці → її картка у табі «Agent runs»** (не GitHub, не початок файлу, без popup) | Клік по badge крутить цикл скролів усередині FileCard; `targetFindingId` не існує; анотацій на рядках немає | Анотації на рядках (id+severity з клієнтського join); `?finding=<id>` + `setParams`; ланцюг `page → FindingsTab → ReviewRunAccordion → FindingsPanel → FindingCard`; таргет обходить фільтри, фокусується й розгортається. **Цикл-скрол видаляється**; badge веде до першої знахідки (human-answered) | 1–3, 5, 6, 8 |
| 4а | Знахідки видно прямо на рядку: severity-анотація праворуч + кольорова смуга зліва | Рядок лише тінтується `--warn-bg` після стрибка; `finding_lines: number[]` не несе ні severity, ні id | Чипи `blocker`/`warning`/`suggestion` на рядку, severity-кольори, inset-смуга зліва | 3, 4, 6 |
| 5 | Групи Core logic / Wiring / Boilerplate, останній завжди згорнутий | **Поведінка вже правильна й покрита тестом** | Тільки візуал: «Core» → «Core logic», приглушені описи, кольорові квадрати-маркери, «N files» праворуч | 6, 7, 9 |
| — | (Скріншот) чіп «✨ summary» + «What this does:» | Не реалізовано — потребує `pseudocode_summary` = виклик моделі, суперечить «без токенів» | **Пропускаємо** (human-answered); верстка лишає місце | — |
| — | Словник severity: CRITICAL → «blocker» | Немає — vendor-лейбл «Critical» (хардкод EN) | Нові i18n-ключі `shell.diffViewer.annotation*`; vendor не чіпаємо | 3, 4 |
| — | Без токенів | Дотримано (детермінований endpoint + тест `MockLLMProvider.calls === 0`) | Посилено: v2 не додає **жодного** нового `useQuery` | 6, 8 |

---

## Context read

### Repo-level правила
- `AGENTS.md:16-19` — чотири пакети; `client/` → pnpm, `e2e/` → npm.
- `AGENTS.md:21-24` — `@devdigest/shared` двічі; **цей бранч не редагує жодну копію.**
- `AGENTS.md:43` — проза ↔ CI: виграє CI. `AGENTS.md:45-48` — PR body закінчується Insights. `AGENTS.md:53-55` — do-not-touch.
- `client/AGENTS.md:13-29` — типи з shared; API через `lib/api.ts`; п'ятифайлові `_components/<Name>/`; рядки в `messages/`; vendor/ui read-only; `pnpm arch` машинно-перевіряє розміщення.
- `e2e/AGENTS.md:14-25` — npm; детерміновані флоу; read-only seed, без модельних викликів.

### Insights, що змінюють поведінку
- `client/INSIGHTS.md:43-55` — **розширюючи props спільного компонента, експортуй тип пропа з барелю**; all-optional дубль тихо зникає під зеленим typecheck. Прямо стосується `DiffFileMeta`.
- `client/INSIGHTS.md:10-18` — kit `Severity` має `INFO`, контракт — ні; типізувати на контрактному.
- `INSIGHTS.md:31-40` — паралельні агенти: шви між ними не ловить typecheck → Barrier 1.5 обов'язковий.
- `INSIGHTS.md:93-98` — Node 18: `pnpm exec depcruise` падає з `styleText` SyntaxError; `nvm use 22`.
- `client/INSIGHTS.md:72-79` — Browser-панель не композитить кадри; UI ганяти `agent-browser` (примітка оркестратора: скріншоти в поточній сесії вже працювали — перевірити панель перш ніж падати на agent-browser).
- `e2e/INSIGHTS.md` — зупинити `next dev` + `rm -rf client/.next` перед hermetic-прогоном; `cd e2e && npm ci` окремо.

### Routing
- `client/**` → `frontend` (`frontend-ui-architecture`, `react-best-practices`, `next-best-practices`; `+react-testing-library` для тестів); `e2e/**` → лише детерміновані гейти; `.claude/**`, `*.md` → `meta`. `zod` не роутиться — жодних схем у слайсі.

### CI-лейни
- `client.yml:44-60` — typecheck → depcruise → check-ui-conventions → test. **Спрацює.**
- `e2e-web.yml` — спрацює; флоу 05 і 09 — живі гейти.
- `reviewer-core.yml`, `server-unit.yml`, `server-integration.yml` — **не мають спрацювати** (сервер і контракти недоторкані).

### Перевірений стан коду (HEAD) — імплементеру не переводити наново

| Факт | Локатор | Доля у v2 |
|---|---|---|
| `DiffFileMeta {defaultOpen?, findingLines?}` + `fileMeta` | `DiffViewer/DiffViewer.tsx:16-19,26-33` | `findingLines` → `annotations` |
| Барель: `DiffViewer`, `type DiffFileMeta`, `type DiffCommentApi` | `diff-viewer/index.ts:6-8` | + `type DiffLineAnnotation` |
| `open = defaultOpen ?? size <= AUTO_EXPAND_MAX_LINES` (200) | `FileCard.tsx:63-65`; `constants.ts:4` | лишається; той самий поріг для `isLarge` |
| Цикл-скрол (`findingCycleRef`/nonce/two-phase) | `FileCard.tsx:73-103` | **видаляється** |
| `nearestRenderedLine` + `renderedNewNos` | `FileCard.tsx:33-45,68-71` | лишається (снап анотацій) |
| Badge-лічильник у хедері | `FileCard.tsx:140-161` | клік → `onFindingClick(first)` |
| `CodeLine`: hunk short-circuit, `data-line={ln.newNo}`, три спани (gutter 44 / sign 14 / lineText flex:1 pre-wrap) | `CodeLine.tsx:30-71` | + четвертий span-анотація |
| `lineRowFor(kind, highlighted)` — завжди `--warn-bg` | `diff-viewer/styles.ts:92-103` | стає severity-aware + inset-смуга |
| `DiffTab`: SectionLabel хардкод EN + ghost-кнопка коментарів; пропси `{prId, filesCount, files, canComment}` | `DiffTab.tsx:11-19,44-64` | переробляється; + 2 обов'язкові пропи |
| `SmartDiffViewer`: другий SectionLabel, RoleGroup, too_big-банер, ungrouped-хвіст, fallback | `SmartDiffViewer.tsx:96-155` | SectionLabel зникає; fallback лишається |
| `DEFAULT_OPEN_BY_ROLE = {core:null, wiring:null, boilerplate:false}` | `SmartDiffViewer/constants.ts:8-12` | не чіпати — п.5 ТЗ виконано |
| Таби `?tab=` через `setParam` → `router.replace`; ключ вкладки Agent runs = **`findings`**; монтується лише активний таб | `page.tsx:69-77,156-192` | + `setParams` (мульти-ключ) |
| `usePrReviews(prId)` фетчиться безумовно; `allFindings` мемоїзовано | `page.tsx:43,91-94` | джерело join — нуль нових запитів |
| Таргетинг рану — локальний стан FindingsTab `{runId,n}`; `targetFindingId` не існує | `FindingsTab.tsx:76-79`; `ReviewRunAccordion.tsx:48-56` | розширюється на знахідку |
| `visibleFindings(findings, hideLow, severity)` ріже confidence<0.65 і severity | `FindingsPanel/helpers.ts:5-16` | + `keepId` bypass |
| `FindingCard` має `data-finding-id={f.id}` (ніхто не читає) і `focused` (рамка+shadow) | `FindingCard.tsx:55`; `styles.ts:5-19` | якір і фокус готові |
| `FindingRecord`: `id`, `review_id` (без `run_id`), `severity`, `file`, `start_line`, `dismissed_at` | `vendor/shared/contracts/review-api.ts:15-20` | ключ мапінгу finding→review |
| SegmentedControl у kit **немає**; є `Chip {active,onClick}` (патерн FilterBar.tsx:41) | `vendor/ui/primitives/Chip.tsx:4-48` | тогл = два Chip |
| Severity-токени: `--crit`/AlertOctagon, `--warn`/AlertTriangle, `--sugg`/Lightbulb; лейбли хардкод EN у vendor | `vendor/ui/primitives/tokens.ts:6-14` | свої i18n-лейбли |
| Кольорові `+N −N` | `PrDetailHeader.tsx:71-74` | взірець хедера |
| Флоу 05 чекає `src/config.ts`; флоу 09 чекає `"Core"` | `e2e/specs/{05,09}-*.flow.json` | 09 оновлюється на точний «Core logic» |
| Семантика `wait --text` (підрядок?) у репо не задокументована | `e2e/run.ts:43-51` | не покладатись — точні рядки |
| `src/components/**` → `@devdigest/shared` depcruise **не забороняє** | `client/.dependency-cruiser.cjs` | контрактний `Severity` у diff-viewer легальний |

---

## Decisions taken

**Human-answered:**
1. Поріг «великого файлу» = `AUTO_EXPAND_MAX_LINES` (200); візуал: бурштиновий тінт хедера + чип «large · N lines».
2. Badge-лічильник **теж навігує** на картку першої знахідки; scroll-to-line цикл прибирається.
3. Чип «✨ summary» / «What this does:» — **не робимо** (потребують модельний виклик); верстка лишає місце.
4. З делегації: контракти заморожені; нуль токенів; максимальний паралелізм із непересічною власністю файлів.

**Default-assumed** (кожне відкатне):
5. `DiffFileMeta.findingLines` **замінюється** на `annotations: DiffLineAnnotation[]` (не додається поруч) — один продюсер, один консюмер; заміна робить забутий ключ excess-property помилкою.
6. Джерело анотацій — клієнтський join по `allFindings` (контракт не несе id/severity). Наслідок вголос: **серверне `finding_lines` після v2 не рендериться нічим** (ендпоінт віддає далі — мертвий, але сумісний хвіст; прибирання = окремий бранч зі слайсом contracts).
7. Фільтр для анотацій: виключаємо лише `dismissed_at != null`; `kind === 'review'` НЕ фільтруємо — узгоджено з `allFindings`, що живить лічильник таба Agent runs.
8. Стан тоглу — локальний `useState` у `DiffTab` (не `?view=`).
9. «Original order» рендериться з `DiffTab` як `<DiffViewer>` без `fileMeta` — відсутність анотацій структурна.
10. Лейбли анотацій у `shell.diffViewer.*`; `CodeLine` мапить severity → колір + ключ сам.
11. `isLarge` рахується всередині `FileCard` з тієї ж суми, що евристика розгортання — без нового поля у шві.
12. Анотація на нерендереному рядку снапиться `nearestRenderedLine`.
13. Кілька знахідок на рядку: всі чипи, порядок CRITICAL→WARNING→SUGGESTION; смуга — найвища severity; badge веде до першої (рядок ↑, потім severity).
14. Ліва смуга — `boxShadow: inset 3px 0 0 <colour>` (не borderLeft — не зсуває layout, не б'ється з shorthand).
15. Крос-табова адреса — `?finding=<id>` (клас `?severity=`/`?trace=`), без nonce: перехід із Diff завжди перемонтовує FindingsTab. Параметр не чиститься (шарабельний діплінк), знімається у `setTab`.
16. `page.tsx` отримує `setParams(patch)` — один `router.replace` на кілька ключів (два послідовні `setParam` читають той самий знімок `search` і губляться).
17. `visibleFindings(..., keepId?)` — таргет проходить крізь `hideLow` і `severityFilter`.
18. Таргетна картка розгортається (`defaultExpanded` → «сфокусована»).
19. Лічильник finding-lines у хедері групи прибирається (дизайн показує лише «N files»); `groupFindingLineCount` видаляється.
20. Флоу 09 — точний новий текст «Core logic», не підрядковий збіг.

---

## Constraints that bind this change

| Обмеження | Відповідь для v2 |
|---|---|
| **Дріт** | **Нічого не перетинає.** `vendor/shared` недоторканий; все нове живе в клієнті з уже завантажених даних. «Потрібне поле в контракті» = стоп і ескалація. |
| **Міграції / SQL** | Немає. `server/**` не редагується взагалі; `git status --porcelain -- server/` порожній. |
| **Тест-лейни** | Лише клієнтські `*.test.tsx` поруч із компонентом. |
| **Менеджери** | `client/` pnpm; `e2e/` npm. |
| **Do-not-touch** | `vendor/ui` read-only (тогл = два `Chip`); зміна там = CRITICAL. |
| **Layering** | `DiffLineAnnotation` **обов'язково** експортується з барелю diff-viewer; `components/diff-viewer/**` не знає про SmartDiff і `src/app/**` — анотації пропсами; жодного `export *`; жодного `fetch` поза `lib/api.ts`. |
| **i18n** | `shell.diffViewer.*` — все всередині `components/diff-viewer/**`; `prReview.smartDiff.*` — DiffTab/SmartDiffViewer. Хардкод EN у DiffTab ліквідується. Одна локаль `en`. |
| **Нуль токенів** | Механічно: жодного нового `useQuery`/`api.*`. Barrier 1.5: мережевий лог вкладки Diff без нових запитів; лог API без модельного виклику. |
| **e2e** | Флоу 05 лишається зеленим (Smart — дефолт, `src/config.ts` не boilerplate, шлях рендериться в хедері). Флоу 09 оновлюється. |

---

## Steps

**Owner** = агент хвилі; власник не торкається рядків іншого власника.

| # | Change | Files / seams | Slice | Owner | Skills | Verification |
|---|--------|---------------|-------|-------|--------|--------------|
| 0 | **Заборона.** Не редагувати `**/src/vendor/shared/**`, `**/src/vendor/ui/**`, `server/**`. «Потрібно» = стоп і ескалація. | — | contracts/meta | усі | — | `git status --porcelain -- '*/src/vendor/**' server/` порожній |
| 1 | **Публічний шов diff-viewer.** У `DiffViewer.tsx`: `export interface DiffLineAnnotation { findingId: string; line: number; severity: Severity }` (контрактний `Severity` через `import type` з `@/lib/types`); `DiffFileMeta`: **прибрати** `findingLines`, **додати** `annotations?: DiffLineAnnotation[]`; проп `onFindingClick?: (findingId: string) => void`, форвард разом з `annotations` у кожен `FileCard`. **`export type { DiffLineAnnotation }` у `diff-viewer/index.ts`.** | `diff-viewer/DiffViewer/DiffViewer.tsx`, `diff-viewer/index.ts` | frontend | **A** | frontend-ui-architecture, react-best-practices, next-best-practices | typecheck · depcruise одразу після кроку |
| 2 | **`FileCard`: badge навігує, цикл-скрол геть, великий файл підсвічується.** Видалити `FileCard.tsx:73-103` (цикл/nonce/two-phase); `nearestRenderedLine`/`renderedNewNos` лишити. `annotationsByLine: Map<number, DiffLineAnnotation[]>` — кожна анотація снапиться на `nearestRenderedLine`, сортується CRITICAL→WARNING→SUGGESTION. Badge: лічильник = `annotations.length`; клік/Enter/Space → `onFindingClick(first.findingId)`; колір за найвищою severity. `isLarge = (adds??0)+(dels??0) > AUTO_EXPAND_MAX_LINES` → бурштиновий тінт хедера + чип `t("diffViewer.largeFileChip", {count})`. Форвард `annotationsByLine.get(ln.newNo)` + `onFindingClick` у `CodeLine`. | `diff-viewer/FileCard/FileCard.tsx` | frontend | **A** | frontend-ui-architecture, react-best-practices | typecheck · `pnpm test` (старий `FileCard.test.tsx` свідомо червоніє — переписує Крок 10) |
| 3 | **`CodeLine`: анотація на рядку.** Проп `annotations?: DiffLineAnnotation[]` замість `highlighted?`, + `onFindingClick?`. Hunk-рядки не міняються. Анотація — **четвертий span після `lineText`, `flexShrink:0`** (не абсолютний оверлей — `pre-wrap` переносить довгі рядки), всередині `<button type="button">` на кожну знахідку: severity-іконка + i18n-лейбл (`blocker`/`warning`/`suggestion`) + `aria-label`; клік → `onFindingClick(findingId)`. `scrollMarginTop:16` лишається на рядках з анотацією. | `diff-viewer/CodeLine/CodeLine.tsx` | frontend | **A** | frontend-ui-architecture, react-best-practices | typecheck · depcruise |
| 4 | **Стилі + i18n `shell`.** `lineRowFor(kind, severity?)`: фон із `--crit-bg`/`--warn-bg`/`--sugg-bg` + `boxShadow: "inset 3px 0 0 var(--crit|--warn|--sugg)"`. Нові: `annotationChip(severity)`, `largeChip`, `fileHeaderLarge`; `findingBadge` — функція від severity. `shell.json` → `diffViewer`: `annotationBlocker` («blocker»), `annotationWarning`, `annotationSuggestion`, `annotationAria`, `largeFileChip` («large · {count} lines»); значення `findingsJumpAria` переписати під нову дію (ключ лишити). | `diff-viewer/styles.ts`, `client/messages/en/shell.json` | frontend | **A** | frontend-ui-architecture | typecheck · check-ui-conventions |
| 5 | **`DiffTab`: один хедер за дизайном + тогл.** Пропси `+ findings: FindingRecord[]`, `+ onOpenFinding: (id) => void` — **обов'язкові** (незапаяний шов = помилка typecheck). Обидва SectionLabel → **один** хедер-блок: `Icon.Code` + small-caps `t("smartDiff.headerLabel")` («REVIEWER-ORDERED DIFF»); під ним `{filesCount} files · +Σ −Σ` (кольори за `PrDetailHeader.tsx:71-74`); справа тогл із двох `Chip` («Smart order» / «Original order») + наявна ghost-кнопка коментарів. `const [view, setView] = useState<"smart"|"original">("smart")`; `original` → `<DiffViewer files commenting>` **без fileMeta**; `smart` → `<SmartDiffViewer findings onOpenFinding>`. Хардкод EN → i18n. **(new)** `DiffTab/{constants.ts,styles.ts}`. | `_components/DiffTab/**`, `client/messages/en/prReview.json` | frontend | **B** | frontend-ui-architecture, react-best-practices, next-best-practices | typecheck · depcruise · check-ui-conventions |
| 6 | **`SmartDiffViewer`: join + візуал груп.** Пропси `+ findings`, `+ onOpenFinding`. Прибрати власний SectionLabel. **(new helper)** `buildAnnotations(files, findings): Record<string, DiffLineAnnotation[]>` — dismissed геть; матч `finding.file === path`; `line = start_line`; сортування рядок ↑, severity ↓. `buildFileMeta(groups, annotationsByPath)` кладе `annotations`; `groupFindingLineCount` видалити. Хедер групи: кольоровий квадрат (`ROLE_MARKER_COLOR = {core: var(--accent), wiring: var(--warn), boilerplate: var(--text-muted)}`), лейбл, приглушений опис, «N files» праворуч. `onFindingClick={onOpenFinding}` у **всі** `DiffViewer` (групи, ungrouped-хвіст, fallback — fallback отримує fileMeta лише з анотаціями, без defaultOpen). `DEFAULT_OPEN_BY_ROLE` не чіпати. | `_components/SmartDiffViewer/**`, `client/messages/en/prReview.json` | frontend | **B** | frontend-ui-architecture, react-best-practices, next-best-practices | typecheck · depcruise одразу після кроку · check-ui-conventions |
| 7 | **i18n `prReview.smartDiff`.** `coreLabel` → «Core logic»; додати `coreDesc` («The substance of the change — review closely»), `wiringDesc` («Hooks the core into the app»), `boilerplateDesc` («Generated / mechanical — skim»), `headerLabel`, `headerStats`, `viewSmart`, `viewOriginal`, `showComments`, `hideComments`; видалити осиротілі `findingLines`/`groupedByRole`, якщо їх ніхто не читає. **`prReview.json` — файл власника B; A його не відкриває.** | `client/messages/en/prReview.json` | frontend | **B** | frontend-ui-architecture | `pnpm test` |
| 8 | **Навігація Diff → Agent runs.** `page.tsx`: `setParams(patch: Record<string,string\|null>)` — один `router.replace` на кілька ключів; `setTab` знімає `finding`; `targetFindingId = search.get("finding")` → `FindingsTab`; `<DiffTab findings={allFindings} onOpenFinding={(id) => setParams({tab:"findings", finding:id})}>`. `FindingsTab`: `targetReviewId = runs.find(r => r.findings.some(f => f.id === target))?.id` (мапінг через `review_id`) → у `ReviewRunAccordion`. `ReviewRunAccordion`: гілка ефекту «мій review містить таргет → setOpen(true)» (без скролу — скролить панель). `FindingsPanel`: `visibleFindings(..., keepId)` пропускає таргет; `focusIdx` lazy-init індексом таргета; `defaultExpanded` → сфокусована; ефект скролить `[data-finding-id]` `block:"center"`. `FindingCard/styles.ts`: `scrollMarginTop:16` у `card()`. | `page.tsx`, `FindingsTab/**`, `ReviewRunAccordion/**`, `FindingsPanel/**`, `FindingCard/styles.ts` | frontend | **C** | frontend-ui-architecture, react-best-practices, next-best-practices | typecheck **лише на Barrier 1** (обов'язкові пропи DiffTab існують по обидва боки шва тільки разом) · depcruise |
| 9 | **e2e флоу 09.** `wait --text "Core"` → `"Core logic"` (точний рядок, не підрядок); + крок `wait --text "Original order"` (тогл відрендерився); оновити рядок покриття `e2e/README.md`. Не чіпати флоу 01–08 і seed. | `e2e/specs/09-pr-smart-diff.flow.json`, `e2e/README.md` | e2e | **E** | — | `cd e2e && npm ci`, `./scripts/e2e.sh` (зупинити `next dev`, `rm -rf client/.next`) |
| 10 | **Тести спільних компонентів.** `FileCard.test.tsx`: видалити тест циклічного jump; нові — badge кличе `onFindingClick` з id першої; клік по анотації — з її id; снап на найближчий рендерений рядок; чип «large» на 201 і відсутній на 200 (межа на константі); кольори за severity. `DiffViewer.test.tsx`: reorder-тест лишається; + «annotations доїжджають до файлу за шляхом». Провайдер з namespace `shell`. | `diff-viewer/**/*.test.tsx` | frontend | **F** (test-writer) | react-testing-library, react-best-practices | `pnpm test` |
| 11 | **Тести маршруту й навігації.** `SmartDiffViewer.test.tsx`: badge кличе `onOpenFinding` (не розкриває data-line); лейбл «Core logic»; boilerplate згорнутий/клавіатура/fallback/too_big лишаються; анотація на позначеному рядку з правильним severity; dismissed не дає анотації. **(new)** `DiffTab.test.tsx`: дефолт Smart; перемикання прибирає анотації; хедер `N files · +Σ −Σ`. `FindingsPanel.test.tsx`: таргет видимий попри фільтри, сфокусований, розгорнутий. **(new)** `FindingsTab.test.tsx`: акордеон із таргетом відкривається, сусідній — ні. | `_components/**/*.test.tsx` | frontend | **G** (test-writer) | react-testing-library, react-best-practices | `pnpm test` |
| 12 | **Insights + PR body.** `/engineering-insights`: кандидати — заміна пропа замість додавання як спосіб зробити шов видимим; клієнтський join як обхід замороженого контракту; `setParams` (один replace на кілька ключів); неперевірювана семантика `wait --text`. PR body завершується Insights. | `INSIGHTS.md` (append-only) | meta | головна сесія | — | `pr-gate.yml` |

---

## Contract & migration impact

**Немає — навмисно.** Жодна копія `vendor/shared` не відкривається; `SmartDiffFile.finding_lines` заморожено. Дані, яких контракт не несе (`id`, `severity`), клієнт уже має з `usePrReviews`. `reviewer-core.yml` не повинен спрацювати. Свідомий наслідок: **серверне `finding_lines` після v2 не рендериться нічим** — мертвий, але сумісний хвіст; його прибирання — окремий бранч. Міграцій немає.

---

## Verification plan

```bash
# 0. Node 22 (на 18 depcruise падає з 'styleText')
source ~/.nvm/nvm.sh && nvm use 22

# 1. Клієнтський лейн — як client.yml:44-60
cd client && pnpm install --frozen-lockfile
cd client && pnpm typecheck
cd client && pnpm exec depcruise src --config .dependency-cruiser.cjs
cd client && node scripts/check-ui-conventions.mjs
cd client && pnpm test

# 2. Доказ незмінності backend і vendor — обидві друкують порожньо
git status --porcelain -- server/
git status --porcelain -- '*/src/vendor/shared/**' '*/src/vendor/ui/**'

# 3. Браузерні флоу (зупинити next dev; спільний client/.next труїть обидва стеки)
rm -rf client/.next
cd e2e && npm ci
./scripts/e2e.sh    # порти зайняті → E2E_PG_PORT=5443 E2E_API_PORT=3101 E2E_WEB_PORT=3100
```

**Barrier 1.5 — ручний прохід на живому стеку (не пропускається), 6 спостережень:**
1. `?tab=diff` — **один** хедер («REVIEWER-ORDERED DIFF», `N files · +Σ −Σ`), не два SectionLabel.
2. Тогл: Smart активний за замовчуванням; «Original order» **прибирає анотації** і групи; назад — повертає.
3. Анотація на самому позначеному рядку з правильним лейблом і кольоровою смугою; довгий переносний рядок її не перекриває.
4. **Клік по анотації → таб Agent runs, потрібний акордеон відкритий, потрібна FindingCard сфокусована/розгорнута/у в'юпорті; URL = `?tab=findings&finding=<id>`.** Повторити з фільтром severity, що ховає таргет. Badge робить те саме для першої знахідки.
5. Boilerplate згорнутий; Core logic / Wiring розгорнуті; маркери й описи на місці.
6. Файл >200 рядків — тінт + чип «large»; **мережевий лог Diff без нових запитів; лог API без модельного виклику.**

**Не запускаємо:** серверні лейни, reviewer-core, `pnpm db:migrate`. **Ніколи** `docker compose down -v`.

---

## Parallel orchestration

Сервер не змінюється → всі шви клієнтські, всі три прибиті іменами.

```
        ┌─ Wave 1 ─────────────────────────────────────────────┐
        │  implementer A  shared diff-viewer   Steps 1-4        │
        │  implementer B  route-local diff tab Steps 5-7        │  concurrent
        │  implementer C  navigation plumbing  Step 8           │
        │  implementer E  e2e flow             Step 9           │
        └───────────────────────┬──────────────────────────────┘
              Barrier 1   — головна сесія ганяє клієнтський лейн ЦІЛКОМ
              Barrier 1.5 — інтеграційний прохід (6 спостережень)
        ┌─ Wave 2 ─────────────────────────────────────────────┐
        │  test-writer F  shared-component tests   Step 10      │  concurrent
        │  test-writer G  route + navigation tests Step 11      │
        └───────────────────────┬──────────────────────────────┘
              Barrier 2   — головна сесія комітить
        ┌─ Wave 3 (read-only) ─────────────────────────────────┐
        │  architecture-reviewer  ∥  plan-verifier              │
        └───────────────────────┬──────────────────────────────┘
              Wave 4  doc-writer → /pr-self-review → /code-review · /security-review → PR
```

**Власність файлів:**

| Agent | Володіє | Не торкається |
|---|---|---|
| **A** | `components/diff-viewer/**` (крім тестів), `messages/en/shell.json` | `src/app/**`, `prReview.json`, `e2e/`, `server/`, `vendor/` |
| **B** | `_components/DiffTab/**`, `_components/SmartDiffViewer/**` (крім тестів), `messages/en/prReview.json` | `page.tsx`, `FindingsTab/**`, `ReviewRunAccordion/**`, `FindingsPanel/**`, `components/diff-viewer/**`, `shell.json` |
| **C** | `page.tsx`, `FindingsTab/**`, `ReviewRunAccordion/**`, `FindingsPanel/**` (крім тестів), `FindingCard/styles.ts` | `DiffTab/**`, `SmartDiffViewer/**`, `components/**`, обидва messages |
| **E** | `e2e/specs/09-*.flow.json`, `e2e/README.md` | флоу 01–08, seed, решта |
| **F** | `components/diff-viewer/**/*.test.tsx` | нетестові файли |
| **G** | `_components/{SmartDiffViewer,DiffTab,FindingsPanel,FindingsTab}/*.test.tsx` | нетестові файли |

**Три шви, прибиті іменами:**
1. **A ↔ B**: форма через барель — `DiffLineAnnotation {findingId: string; line: number; severity: Severity}`; `DiffFileMeta {defaultOpen?, annotations?}` (`findingLines` видалено); `onFindingClick?: (findingId: string) => void`; барель експортує **обидва** типи. B імпортує тільки з барелю, ніколи не перевизначає.
2. **C ↔ B**: інтерфейс `DiffTab` — рівно `findings: FindingRecord[]` + `onOpenFinding: (findingId: string) => void`, **обидва обов'язкові**. B оголошує, C передає; незапаяний шов падає на typecheck — тому typecheck осмислений лише на Barrier 1.
3. **B/C ↔ E**: e2e асертить точні рядки, які пише B: `"Core logic"`, `"Original order"`.

Barrier 1.5 стоїть **перед** Wave 2 навмисно: баг у шві змінює те, що тести мають стверджувати.

---

## Out of scope / left to reviewers

- Чип «✨ summary» / «What this does:» — свідомо ні (модельний виклик); верстка лишає місце.
- Прибирання мертвого `finding_lines` з контракту — окремий бранч (слайс contracts).
- `architecture-reviewer`: чи заміна `findingLines`→`annotations` — найменша робоча зміна; чи не винести join у `lib/`.
- `/security-review`: `?finding=` з URL потрапляє в `querySelector` — перевірити екранування/валідацію id.
- `/code-review`, `plan-verifier` (план за назвою + звіти), `doc-writer`, `/pr-self-review`, демо-відео — людина.

## Risks

| Ризик | Найдешевший ранній сигнал |
|---|---|
| A↔B розходяться у формі `DiffFileMeta` — анотації тихо зникають під зеленим typecheck (записаний баг, `client/INSIGHTS.md:43-55`) | Barrier 1: `rg -n "findingLines" client/src` → **нуль** влучань; B імпортує тип із барелю |
| `DiffLineAnnotation` не в барелі → дубль форми в маршруті | depcruise + `rg DiffLineAnnotation client/src/components/diff-viewer/index.ts` одразу після Кроку 1 |
| Два послідовні `setParam` губляться (спільний знімок search) — `finding` зникає з URL | Barrier 1.5 №4: URL містить **обидва** параметри; тому `setParams` |
| `visibleFindings` ховає таргет (фільтр severity / hideLow) — клік «нікуди» | Тест Кроку 11 + перевірка №4 з увімкненим чужим фільтром |
| Анотація-оверлей наїжджає на переносний рядок | Крок 3: четвертий flex-span; Barrier 1.5 №3 на файлі з довгим рядком |
| Флоу 09 червоніє на «Core logic» (семантика wait --text невідома) | Точний рядок у Кроці 9; прогнати 09 окремо, першим |
| Флоу 05 червоніє | Smart — дефолт; `src/config.ts` не boilerplate; шлях у хедері видно й закритим. Прогнати 05 окремо на Barrier 1 |
| Снап анотації дезінформує / лічильник розходиться з чипами | Тест снапу в Кроці 10; Barrier 1.5: число в badge = кількість видимих чипів |
| Обидва messages-файли редагують двоє | Розділено: `shell.json` — тільки A; `prReview.json` — тільки B |
| C локально падає на typecheck без пропів B | Очікувано: typecheck — на Barrier 1, не в агентів |
| Node 18 → styleText SyntaxError | `node -v`; `nvm use 22` |
| e2e труїть dev-стек через спільний `.next` | `rm -rf client/.next` + зупинений `next dev` |

## Open questions (кожне з дефолтом; жодне не блокує)

1. Тогл: локальний стан чи `?view=`? **Дефолт:** локальний.
2. `?finding=` чистити після приземлення? **Дефолт:** ні (шарабельний діплінк); знімається у `setTab`. Якщо перемонтування FindingsTab не станеться — додати nonce.
3. Кілька знахідок на рядку? **Дефолт:** всі чипи; смуга за найвищою; badge — перша. Шумно → чип найвищої + «+N».
4. Анотація на нерендереному рядку? **Дефолт:** снап на найближчий (`nearestRenderedLine`).
5. `kind === 'review'` у клієнтському фільтрі? **Дефолт:** не застосовувати (лише dismissed) — парність із лічильником таба.
6. Неймспейс нових рядків DiffTab? **Дефолт:** `prReview.smartDiff.*`.
7. Чип «large» у режимі Original? **Дефолт:** так (рахується у FileCard, режим на нього не впливає).
