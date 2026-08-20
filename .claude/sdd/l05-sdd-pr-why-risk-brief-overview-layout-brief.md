# Handoff brief — l05-sdd-pr-why-risk-brief-overview-layout

Spec: `specs/SPEC-04-pr-why-risk-brief-20-08-2026.md` (approved — follow-up AC-56…AC-69, амендовані AC-21, AC-30, AC-33) ·
Plan: `.claude/plans/l05-sdd-pr-why-risk-brief-overview-layout.md` ·
Branch: `L05-SDD` · Base: `5d82522d6bd6ad2139fa11b067aa4a7fc2ddffe9`

Зміна суто клієнтська: вкладка Overview сторінки PR розкладається трьома
горизонтальними регіонами (1 — Why + Risk Brief на 100%, 2 — `IntentCard` |
`BlastTab` у дві колонки, 3 — Review Focus на 100%), а оцінка ревʼю агента
рендериться донатом `CircularScore`.

## Binding rules (locators, not prose)

Обовʼязкове читання перед першим кроком: `client/AGENTS.md` і
`client/INSIGHTS.md` цілком.

- `AGENTS.md:19-21` — `@devdigest/shared` існує двічі; будь-яка зміна, що
  перетинає дріт, редагує обидві копії. **Тут дріт не перетинається** — жодна
  копія в цьому плані не редагується.
- `AGENTS.md:34-36` — do-not-touch: `**/src/vendor/ui/**`. `CircularScore`
  (`client/src/vendor/ui/primitives/CircularScore.tsx`) **переюзається як є**,
  через props `size`/`stroke`, і не редагується.
- `client/AGENTS.md:20-21` — «Pages are thin. Feature logic lives in a colocated
  `_components/<Name>/` with `Name.tsx`, `constants.ts`, `styles.ts`,
  `index.ts`, `Name.test.tsx`» — форма папки для нового `ReviewFocusPanel/`.
- `client/AGENTS.md:16-18` — «All API access goes through `src/lib/api.ts`; data
  hooks live in `src/lib/hooks/*`» — місце для композиційного хука кроку 2.
- `client/AGENTS.md:24` — «UI strings go in `messages/<locale>/*.json`. No
  hardcoded copy» (= AC-41). Локаль у репозиторії одна: `client/messages/en/`.
- `client/AGENTS.md:26-29` + `client/.dependency-cruiser.cjs:43-51`
  (`no-cross-route-internals`) — усередині одного route-дерева
  (`src/app/repos/[repoId]/pulls/[number]/`) сусідні імпорти легальні;
  `no-sibling-component-internals` (`:64-76`) стосується `src/components/*`, не
  `src/app/*`; `no-orphans` (`:115`) вимагає, щоб новий блок був імпортований.
- `client/scripts/check-ui-conventions.mjs:12-19` — `export *` у барелі й
  `fetch(` поза `lib/api.ts` — помилка CI. Новий `index.ts` іменує експорт
  поімʼя, як наявний `PrBriefCard/index.ts`.
- `client/.dependency-cruiser.cjs:52-60` (`shared-does-not-know-features`) —
  композиційний хук у `src/lib/hooks/` не імпортує нічого з `src/app/`.
- `client/INSIGHTS.md` 2026-08-20 — `FileCard`/`DiffViewer` не мають
  `data-*`-якоря, навігація матчить відрендерений текст шляху. Дотичне, але
  **поза цим планом**: переїзд списку не змінює механіки переходу.
- `client/INSIGHTS.md` 2026-08-11 — `setParams` одним оновленням; переходи
  `?tab=diff&file=` уже написані правильно в `page.tsx:131`.
- `e2e/INSIGHTS.md:107-114` (2026-08-20) — `wait --text` матчить
  **відрендерений** текст після CSS; флоу 12 асертить `WHY + RISK BRIEF`,
  `AGENT REVIEW SCORE`, `61` і клікає рядок за accessible name `src/config.ts`.
- `e2e/AGENTS.md:24` — прогін тільки через `./scripts/e2e.sh`; флоу ніколи не
  тисне кнопок, що витрачають гроші (Regenerate у флоу 12 не натискається).
- `scripts/verify.mjs:107-112` — слайс `frontend` = client typecheck ·
  depcruise · check-ui-conventions · vitest. Окремих команд у кроки не інлайнити.
- Наявний код, який переїжджає: `OverviewTab/constants.ts`
  (`OVERVIEW_GRID_COLS = "repeat(auto-fit, minmax(420px, 1fr))"` — джерело
  третьої колонки, AC-57) · `PrBriefCard/PrBriefCard.tsx:185-224` (блок Review
  Focus) · `PrBriefCard/styles.ts:84-133` (`focus*`, `muted`) ·
  `PrBriefCard/PrBriefCard.tsx:153-162` (гола цифра оцінки) ·
  `client/src/lib/hooks/brief.ts`, `client/src/lib/hooks/reviews.ts` ·
  `pulls/_components/PRRow/PRRow.tsx:56` (`<CircularScore … size={34} stroke={3} />`
  — еталон вигляду).

## Ownership

План single-agent, одна смуга — один власник на всі шляхи:

| Lane | Owns |
|---|---|
| A | `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/**` · `.../_components/PrBriefCard/**` · `.../_components/ReviewFocusPanel/**` (новий) · `client/src/lib/hooks/brief.ts` · `client/messages/en/brief.json` · `e2e/specs/12-pr-why-risk-brief.flow.json` |

Не чіпати: `OverviewTab/_components/IntentCard/**`, `.../BlastTab/**`,
`client/src/vendor/ui/**`, `client/src/components/diff-viewer/**`, обидві копії
`vendor/shared/**`, `server/**`, `docs/**`, `INSIGHTS.md`,
`e2e/specs/02-repo-pulls-detail.flow.json`, статус спеки.

## Amendments in force

- Заголовок регіону 3 — **рішення людини 20/08/2026**, а не дефолт плану:
  повторює мокап, «Review focus — read these first» (рендериться uppercase, як
  решта `SectionLabel`), новим ключем у неймспейсі `brief`; наявний
  `brief.card.reviewFocus` лишається на місці, під лічильник — окремий ключ.
- Три follow-up open questions спеки закриті людиною
  (`[RESOLVED 20/08/2026 · human-answered]`): оцінка показується лише разом із
  завантаженим brief · донат `size={34} stroke={3}` · лічильник при нулі
  показує `0`.

## Known pre-existing failures

Ще не міряно на базі цієї гілки. Відоме з root `INSIGHTS.md` (2026-08-20): пʼять
tmpdir-тестів падають лише на macOS і не належать жодній гілці — вони в
серверній смузі, не у `frontend`. Перший червоний прогін `--slice frontend` на
тесті, якого ця робота не чіпала, перевіряється **один раз** воркtree на
`5d82522d6bd6ad2139fa11b067aa4a7fc2ddffe9`, і вердикт дописується сюди.
