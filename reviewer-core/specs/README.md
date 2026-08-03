# Specs — reviewer-core

Specs for engine work. Anything that also needs a route, a table, or a screen
belongs in `../specs/`.

One file per change: `add-<slot>.md` or `LNN-<feature>.md`. `AGENTS.md` links
this directory, not individual files.

## Template

```markdown
# <Change>

## Goal
What the engine should produce that it does not today.

## Acceptance criteria
- [ ] Verifiable with a stubbed `LLMProvider` — no keys, no network.
- [ ] Grounding behaviour stated explicitly: what survives, what is dropped.
- [ ] Empty-input behaviour: the section is omitted, not rendered empty.

## Out of scope
Anything requiring I/O — that belongs to the caller.

## Touched surfaces
Prompt slots, contracts in `@devdigest/shared`, exports from `src/index.ts`.
```

## Contents

_Empty for now._
