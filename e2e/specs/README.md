# Specs — e2e

⚠️ Unlike the other packages, `specs/` here does **not** hold feature specs — it
holds the browser flows themselves, as `NN-name.flow.json`. Feature specs for
e2e work belong in `../../specs/`.

Each file is a list of agent-browser commands run in order against one shared
session by `run.ts`. `wait --url` / `wait --text` are the assertions.

The flow-by-flow coverage table lives in [`../README.md`](../README.md) — one
place, kept next to the run instructions.

## Adding a flow

1. Number it after the last one; update the coverage table in `../README.md`.
2. Deterministic locators only — never the AI `chat` command.
3. Target seeded, read-only data so the flow never triggers a model call.
4. Verify with `./scripts/e2e.sh`, not against your dev database.
