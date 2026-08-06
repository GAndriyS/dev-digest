# onion-architecture — maintainer notes

For humans maintaining this skill. The agent reads `SKILL.md`; you read this.

## What it is

Two halves of one thing:

1. **`SKILL.md`** — the architecture the DevDigest backend already has, written
   down so the agent reproduces it instead of inventing a new layout per module.
2. **`server/.dependency-cruiser.cjs`** — the same rules as machine checks, run in
   the `typecheck` job of `.github/workflows/server-unit.yml`.

Prose alone decays. Checks alone are unreadable. Neither half is optional.

## Files

| File | Audience | Contents |
|---|---|---|
| `SKILL.md` | agent | Layer map, ports/adapters, composition root, edge validation, testing seams, module checklist, enforcement |
| `examples.md` | agent | Nine good/bad pairs taken from real code in this repo |
| `references.md` | agent + human | The articles behind each rule, with what each contributes |
| `README.md` | human | This file |
| `CHANGELOG.md` | human | Version history |

The rules themselves live **outside** this folder, in
`server/.dependency-cruiser.cjs`. That file is the single source of truth for
what CI rejects; `SKILL.md` explains it.

## Running the checks

```bash
cd server && pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs
```

Both trees are cruised from `server/` on purpose: `reviewer-core` is consumed as
TypeScript source through a tsconfig path alias, has no build of its own, and
uses npm — a second copy of the tool there would buy a second lockfile to
maintain for one config file.

The CI step is inlined rather than a package script, because `server/package.json`
is skip-worktree in some checkouts and the committed copy may not carry it. The
existing workflow already inlines commands for the same reason.

Two config details that are easy to break:

- `node_modules` is in `doNotFollow`, **not** `exclude`. Excluding it drops npm
  packages out of the graph, and every rule naming one (`fastify`, `drizzle-orm`,
  `octokit`) silently passes while looking green.
- `no-circular` uses `viaOnly: { dependencyTypesNot: ['type-only'] }`. Plain
  `dependencyTypesNot` does not filter cycle edges, and without it every service
  that names its `Container` type reports a false cycle.

After editing rules, verify they still bite: add a deliberate violation, confirm
the expected rule name appears, remove it.

## Changing the rules

A rule change is an architecture decision, so keep the three artefacts in sync in
**one** PR:

1. `server/.dependency-cruiser.cjs` — the check
2. `SKILL.md` — the explanation (and `examples.md` if the pattern is new)
3. `CHANGELOG.md` + `metadata.version` in the `SKILL.md` frontmatter

Version bumps (semver):

- **major** — a rule got stricter or a new forbidden direction was added; existing
  code or habits may now fail CI
- **minor** — a new section, example, or reference; nothing newly fails
- **patch** — wording, typos, link fixes

Also update the version shown in the catalog row in `.claude/skills/README.md`.

## Grandfathered debt

`pathNot` entries marked `GRANDFATHERED` in the config are debt, not policy —
the ratchet that let us adopt the rules on a codebase that already had
violations. **Shrink the lists; never append.** Adding a new exception means
either the rule is wrong (fix the rule and say why) or the code is (fix the code).

Currently grandfathered:

- `modules/{polling,pulls,settings,workspace}` — no service layer, routes query
  Drizzle directly
- `adapters/{astgrep,depgraph}` — import constants out of `modules/repo-intel`
