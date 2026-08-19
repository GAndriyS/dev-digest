# SDD runs

Two files per `/implement` run, both written by the main session, committed with the branch and read by `--from` to resume in a later chat:

- `<slug>.md` — spec, plan, stage table with agent token counts, and the latest report of each stage.
- `<slug>-brief.md` — the handoff brief: binding rules with locators, the ownership table, the amendments in force, and the known pre-existing test failures. Every delegation names it as the agent's Step 1, so the same context is derived once instead of once per agent.

Both shapes are in `.claude/skills/implement/SKILL.md`.
