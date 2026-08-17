# Specs — server

Feature specs for work that lives entirely in the API. Anything spanning the
API and the web app belongs in [`../../specs/`](../../specs/README.md).

Same template, naming (`SPEC-NN-<topic-slug>.md`, global ids), status
lifecycle and lint as the root — read [`../../specs/README.md`](../../specs/README.md);
this file does not repeat it. Two server-specific expectations:

- Every AC states the route, status code and response shape as observable
  facts — the wire contract *is* the spec here, and it lives as a Zod schema in
  `src/vendor/shared` mirrored into `client/src/vendor/shared`.
- **Non-functional requirements** say which lane proves it: unit (hermetic) or
  `*.it.test.ts` (real Postgres).

Each spec here still gets a Backlog row in the root README, linked as
`../server/specs/SPEC-NN-<slug>.md`. `AGENTS.md` links this directory, not
individual files.

## Contents

_Empty for now._
