# References

Sources behind the rules in `SKILL.md`, with what each one contributes.

## Project structure and feature organization

- [bulletproof-react](https://github.com/alan2207/bulletproof-react) —
  [`docs/project-structure.md`](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md),
  [`docs/project-standards.md`](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md).
  Feature-first layout, "most code lives in features", a deliberately thin shared
  layer, absolute imports through an alias. Source of the placement ladder's top
  rung and of the rule that shared code must earn its place.
- [React Folder Structure Best Practices — Robin Wieruch](https://www.robinwieruch.de/react-folder-structure/)
  — structure evolves with the codebase: start flat, add hierarchy when the code
  demands it. Source of "climb one rung at a time".
- [Delightful React File/Directory Structure — Josh W. Comeau](https://www.joshwcomeau.com/react/file-structure/)
  — component-as-folder anatomy, colocated auxiliary files, and the index file as
  a curated export rather than a dumping ground.
- [How to Structure and Organize a React Application — Tania Rascia](https://www.taniarascia.com/react-architecture-directory-structure/)
  — the helpers-vs-utils distinction and the case against one global helpers
  file that everyone appends to and nobody prunes.
- [Feature-Sliced Design](https://feature-sliced.design/)
  ([overview](https://feature-sliced.github.io/documentation/docs/get-started/overview))
  — layers, slices and segments, and the rule that slices on the same layer may
  not import each other. Source of "shared code must not know about features".
  The full seven-layer taxonomy was deliberately **not** adopted: heavier than
  this codebase needs.
- [How To Structure React Projects — Web Dev Simplified](https://blog.webdevsimplified.com/2022-07/react-folder-structure/)
  — beginner→advanced progression of structures; corroborates evolutionary growth
  over picking a big structure upfront.

## Colocation and state placement

- [Colocation — Kent C. Dodds](https://kentcdodds.com/blog/colocation)
  — "place code as close to where it's relevant as possible". The proximity rule
  the entire skill is built on.
- [State Colocation will make your React app faster — Kent C. Dodds](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster)
  — push state down to the component that needs it; lift only to the lowest
  common parent. Source of the "subtree with its own state" split signal.
- [Application State Management with React — Kent C. Dodds](https://kentcdodds.com/blog/application-state-management-with-react)
  — most state is not global; composition and colocation before any store.

## Next.js App Router organization

- [Project Structure — Next.js docs](https://nextjs.org/docs/app/getting-started/project-structure)
  — authoritative reference for private folders (`_folder`), route groups
  (`(folder)`), and which files become routes.
- [Routing: Project Organization and File Colocation — Next.js docs](https://nextjs.org/docs/13/app/building-your-application/routing/colocation)
  — the colocation-safety guarantee stated explicitly: only route-convention
  files become URLs, so anything else next to `page.tsx` is private by default.
- [Server and Client Components — Next.js docs](https://nextjs.org/learn/react-foundations/server-and-client-components)
  — the network boundary and the default-server model.
- [Best Practices for Organizing Your Next.js 15](https://dev.to/bajrayejoon/best-practices-for-organizing-your-nextjs-15-2025-53ji)
  — practical route-group and colocation layouts in a real App Router tree.

## Server/client boundary

- [5 Misconceptions about React Server Components — Builder.io](https://www.builder.io/blog/nextjs-react-server-components)
  — push the boundary down, client components as islands, the `children`
  inversion for nesting server content inside a client wrapper, and the
  serializable-props constraint. Source of the "boundary is about bundle
  membership, not performance" framing.

## Business logic separation

- [Separation of concerns with React hooks — Felix Gerschau](https://felixgerschau.com/react-hooks-separation-of-concerns/)
  — hooks as the seam between UI and behaviour, and why a hook that inlines the
  business rules is doing two jobs.
- [Decoupling Business Logic from UI with Custom React Hooks](https://www.emoosavi.com/blog/decoupling-business-logic-from-ui-with-custom-react-hooks)
  — the container/presentational split that falls out once logic moves into
  hooks.
- [Business vs application logic: how to separate and test your ReactJS code](https://antonyleme.medium.com/business-vs-application-logic-how-to-separate-and-test-your-reactjs-code-4291d0c983b1)
  — the distinction encoded in the skill's three-destination table: business
  logic (calculations, formatting, validation) as pure functions, application
  logic (state, effects, data access) in hooks.

## Duplication and abstraction

- [The Wrong Abstraction — Sandi Metz](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction)
  — the wrong abstraction costs more than the duplication it removed, and
  re-introducing duplication is a valid repair. Source of "reversing is
  legitimate".
- [AHA Programming — Kent C. Dodds](https://kentcdodds.com/blog/aha-programming)
  — prefer duplication over the wrong abstraction; abstract when the pattern is
  understood, not on first sight.
- [Rule of three — Wikipedia](https://en.wikipedia.org/wiki/Rule_of_three_(computer_programming))
  — the two-wait / three-look heuristic.

## Barrel files and imports

- [Tree shaking doesn't work with TypeScript barrel files — vercel/next.js#12557](https://github.com/vercel/next.js/issues/12557)
  — evidence that wildcard re-exports defeat tree-shaking and widen the module
  graph. Why a barrel is a public API declaration, not a convenience.
- [Stop using barrel files](https://jsdev.space/howto/stop-using-barrel-files/)
  — barrels as a source of import cycles and build slowdown; direct sibling
  imports as the fix.
- [The index.ts dilemma: convenience vs performance](https://krishnavadlamudi44.medium.com/the-index-ts-dilemma-balancing-convenience-and-performance-in-typescript-projects-85e9dd4fc18f)
  — the tradeoff that motivates curated barrels over app-wide ones.

## Repo-specific rules

The `In this repo (client/)` section of `SKILL.md` comes from the codebase, not
from the sources above:

- `client/AGENTS.md` — contracts from `@devdigest/shared`, API access via
  `src/lib/api.ts`, data hooks in `src/lib/hooks/*`, thin pages, next-intl
  strings, vendored UI kit.
- `client/src/app/repos/[repoId]/pulls/**` — route-private `_components/`,
  recursive nesting in `RunTraceDrawer/`, colocated tests, auxiliary files only
  when non-empty.
- `client/src/components/severity-counters/**` — shared kebab-case component
  folders, curated one-line barrel, `styles.ts` as `CSSProperties` objects,
  scoped helper naming (`popoverHelpers.ts`).

Keep that section in sync when these conventions change — a stale repo section is
worse than none, because it will be followed.
