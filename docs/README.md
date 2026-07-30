# Docs — DevDigest

Cross-cutting explanatory docs. Package-scoped docs live in `<package>/docs/`.

**What belongs here:** stable material that explains *why* — design rationale,
deep dives, how-to guides, decision records. Anything an agent should be able to
read on demand but should not carry in context every session.

**What does not:** rules and invariants (those go in `CLAUDE.md`, kept short),
architecture overviews that already exist in a `README.md`, and anything that
changes with the code on every commit.

## Contents

| Doc | What |
|-----|------|
| [`agent-prompts/`](agent-prompts/README.md) | System prompts for the built-in reviewer agents, plus model-selection guidance |
