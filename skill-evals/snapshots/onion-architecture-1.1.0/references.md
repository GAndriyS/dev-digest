# References

Sources behind the rules in `SKILL.md`, with what each one contributes.

## Onion Architecture — the canon

- [The Onion Architecture: part 1 — Jeffrey Palermo (2008)](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/)
  — the original four-part series that coined the term. Source of the dependency
  rule ("all coupling is toward the centre") and of the caveat we accept
  deliberately: onion is for long-lived applications with real behaviour, not for
  small websites.
- [Onion Architecture — Herberto Graça](https://herbertograca.com/2017/09/21/onion-architecture/)
  — places onion between hexagonal and clean architecture. Useful when someone
  asks why we say "onion" and not "clean".
- [Hexagonal Architecture: simple introduction + real-world example](https://dev.to/xavier_carreragimbert/hexagonal-architecture-simple-introduction-real-world-example-49n1)
  — ports and adapters, and the litmus test we use for the repository layer:
  swapping the ORM must not touch business logic.
- [Sliced Onion Architecture — Oliver Drotbohm](http://odrotbohm.github.io/2023/07/sliced-onion-architecture/)
  — layering *within* a vertical module rather than across the app. This is what
  `modules/<name>/{routes,service,repository}.ts` actually is.

## Node.js / TypeScript implementations

- [Onion Architecture in Node.js with TypeScript — Sankhadip Samanta](https://sankhadip.medium.com/onion-architecture-in-node-js-with-typescript-5508612a4391)
  — end-to-end walkthrough of the layer split in a TS backend.
- [Implementing SOLID and the onion architecture in Node.js with TypeScript and InversifyJS](https://dormoshe.io/daily-news/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad-315)
  — the SOLID reading of onion (DIP is the whole game).
- [Melzar/onion-architecture-boilerplate](https://github.com/Melzar/onion-architecture-boilerplate)
  — reference UI / CORE / INFRASTRUCTURE folder structure to compare ours against.

## Tools in our stack

- [fastify/fastify-awilix](https://github.com/fastify/fastify-awilix)
  — the mainstream DI answer for Fastify. Read it to understand what our
  hand-written `platform/container.ts` gives up (auto-wiring, scoped lifetimes)
  and what it keeps (no decorators, no magic strings, plain `??=` getters, and
  overrides that are just a constructor argument). We are not adopting it.
- [Awilix](https://www.npmjs.com/package/awilix)
  — the container library itself; the "resolve by interface, not by constructor
  call" framing matches our container getters.
- [Repository Pattern with Drizzle ORM](https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae)
  — a repository as a thin wrapper over the Drizzle client, locked to one entity.
  That is exactly `modules/repos/repository.ts`.
- [Drizzle ORM docs](https://orm.drizzle.team/)
  — the query layer our repositories wrap.
- [How to use Zod in a clean architecture setup (colinhacks/zod #813)](https://github.com/colinhacks/zod/issues/813)
  — the long argument about whether validation libraries may appear in inner
  layers. Our answer: Zod lives on the route and in `vendor/shared` contracts.
- [Domain Model with Zod — Dimitrios Lytras](https://dnlytras.com/snippets/domain-zod)
  — branded domain types via Zod, if we ever want ids that cannot be swapped.
- [Parse, don't validate — Alexis King](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)
  — the principle behind "declare the schema on the route": parse once at the
  boundary and let the type carry the guarantee inward.

## Enforcing the boundaries

- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)
  — the rule engine behind `server/.dependency-cruiser.cjs`. Already a runtime
  dependency here (the `depgraph` adapter uses it), so enforcement cost us no new
  package.
- [Dependency Cruiser: Restrict Imports in JavaScript — Atomic Object](https://spin.atomicobject.com/dependency-cruiser-imports/)
  — practical tour of `forbidden` rules and `from`/`to` matching.
- [How we enforce architecture boundaries at scale — lastminute.com](https://technology.lastminute.com/how-we-enforce-architecture-boundaries-at-scale-on-our-app/)
  — the argument for failing the PR: rules that only live in prose decay.
- [Taking frontend architecture serious with dependency-cruiser — Xebia](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/)
  — where the grandfathering-with-`pathNot` ratchet comes from: adopt on a dirty
  codebase, shrink the exception list over time.
