# Specs — client

Feature specs for work that lives entirely in the web app. Anything spanning
the web app and the API belongs in [`../../specs/`](../../specs/README.md).

Same template, naming (`SPEC-NN-<topic-slug>.md`, global ids), status
lifecycle and lint as the root — read [`../../specs/README.md`](../../specs/README.md);
this file does not repeat it. Two client-specific expectations:

- Every AC is observable from the rendered UI — the state a test would assert.
- **Edge cases** cover loading, empty, error and populated for every screen the
  spec touches, plus a narrow viewport.

Each spec here still gets a Backlog row in the root README, linked as
`../client/specs/SPEC-NN-<slug>.md`. `AGENTS.md` links this directory, not
individual files.

## Contents

_Empty for now._
