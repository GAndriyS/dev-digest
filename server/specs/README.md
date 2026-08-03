# Specs — server

Specs for work that lives entirely in the API. Anything spanning the API and the
web app belongs in `../specs/`.

One file per feature: `add-<thing>.md` or `LNN-<feature>.md`. `AGENTS.md` links
this directory, not individual files.

## Template

```markdown
# <Feature>

## Goal
What the API should do that it does not do today, and why.

## Acceptance criteria
- [ ] Route, status codes, and response shape are observable statements.
- [ ] Which lane covers it: unit (hermetic) or `*.it.test.ts` (real Postgres).

## Out of scope
## Touched surfaces
Module(s), adapters, schema tables, migrations.
```

## Contents

_Empty for now._
