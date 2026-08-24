# Specs — reviewer-core

Feature specs for engine work. Anything that also needs a route, a table, or a
screen belongs in [`../../specs/`](../../specs/README.md).

Same template, naming (`SPEC-NN-<topic-slug>.md`, global ids), status
lifecycle and lint as the root — read [`../../specs/README.md`](../../specs/README.md);
this file does not repeat it. Three engine-specific expectations:

- Every AC is verifiable with a stubbed `LLMProvider` — no keys, no network.
- Grounding behaviour is stated explicitly: what survives, what is dropped.
- **Edge cases** state the empty-input behaviour — the section is omitted, not
  rendered empty. Anything requiring I/O is a **Non-goal**; it belongs to the
  caller.

Each spec here still gets a Backlog row in the root README, linked as
`../reviewer-core/specs/SPEC-NN-<slug>.md`. `AGENTS.md` links this directory,
not individual files.

## Contents

_Empty for now._
