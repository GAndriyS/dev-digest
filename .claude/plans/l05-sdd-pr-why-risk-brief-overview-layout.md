# Plan: Overview-вкладка PR — три горизонтальні регіони + донат оцінки (SPEC-04 follow-up)

**Branch:** L05-SDD · **Slices:** frontend · **Spec:** specs/SPEC-04-pr-why-risk-brief-20-08-2026.md (approved) · **Mode:** single-agent · **Supersedes:** none

Попередній план тієї ж фічі — `.claude/plans/l05-sdd-pr-why-risk-brief.md` (AC-1…AC-55,
вже реалізовано). Цей план не заміщає його: це окремий follow-up-шматок роботи
поверх готового коду.

## Context read

Обовʼязкове читання перед першим кроком (виконавець читає сам, це не крок плану):
`client/AGENTS.md` і `client/INSIGHTS.md` цілком.

Рядки, що реально звʼязують цю зміну:

- `AGENTS.md:19-21` — `@devdigest/shared` існує двічі; будь-яка зміна, що
  перетинає дріт, редагує обидві копії. **Тут дріт не перетинається** — див.
  *Constraints*, і саме тому жодна копія в плані не зʼявляється.
- `AGENTS.md:34-36` — do-not-touch: `**/src/vendor/ui/**`. `CircularScore` —
  вендорений примітив (`client/src/vendor/ui/primitives/CircularScore.tsx`), він
  **переюзається як є**, з props `size`/`stroke`, і не редагується. Якщо
  здасться, що донат треба «трохи підправити» — це фікс апстрім + re-vendor,
  окрема робота, не цей план.
- `client/AGENTS.md:20-21` — «Pages are thin. Feature logic lives in a colocated
  `_components/<Name>/` with `Name.tsx`, `constants.ts`, `styles.ts`,
  `index.ts`, `Name.test.tsx`» — форма папки для нового блока Review Focus.
- `client/AGENTS.md:16-18` — «All API access goes through `src/lib/api.ts`; data
  hooks live in `src/lib/hooks/*`» — місце для композиційного хука кроку 2.
- `client/AGENTS.md:24` — «UI strings go in `messages/<locale>/*.json`. No
  hardcoded copy» (= AC-41). Локаль у репозиторії наразі одна: `client/messages/en/`.
- `client/AGENTS.md:26-29` + `client/.dependency-cruiser.cjs:43-51`
  (`no-cross-route-internals`) — усередині одного route-дерева
  (`src/app/repos/[repoId]/pulls/[number]/`) сусідні імпорти легальні; правило
  барелів (`no-sibling-component-internals`, `:64-76`) стосується
  `src/components/*`, не `src/app/*`. Тобто новий блок як сусід `PrBriefCard/`
  проходить `pnpm arch`, а `no-orphans` (`:115`) вимагає, щоб він був
  імпортований (він буде — з `OverviewTab`).
- `client/scripts/check-ui-conventions.mjs:12-19` — `export *` у барелі й
  `fetch(` поза `lib/api.ts` — помилка CI. Новий `index.ts` іменує експорт
  поімʼя, як наявний `PrBriefCard/index.ts`.
- `client/INSIGHTS.md` 2026-08-20 (`FileCard`/`DiffViewer` не мають
  `data-*`-якоря; навігація матчить відрендерений текст шляху) — **дотичне, але
  поза цим планом**: переїзд списку Review Focus не змінює механіки переходу,
  тільки місце, де живе кнопка.
- `client/INSIGHTS.md` 2026-08-11 (`setParams` одним оновленням) — переходи
  `?tab=diff&file=` уже написані правильно в `page.tsx:131`; крок 5 нічого в цій
  механіці не змінює, лише передає той самий `onOpenFile` в інший компонент.
- `e2e/INSIGHTS.md:107-114` (2026-08-20) — `wait --text` матчить **відрендерений**
  текст після CSS; флоу 12 асертить `WHY + RISK BRIEF`, `AGENT REVIEW SCORE`,
  `61`, і клікає рядок за accessible name `src/config.ts`. Звідси крок 8.
- `e2e/AGENTS.md:24` — прогін тільки через `./scripts/e2e.sh` (герметичний
  засіяний стек); root `INSIGHTS.md` 2026-08-20 — флоу ніколи не тисне кнопок,
  що витрачають гроші (Regenerate у флоу 12 не натискається і не буде).
- `.claude/skills/pr-self-review/routing.md:65-67,101-104` — `client/**` →
  слайс `frontend`; скіли слайса: `frontend-ui-architecture`,
  `react-best-practices`, `next-best-practices`, плюс `react-testing-library`
  за наявності `*.test.tsx` (він тут є).
- `scripts/verify.mjs:107-112` — слайс `frontend` = client typecheck ·
  depcruise · check-ui-conventions · vitest. Це рівно те, що робить
  `.github/workflows/client.yml`; окремих команд у кроки не інлайнимо.
- Наявний код, який переїжджає:
  `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/constants.ts`
  (`OVERVIEW_GRID_COLS = "repeat(auto-fit, minmax(420px, 1fr))"` — джерело
  третьої колонки, AC-57), `.../PrBriefCard/PrBriefCard.tsx:185-224` (блок
  Review Focus), `.../PrBriefCard/styles.ts:84-133` (`focus*`, `muted`),
  `.../PrBriefCard/PrBriefCard.tsx:153-162` (гола цифра оцінки),
  `client/src/lib/hooks/brief.ts` (`useBrief`, `useGenerateBrief`),
  `client/src/lib/hooks/reviews.ts` (`usePrReviews`),
  `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx:56`
  (`<CircularScore score={pr.score!} size={34} stroke={3} />` — еталон вигляду).

## Requirements review

Джерело вимог — спека, дослівно. Кожен рядок — критерій, який цей план мусить
закрити або явно позначити як незмінний.

| # | Requirement (verbatim) | Verdict | How the plan handles it |
|---|------------------------|---------|-------------------------|
| AC-56 | «розкладати вкладку Overview трьома регіонами саме в цьому порядку зверху вниз: регіон 1 на 100% ширини, регіон 2 у дві колонки, регіон 3 на 100% ширини» | clear | Крок 1 |
| AC-57 | «ЯКЩО ширина вкладки дозволяє більш ніж дві колонки по 420px … ТОДІ система не повинна показувати brief, `IntentCard` і `BlastTab` як три колонки одного рядка» | clear | Крок 1: зовнішній контейнер — одна колонка, `auto-fit`-грід лишається **лише** навколо двох карток регіону 2, тож третьої доріжки не існує структурно. Перевірка — асерт на оголошеному `grid-template-columns` і на DOM-структурі: jsdom не має layout-движка й «ширину 1440px» не міряє (тому в кроці 7 це асерт на декларацію, а не на обчислену розкладку) |
| AC-58 | «ПОКИ доступної ширини не вистачає на дві колонки по 420px … стакати регіон 2 в одну колонку, зберігаючи наскрізний порядок: регіон 1 → `IntentCard` → `BlastTab` → регіон 3» | clear | Крок 1: поріг 420px лишається тим самим `OVERVIEW_GRID_COLS`, стакання дає сам `auto-fit`; наскрізний порядок = порядок у DOM (див. AC-69). Перевірка — та сама, що в AC-57 |
| AC-59 | «Регіон 1 повинен містити заголовок секції з кнопкою Regenerate, бейдж рівня ризику, мітку застарілості, оцінку ревʼю агента і блоки `what`, `why`, `risks[]`» | clear | Крок 4 (склад) + крок 6 (донат) |
| AC-60 | «Регіон 3 повинен містити заголовок Review Focus із лічильником кількості показаних елементів і список `review_focus[]`, і нічого з переліченого в AC-59» | clear | Кроки 3 (ключі) і 5 |
| AC-61 | «показувати на вкладці Overview рівно одну кнопку регенерації brief — у заголовку регіону 1; регіон 3 власної кнопки не має» | clear | Крок 4 лишає кнопку там, де вона є; крок 5 її не додає; крок 7 асертить кількість |
| AC-62 | «будувати обидва регіони з того самого одного читання brief і не додавати через поділ на два блоки жодного нового мережевого запиту» | clear | Крок 2 — підняття хука в один call site, обидва регіони отримують дані пропсами. Обґрунтування рішення — у *Decisions taken* |
| AC-63 | «ПОКИ для PR немає завантаженого brief — триває завантаження, сталася помилка завантаження або brief ще не згенеровано, — не повинна рендерити регіон 3; ці стани показує лише регіон 1, лишаючись на 100% ширини» | clear | Крок 5 (гейт рендеру в `OverviewTab`) |
| AC-64 | «ПОКИ brief завантажено, а `review_focus[]` порожній, показувати регіон 3 з лічильником `0` і чесним текстом AC-21, а не ховати блок» | clear | Кроки 3 і 5; лічильник при нулі — рішення людини (RESOLVED 20/08/2026) |
| AC-65 | «ЯКЩО запит генерації завершився помилкою, ТОДІ показати повідомлення про помилку рівно один раз і саме в регіоні 1, не дублюючи його в регіоні 3» | clear | Крок 4: `generateError` лишається в регіоні 1; крок 5 не отримує його пропсом узагалі |
| AC-66 | «ПОКИ триває регенерація, регіон 3 повинен показувати попередній список `review_focus[]` до приходу нового результату» | clear | Крок 2 віддає останній успішний `brief` під час `isPending` (React Query не скидає `data` мутацією); крок 5 рендерить його без власного скелета |
| AC-67 | «ЯКЩО показаний brief позначено застарілим, ТОДІ показувати мітку застарілості лише в регіоні 1 … і не дублювати її в регіоні 3» | clear | Крок 4 лишає бейдж на місці; крок 5 його не має |
| AC-68 | «рендерити оцінку ревʼю агента в регіоні 1 тим самим донат-примітивом `CircularScore` з `@devdigest/ui` …, а не голою цифрою» | clear | Крок 6, `size={34} stroke={3}` (RESOLVED 20/08/2026) |
| AC-69 | «тримати порядок елементів у DOM таким самим, як візуальний порядок трьох регіонів, щоб послідовність фокусу з клавіатури йшла регіон 1 → регіон 2 → регіон 3» | clear | Крок 1: три сиблінги в порядку рендеру, без `order`, без `grid-template-areas`, без `direction`; крок 7 асертить порядок |
| AC-21 *(амендовано)* | «ЯКЩО після відкидання незаземлених посилань `review_focus[]` порожній, ТОДІ … блок Review Focus — показати чесний текст “немає файлів для пріоритетного огляду”, без вигаданих шляхів» | clear | Крок 5, переюз наявного ключа `brief.card.reviewFocusEmpty` |
| AC-30 *(амендовано)* | «показувати Why + Risk Brief на вкладці Overview … разом із наявними `IntentCard` і `BlastTab`, які займають двоколонковий регіон 2 … і поведінки яких вона не змінює» | clear | Крок 1 — переїжджає лише розкладка; жоден файл `IntentCard/**` чи `BlastTab/**` не редагується (див. *Out of scope*) |
| AC-33 *(амендовано)* | «показувати Review Focus у власному повноширинному блоці як список елементів `файл — пояснення`, де кожен елемент є інтерактивним керуванням, доступним із клавіатури» | clear | Крок 5 — розмітка рядків переноситься **дослівно**, `<button type="button">` лишається `<button>` |
| AC-34 | «КОЛИ користувач активує елемент Review Focus, … відкрити вкладку змін цього PR із цим файлом, розгорнутим і прокрученим у зону видимості» | clear (регресія) | Не переробляється: `onOpenFile` проходить у новий блок незміненим (крок 5); крок 8 доводить це через флоу 12 |
| AC-36 | «ЯКЩО файл із `review_focus[]` відсутній у списку файлів, який показує вкладка змін, ТОДІ показати цей елемент як неінтерактивний» | clear (регресія) | `navigablePaths` проходить у новий блок незміненим (крок 5), логіка `canOpen` переноситься дослівно; крок 7 лишає її тест |
| AC-44 | «рендерити `what`, `why`, тексти ризиків і пояснення Review Focus як екранований текст, без інтерпретації HTML» | clear (регресія) | Обидва регіони лишаються звичайними React-текстовими вузлами; жодного `dangerouslySetInnerHTML`, жодного `Markdown`-примітиву не додається |
| AC-48 | «ПОКИ для PR немає жодного ревʼю … картка повинна показувати brief без оцінки з текстовою міткою “ще не перевірено агентом”, а не 0, не порожню шкалу» | clear (регресія) | Крок 6: `score == null` → донат **не рендериться взагалі**, лишається наявний `t("card.noScore")` |
| AC-53 | «КОЛИ користувач регенерує brief, показана оцінка не повинна змінюватись» | clear (регресія) | Крок 2: `usePrReviews` лишається окремим джерелом і мутацією brief не інвалідиться |
| AC-55 | «підписувати оцінку як результат ревʼю агента, окремо від блоків `what`, `why` і `risk_level`» | clear (регресія) | Крок 6 зберігає підпис `card.scoreLabel` поруч із донатом — він же тримає флоу 12 (`AGENT REVIEW SCORE`) |
| AC-37…AC-40 | порожній стан із CTA / стан завантаження / стан помилки з Retry / мітка застарілості | clear (регресія) | Кроки 2 і 4: стани лишаються в регіоні 1 з тими самими примітивами (`Skeleton`, `ErrorState`, `EmptyState`) і тими самими ключами повідомлень |
| AC-41 | «брати всі рядки інтерфейсу картки з `client/messages/<locale>/*.json`, без захардкодженого тексту в компоненті» | clear | Крок 3 — нові рядки регіону 3 в `client/messages/en/brief.json`, наявні `card.*` переюзуються |
| NFR *i18n (follow-up)* | «нові рядки інтерфейсу (заголовок блока Review Focus і його лічильник) додаються в `client/messages/<locale>/*.json` … наявні ключі `brief.card.*` … перевикористовуються, а не дублюються під новий блок» | clear | Крок 3 явно забороняє дублювати `card.reviewFocus*` під новим неймспейсом |
| NFR *Performance (розкладка)* | «поділ картки на два блоки не додає ні запиту, ні виклику моделі: обидва регіони живляться з того самого читання brief (AC-62)» | clear | Крок 2 + асерт кроку 7 на кількість call sites |
| NFR *Accessibility* | «Після поділу на регіони порядок у DOM збігається з візуальним (AC-69), а донат несе те саме число текстом усередині» | clear | Крок 1 (порядок), крок 6 (`CircularScore` малює `{score}` текстом усередині — `CircularScore.tsx:32-44`) |
| NFR *Contracts (follow-up)* | «розкладка й донат не змінюють нічого на дроті … Якщо план виявить потребу в новому полі — це зміна scope і привід повернутись до спеки» | clear | *Constraints*: жодної правки контрактів; це ж — «сигнал, що щось не так зі scope» з делегації |
| Edge case | «brief ще не згенеровано, а регіон 3? → блок Review Focus не рендериться взагалі» | clear | Крок 5 (AC-63) |
| Edge case | «Помилка завантаження brief → лише регіон 1 зі станом помилки й Retry, регіону 3 немає» | clear | Крок 5 (AC-63) |
| Edge case | «Помилка генерації поверх уже показаного brief → повідомлення в регіоні 1, обидва регіони зберігають попередній вміст» | clear | Кроки 4, 5 (AC-65, AC-66) |
| Edge case | «Оцінки немає, brief є → донат не малюється взагалі» | clear | Крок 6 (AC-48, AC-68) |
| Edge case | «Дуже довгий шлях файла або пояснення в регіоні 3 → рядок лишається одним елементом списку на всю ширину; ширший блок не робить неінтерактивний елемент інтерактивним» | clear (спосіб переносу тексту — «no AC, належить плану») | Крок 5: `focusReason` лишається з наявним `overflow/textOverflow: ellipsis` в один рядок, `focusPath` — `flexShrink: 0`; ширший блок дає більше місця й нічого не змінює в правилах інтерактивності |
| Edge case | «Наявний e2e-флоу `12-pr-why-risk-brief.flow.json` … флоу треба перевірити цілком, а не вважати незмінним» | clear | Крок 8 — окремий крок плану, з прогоном |
| Edge case | «Наявний e2e-флоу `02-repo-pulls-detail.flow.json` … лишається чинним … названо, щоб план не “виправив” його помилково» | clear | *Out of scope*: флоу 02 не редагується; крок 8 лише переконується, що він зелений |

**Спека не тонка, план не вигадує критеріїв.** Жодного рядка з вердиктом
`ambiguous` / `untestable` / `conflicts` / `out of reach` немає, жодна вимога не
`waived`.

## Decisions taken

1. **Режим виконання — single-agent, один прохід** *(human-answered: «Режим
   виконання: single-agent, один прохід — не питай про це, обсяг малий і суто
   клієнтський»)*. Отже колонка Executor скрізь `single pass`, верифікація
   інлайниться після кожного кроку, а ревʼю після плану людина запускає руками.
2. **Оцінка показується лише разом із завантаженим brief** *(human-answered,
   спека → Open questions, `[RESOLVED 20/08/2026]`)* — порожній стан регіону 1
   оцінки не несе. Поведінка вже така; план її не змінює.
3. **Донат `size={34} stroke={3}`** *(human-answered, `[RESOLVED 20/08/2026]`)* —
   як колонка Score у списку PR; варіант `VerdictBanner` (52/5) не чіпаємо.
4. **Лічильник у заголовку регіону 3 лишається при нулі й показує `0`**
   *(human-answered, `[RESOLVED 20/08/2026]`)*.
5. **Один фетч на обидва блоки — підняттям хука в `OverviewTab` через
   композиційний хук у `src/lib/hooks/brief.ts`** *(default-assumed — вибір
   плану, делегація вимагала назвати рішення і причину, але не назвала його
   сама)*. `useBrief` / `useGenerateBrief` / `usePrReviews` викликаються рівно по
   одному разу — у новому `usePrBriefSection(prId)`, який `OverviewTab` викликає
   один раз і роздає результат обом регіонам пропсами.
   *Чому саме так, а не інакше:*
   - **Не два незалежні `useBrief` у двох сиблінгах.** React Query за спільним
     ключем зробив би один мережевий запит, тобто буква AC-62 вціліла б, але
     кожен блок мав би власні `isLoading`/`isError` — тобто два скелети й дві
     кнопки Retry, які AC-63 і AC-65 прямо забороняють. Стан довелося б тримати
     синхронним домовленістю, а не конструкцією.
   - **Не спільний батьківський компонент-обгортка над обома блоками.** Між
     регіонами 1 і 3 стоїть регіон 2, тож обгортка мусила б володіти розкладкою
     всіх трьох регіонів і приймати `IntentCard`/`BlastTab` слотом — компонент
     brief почав би керувати чужими картками, чого AC-30 і Non-goals не хочуть.
   - **Не сирі три хуки прямо в тілі `OverviewTab`.** Працює, але робить із
     layout-компонента власника даних; `client/AGENTS.md:16-18` каже, що data
     hooks живуть у `src/lib/hooks/*`, і саме там уже лежать обидва вихідні
     хуки. Композиційний хук лишає `OverviewTab` розкладкою, а обидва регіони —
     чистими prop-driven компонентами, які тривіально тестуються без
     `QueryClientProvider` (як уже роблять наявні сюїти).
   - Route-local файла хука уникаємо свідомо: у `client/src/app/**` сьогодні
     немає жодного `use*.ts`, тобто прецеденту для такого місця немає.
   *Наслідок, який виконавець мусить прийняти:* `PrBriefCard` стає prop-driven,
   тож `PrBriefCard.test.tsx` перестає мокати хуки й починає передавати пропси —
   це переписування сюїти, а не косметика (крок 7).
6. **Новий блок живе в `_components/ReviewFocusPanel/`, сусідом `PrBriefCard/`**
   *(default-assumed)* — спека сама називає їх «одна фіча, два блоки»
   (§ «Розкладка вкладки Overview», вступ), а `PrBriefCard/` уже лежить саме
   там. Альтернатива `OverviewTab/_components/` (де живуть `IntentCard` і
   `BlastTab`) правилам теж не суперечить, але розводить дві половини однієї
   фічі по різних рівнях дерева.

## Recommendations

- **Перейменувати `PrBriefCard` → щось на кшталт `PrBriefPanel` після переїзду.**
  *Чому:* після кроку 4 компонент більше не «картка з усім brief», а регіон 1.
  *Якщо прийнято:* +1 крок на перейменування папки, барела, тесту й імпорту в
  `OverviewTab`; ризик — зайвий шум у diff і зайва мішень для флоу 12.
  **Default: as requested** — імʼя лишається `PrBriefCard`.
- **Додати `data-file-path` на корінь `FileCard` і зняти матчинг за текстом**
  (`client/INSIGHTS.md` 2026-08-20 прямо це радить «наступного разу, коли цей
  компонент чіпають»). *Чому:* нинішня навігація в файл ламається мовчки.
  *Якщо прийнято:* +1 крок у `client/src/components/diff-viewer/**` і правка
  `page.tsx`. **Default: as requested** — поза scope цього плану: делегація
  обмежила його `OverviewTab`/`PrBriefCard`, а `diff-viewer` — інша поверхня.
- **Окремий тестовий прохід `test-writer`.** `test-writer` **не входить** у
  дефолтний ланцюг `/implement` (root `AGENTS.md` → «Use when» → Building an
  approved plan). Тести цього плану написані як частина кроків 7 і 8 і цього
  достатньо для AC. Якщо хочеться ширшого покриття (напр. проби розкладки на
  кількох ширинах) — делегуй `test-writer` руками **після** кроку 9.
  **Default: as requested** — без окремого проходу.

## Constraints that bind this change

- **Чи щось перетинає дріт?** **Ні.** `PrWhyBrief` і його клієнтська копія
  (`server/src/vendor/shared/contracts/brief.ts` ↔
  `client/src/vendor/shared/contracts/brief.ts`) лишаються байт-у-байт
  однаковими; нових полів немає, `score` у контракт не заходить (AC-54).
  Жодна з двох копій `@devdigest/shared` у цьому плані не редагується.
- **Contracts are Zod-first.** Не зачіпається — нових схем і нової валідації
  немає, клієнт лише читає вже наявний тип.
- **Міграції.** Не зачіпається — жодної нової міграції, `pr_brief` без змін,
  `cd server && pnpm db:migrate` тут не потрібен.
- **Тестова смуга.** DB-backed тестів цей план не додає, тож правило
  `*.it.test.ts` не спрацьовує. Усі нові тести — клієнтські `*.test.tsx`
  (unit-смуга `client.yml`).
- **Пакетний менеджер.** `client/` → **pnpm**. Установка в корені не робить
  нічого. Нових залежностей план не додає взагалі.
- **`reviewer-core` не емітить JS.** Не зачіпається.
- **Do-not-touch:** `**/src/vendor/ui/**` — `CircularScore` переюзається, не
  редагується. `server/clones/**` і `server/src/db/migrations/*.sql` — поза
  дотиком.
- **Layering.** Онион-межі сервера не зачіпаються. Клієнтський аналог —
  `client/.dependency-cruiser.cjs` + `check-ui-conventions.mjs`: новий компонент
  лишається всередині свого route-дерева, барель іменує експорт поімʼя,
  `fetch(` ніде не зʼявляється, композиційний хук у `src/lib/hooks/` не імпортує
  нічого з `src/app/` (`shared-does-not-know-features`, `.dependency-cruiser.cjs:52-60`).

## Steps

| # | Change | Files / seams | Slice | Satisfies | Depends on | Executor | Skills the executor applies | Verification |
|---|--------|---------------|-------|-----------|------------|----------|-----------------------------|--------------|
| 1 | Розкласти `OverviewTab` трьома регіонами: зовнішній контейнер — одна повноширинна колонка з трьома сиблінгами в порядку рендеру; `auto-fit`-грід із порогом 420px лишається **тільки** навколо `IntentCard`+`BlastTab` (регіон 2). Ніякого `order`, `grid-template-areas` чи іншого CSS-перетасування — візуальний порядок = порядок у DOM. Оновити доккоментар `OVERVIEW_GRID_COLS`: він більше не описує «три картки», а рівно дві | `OverviewTab/OverviewTab.tsx`, `OverviewTab/styles.ts`, `OverviewTab/constants.ts` | frontend | AC-56, AC-57, AC-58, AC-69, AC-30 | — | single pass | `frontend-ui-architecture`, `react-best-practices` | `node scripts/verify.mjs --slice frontend` |
| 2 | Підняти читання brief в один call site: новий `usePrBriefSection(prId)` поруч із `useBrief`/`useGenerateBrief`, композує їх із `usePrReviews` і віддає одну view-модель (brief, стани завантаження/помилки, стан і тригер генерації, `score`). `OverviewTab` викликає його один раз | `client/src/lib/hooks/brief.ts` (новий експорт), `OverviewTab/OverviewTab.tsx` | frontend | AC-62, AC-47, AC-53, NFR *Performance (розкладка)* | 1 | single pass | `react-best-practices`, `frontend-ui-architecture` | `node scripts/verify.mjs --slice frontend` |
| 3 | Додати рядки регіону 3 в `client/messages/en/brief.json`: заголовок блока і лічильник. Наявні `card.reviewFocus`, `card.reviewFocusEmpty`, `card.scoreLabel`, `card.noScore`, `card.stale`, `card.empty*` **переюзуються**, а не дублюються під новий неймспейс | `client/messages/en/brief.json` | frontend | AC-41, AC-60, AC-64, NFR *i18n (follow-up)* | — | single pass | — | `node scripts/verify.mjs --slice frontend` |
| 4 | Звести `PrBriefCard` до регіону 1: прибрати виклики хуків (дані приходять пропсами з кроку 2), лишити `SectionLabel` + єдину кнопку Regenerate, помилку генерації, `Skeleton`/`ErrorState`/`EmptyState`, `topRow` (бейдж ризику, мітка застарілості, оцінка), блоки `what`/`why`/`risks`. Видалити блок Review Focus і перенести його стилі (`focus*`, `muted`) у папку кроку 5 — не імпортувати їх звідти сусідом | `PrBriefCard/PrBriefCard.tsx`, `PrBriefCard/styles.ts` | frontend | AC-59, AC-61, AC-65, AC-67, AC-37, AC-38, AC-39, AC-40, AC-44 | 2 | single pass | `frontend-ui-architecture`, `react-best-practices` | `node scripts/verify.mjs --slice frontend` |
| 5 | Новий блок регіону 3 — `_components/ReviewFocusPanel/{ReviewFocusPanel.tsx,styles.ts,index.ts}` (+`constants.ts`, якщо буде що в нього класти): заголовок + лічильник показаних елементів, список `review_focus[]` із **дослівно перенесеною** розміткою рядків (кнопка при `onOpenFile` + `navigablePaths`, статичний рядок інакше), порожній стан із лічильником `0` і наявним текстом. Ані кнопки Regenerate, ані мітки застарілості, ані повідомлення про помилку генерації тут немає. `OverviewTab` рендерить блок **лише** коли brief завантажено | `_components/ReviewFocusPanel/**` (новий), `OverviewTab/OverviewTab.tsx` | frontend | AC-33, AC-60, AC-63, AC-64, AC-66, AC-21, AC-34, AC-36, AC-44 | 2, 3, 4 | single pass | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` | `node scripts/verify.mjs --slice frontend` |
| 6 | Замінити голу цифру оцінки на `<CircularScore score={score} size={34} stroke={3} />` з `@devdigest/ui`, зберігши підпис-джерело поруч. При `score == null` донат не рендериться взагалі — лишається наявна текстова мітка | `PrBriefCard/PrBriefCard.tsx`, `PrBriefCard/styles.ts` | frontend | AC-68, AC-55, AC-48, AC-47 | 4 | single pass | `react-best-practices`, `frontend-ui-architecture` | `node scripts/verify.mjs --slice frontend` |
| 7 | Тести RTL: переписати `PrBriefCard.test.tsx` на prop-driven рендер (замість моків хуків) і лишити наявні асерти станів; новий `ReviewFocusPanel.test.tsx` (кнопка/статичний рядок, порожній стан із `0`, екранований текст); розширити `OverviewTab.test.tsx` — порядок трьох регіонів у DOM, оголошені `grid-template-columns` обох рівнів, рівно одна кнопка Regenerate, відсутність регіону 3 у станах loading/error/empty, донат замість цифри | `PrBriefCard/PrBriefCard.test.tsx`, `_components/ReviewFocusPanel/ReviewFocusPanel.test.tsx` (новий), `OverviewTab/OverviewTab.test.tsx` | frontend | AC-56…AC-69, AC-21, AC-30, AC-33, AC-36, AC-44, AC-48, AC-53, AC-55, AC-61 | 5, 6 | single pass | `react-testing-library`, `react-best-practices` | `node scripts/verify.mjs --slice frontend` |
| 8 | Перевірити й, за потреби, оновити `e2e/specs/12-pr-why-risk-brief.flow.json`: рядок Review Focus тепер під регіоном 2, тож `set viewport 1280 2000` може вже не діставати до кнопки — підняти висоту; звірити всі `wait --text` з **відрендереним** текстом після переїзду; кнопку Regenerate так і не тиснути. `02-repo-pulls-detail.flow.json` не редагувати — лише переконатись, що він зелений | `e2e/specs/12-pr-why-risk-brief.flow.json` | e2e | AC-34, AC-35, AC-47, AC-68 (e2e-смуга), edge case «Наявний e2e-флоу 12» | 7 | single pass | — | `./scripts/e2e.sh` |
| 9 | Фінальний прогін смуги + `/pr-self-review` руками перед PR | — | frontend, e2e | — (scaffolding для 1–8) | 8 | single pass | — | `node scripts/verify.mjs --slice frontend`, `./scripts/e2e.sh` |

## Execution

**Single-agent, один прохід.** Кроки виконуються в номерному порядку; колонка
*Depends on* — це саме DAG, а не декорація: крок 3 (messages) незалежний і його
можна зробити першим, решта лінійна. Верифікація інлайниться **після кожного
кроку**, а не батчиться в кінці: `node scripts/verify.mjs --slice frontend`
дешевий і ловить `depcruise`/`check-ui-conventions` рівно тоді, коли зʼявляється
новий файл чи барель.

Перед першим кроком виконавець читає `client/AGENTS.md` і `client/INSIGHTS.md`
цілком (це не крок плану — це вхідна умова).

Що людина запускає руками **після** кроку 9, бо в одному проході ланцюга ревʼю
немає: `/code-review`, `/security-review` (поверхня мала — це рендер уже
недовіреного тексту, який не змінює правил екранування, але прохід дешевий),
`/pr-self-review` перед відкриттям PR. `architecture-reviewer` і `plan-verifier`
за бажанням — саме `plan-verifier` звіряє гілку з таблицею **Requirements
review** вище і повертає спеку в `implemented`.

## Contract & migration impact

**Нічого.** Жодне поле не перетинає дріт; обидві копії
`@devdigest/shared/contracts/brief.ts` лишаються незмінними й ідентичними одна
одній; нових запитів немає (AC-62); нової міграції немає; `pr_brief` і
`reviews` не змінюються.

Поле, значення якого варте фіксації, бо два блоки читатимуть його по-різному,
одне — **`review_focus[].path`**:

- **регіон 3, рядок-кнопка** — `path` є в `navigablePaths` (тобто серед
  змінених файлів PR): значення трактується як **repo-relative шлях-ціль
  навігації**, віддається в `onOpenFile(path)` **сирим**, без ручного
  екранування; кодує його `URLSearchParams` у `page.tsx:131` (флоу 12 асертить
  саме `file=src%2Fconfig.ts`);
- **регіон 3, статичний рядок** — `path` поза `navigablePaths` або `onOpenFile`
  відсутній: те саме значення трактується як **чистий текст для показу**, не
  ціль. Ніякої кнопки, ніякого `disabled`-варіанта, ніякого фокусу;
- **обидва випадки** — на екран `path` іде як екранований React-текстовий вузол
  (AC-44) і ніколи не використовується для читання диска.

Тобто «шлях» тут — водночас *ідентифікатор переходу* і *недовірений рядок для
показу*, і саме `navigablePaths` вирішує, який із двох сенсів застосовано.
Переплутати їх — це або мертва кнопка, або клікабельний шлях, якого нема в diff.

## Verification plan

- `node scripts/verify.mjs --slice frontend` — після кожного з кроків 1–7 і в
  кроці 9 (client typecheck · depcruise · check-ui-conventions · vitest; це
  інлайн `.github/workflows/client.yml`).
- `./scripts/e2e.sh` — кроки 8 і 9. Герметичний засіяний стек; проти локальних
  репозиторіїв флоу падають (`e2e/AGENTS.md:24`). Смуга `frontend` цього не
  покриває, тому це окремий рядок.
- `node scripts/pr-gate-ci.mjs` — не запускається виконавцем; це CI-половина
  гейта перед PR, і план її лише називає, щоб «нічого більше» не читалось як
  «нічого не існує».

Серверних смуг (`backend`, `integration`, `reviewer-core`, `mcp`) цей план не
торкається — якщо якась із них знадобилась, це сигнал, що scope поїхав.

## Out of scope / left to reviewers

Дослівно з Non-goals спеки (follow-up 20/08/2026):

- «**Серверна частина, контракт і БД** *(follow-up 20/08/2026)*. Розкладка й
  донат — зміна суто **клієнтська**: контракт `PrWhyBrief` … і його дзеркало в
  `client/src/vendor/shared/contracts/brief.ts`, маршрути `GET`/`POST
  /pulls/:id/brief`, таблиця `pr_brief` і будь-яка міграція лишаються без змін.
  Нових полів на дріт немає, нових запитів немає (AC-62).»
- «**Нові дані в оцінці** *(follow-up 20/08/2026)*. Донат змінює лише спосіб
  показу вже читаної цифри…»
- «**Редизайн вкладки Overview.** `IntentCard` і `BlastTab` лишаються як є …
  *(follow-up 20/08/2026: їхня поведінка й далі не змінюється — змінюється лише
  місце, яке вони займають у розкладці, AC-30, AC-56.)*» — тобто жоден файл у
  `OverviewTab/_components/IntentCard/**` і `.../BlastTab/**` не редагується.
- «**Верхня плашка мокапу як блок**», «**Обчислення, перерахунок чи зберігання
  `score`**», «**“Prior PRs touching these files”**», «**Зміна наявного
  контракту `PrBrief`**», «**MCP-інструмент** для brief і **автоматична
  генерація**» — усе лишається поза scope без змін.

Крім того поза цим планом: `docs/**`, `e2e/specs/02-repo-pulls-detail.flow.json`
(не редагувати — спека називає його прямо), `client/src/components/diff-viewer/**`
(див. другу *Recommendation*), `INSIGHTS.md` (пише `/engineering-insights`
головною сесією, не виконавець), і сама спека — повернути `Status:` в
`implemented` має `plan-verifier`/людина після `COMPLETE`, не цей прохід.

Лишається ревʼюерам: `/code-review`, `/security-review`, `architecture-reviewer`,
`/pr-self-review`, відкриття PR.

## Risks

- **Флоу 12 падає на висоті вікна.** Регіон 3 переїжджає під регіон 2, тож
  кнопка `src/config.ts` опиняється нижче, ніж була, а `find role button click`
  на невидимій точці «успішно» клікає щось інше (`e2e/INSIGHTS.md`, той самий
  клас багів, що в 08/11). *Найдешевший ранній сигнал:* крок 8 запускається
  одразу після кроку 7 і дивиться, чи `wait --url tab=diff` взагалі настає;
  якщо ні — першою підозрою є viewport, а не логіка.
- **`PrBriefCard.test.tsx` переписується, і разом із ним тихо зникає покриття
  AC-44/AC-48/AC-53/AC-55.** Сюїта сьогодні мокає хуки; після кроку 4 вона
  передає пропси, і при переписуванні легко «спростити» саме ті кейси.
  *Сигнал:* перед кроком 7 випиши список `it(...)` наявної сюїти і звір із новим
  — кожен наявний кейс має мати наступника.
- **AC-57/AC-58 неперевірні прямим вимірюванням.** jsdom не має layout-движка,
  тож «на 1440px три колонки не зʼявляються» доводиться структурою (зовнішній
  контейнер — одна колонка) плюс асертом на оголошений `grid-template-columns`.
  *Сигнал:* якщо тест намагається читати `getBoundingClientRect()` — він
  доводить не те; переходь на асерт декларації + DOM-порядку, а візуальну
  перевірку роби оком у `./scripts/dev.sh` на широкому вікні.
- **Стилі `focus*` лишаються в двох місцях.** Копіювання замість переносу дає
  мертвий код у `PrBriefCard/styles.ts`, який `depcruise` не побачить (це не
  модуль-сирота, а невикористані ключі обʼєкта). *Сигнал:* після кроку 5
  прогрепай `focusRowBase|focusPath|focusReason|focusArrow|focusIcon|focusList`
  — збігів має лишитись рівно один комплект, у новій папці.
- **Донат «зʼїдає» підпис оцінки.** `CircularScore` малює число всередині, і
  спокуса прибрати `card.scoreLabel` як дублювання велика — але це рівно те, що
  асертить флоу 12 (`AGENT REVIEW SCORE`) і чого вимагає AC-55. *Сигнал:*
  крок 8 упаде на `wait --text AGENT REVIEW SCORE`.

## Open questions

- **Точний заголовок регіону 3.** Мокап каже «REVIEW FOCUS — READ THESE FIRST»,
  наявний ключ `brief.card.reviewFocus` каже «Review focus»; AC-60 вимагає лише
  «заголовок Review Focus із лічильником». *Рішення людини 20/08/2026 —
  виконавець бере його, не дефолт:* заголовок регіону 3 повторює мокап —
  «Review focus — read these first» (рендериться uppercase, як решта
  `SectionLabel`), новим ключем у `brief` неймспейсі; наявний
  `brief.card.reviewFocus` лишається для будь-яких інших call sites, а під
  лічильник додається окремий ключ.
- **Форма лічильника.** *Default:* число поруч із заголовком (у `right`-слоті
  `SectionLabel` або як окремий елемент заголовка), формат — просто `{count}`,
  при нулі `0` (рішення людини). Локалізовану фразу («N files») не вигадуємо.
- **Чи додавати новий `wait --text` на заголовок регіону 3 у флоу 12.**
  *Default:* так, один рядок після переходу на Overview — інакше факт існування
  регіону 3 e2e-смуга ніяк не бачить. Якщо це зробить флоу крихким на
  `text-transform`, матч береться у відрендереному (uppercase) вигляді
  (`e2e/INSIGHTS.md` 2026-08-20).
