# client — `@devdigest/web`

Next.js 15 App Router studio; data flows through TanStack Query hooks over the
Fastify API. pnpm.

## Before answering

Read `client/INSIGHTS.md` before starting work; search `client/docs/` and
`client/specs/` as needed.

## Conventions (not obvious from code)

- Types/contracts come from `@devdigest/shared` (Zod) — never hand-duplicate
  them. `src/vendor/shared` is a **trimmed copy** of the server's canonical set,
  not a symlink: a server-side change does not appear here by itself.
- All API access goes through `src/lib/api.ts` — the one place that knows
  `NEXT_PUBLIC_API_BASE`; data hooks live in `src/lib/hooks/*`. Tests mock
  `fetch` globally, so a component calling `fetch` directly silently bypasses
  the mock.
- Pages are thin. Feature logic lives in a colocated `_components/<Name>/` with
  `Name.tsx`, `constants.ts`, `styles.ts`, `index.ts`, `Name.test.tsx`.
- Import UI primitives from `@devdigest/ui`, everything else through the `@/*`
  alias.
- UI strings go in `messages/<locale>/*.json` (next-intl). No hardcoded copy.
- `src/vendor/ui` is vendored — fix upstream, not in place.
- Placement rules are machine-enforced: `pnpm arch` (import cycles, sideways
  imports between `src/app/<route>/` trees, `src/components`|`src/lib` importing
  `src/app`, reaching past a component's `index.ts`, `export *` in a barrel,
  `fetch()` outside `lib/api.ts`). CI runs it; run it before pushing.

## Use when

- Where a file belongs, splitting a component, extracting helpers, removing
  duplication → run `/frontend-ui-architecture`
- Page/route map, commands → read `client/README.md`
- UI kit internals → read `client/src/vendor/ui/README.md`
- Deep dives → read `client/docs/` · UI/flow specs → read `client/specs/` ·
  findings → read `client/INSIGHTS.md`
