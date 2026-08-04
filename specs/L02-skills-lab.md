# L02 — Skills Lab

## Goal

A reviewer agent is currently a model plus one system prompt, so every rule the
team cares about has to be re-typed into every agent that needs it, and changing
a rule means editing each copy. L02 makes the rule the unit: a **skill** is a
named, versioned block of prompt text that is authored once, linked to any
number of agents, and rendered into their review prompt in an order the user
controls. The schema and contracts already carry it (`skills`, `agent_skills`,
`Skill`, `AgentSkillLink`, `SkillStats`); nothing in the product surfaces it. The
lesson adds the two screens that do — a Skills Lab to author and inspect skills,
and a Skills tab on the agent editor to attach and order them — so that
"tighten the secret-leak rule" is one edit that every agent using it picks up on
its next run.

## Acceptance criteria

- [ ] `/skills` lists every skill in the workspace with its type and source, and
      is reachable from the sidebar. Sources are shown because provenance is the
      only thing that distinguishes a rule the team wrote from one imported
      wholesale, and that difference decides how much a reviewer should trust it.
- [ ] Opening a skill shows its body rendered in a **Preview** pane. The body is
      prompt text, not UI copy — seeing it as the model will is the only way to
      tell whether a rule is actually instructing anything.
- [ ] Editing a skill's `body` mints a new version; editing only its metadata
      does not. A rename must not invalidate an eval run that scored the text.
- [ ] The agent editor has a **Skills** tab, its state carried in `?tab=skills`
      so a linked-skill set is a shareable URL like every other editor tab.
- [ ] The tab lists every skill in the workspace with an attach toggle and shows
      `<n> of <total> enabled`. The denominator matters: "2 attached" is
      ambiguous about whether more exist to attach.
- [ ] Attached skills render in prompt order, numbered, and can be reordered by
      dragging **and** by ArrowUp/ArrowDown buttons. Order is a real feature —
      it is the sequence the blocks appear in inside the assembled prompt — so
      it needs an affordance that works for the keyboard and for touch, not only
      for a mouse.
- [ ] Attaching a skill appends it last. Attaching must never silently reshuffle
      an order the user already arranged.
- [ ] A reorder or an attach persists the **whole set** (`POST
      /agents/:id/skills` with `{skill_ids}`), and the list updates before the
      response arrives. A drag that visibly lags is a drag the user repeats.
- [ ] A failed write rolls the list back to the server's order rather than
      leaving the optimistic one on screen: the displayed order must never
      disagree with the order that will actually be sent to the model.
- [ ] A filter narrows both sections without renumbering anything — positions
      stay relative to the full linked set, because the number is the prompt
      position, not a row index.
- [ ] A skill's stats page reports usage at **run** level and says so. The engine
      renders all linked skills into one `## Skills / rules` block, so a finding
      cannot honestly be attributed to one skill; `findings_30d` is a correlation
      and must be labelled as one.
- [ ] The sidebar carries a `SKILLS LAB` group holding Skills and Agents, with
      `g s` reaching Skills — the two screens are one workflow and the nav should
      say so.

## Out of scope

- **URL and community import flows.** `SkillSource` already has
  `imported_url` and `community` members and the seed exercises them, but the
  only writer in L02 is manual authoring. Importing means fetching and trusting
  remote prompt text, which is a security conversation, not a UI one.
- **A `vetted` column.** Marking a skill as reviewed-and-approved implies a
  review workflow (who vets, against what, what happens to agents using an
  unvetted skill) that does not exist yet. `source` carries the honest amount of
  provenance for now.
- **AgentManifest slug / CI export.** Exporting an agent plus its skills as a
  portable manifest belongs with the export work, not here.
- **Per-finding skill attribution.** Only run-level attribution is honest (see
  the criterion above). Attributing a finding to a skill would require asking
  the model to cite the skill it applied, which it is not asked to do.
- **Eval dashboards** — L06 owns whether a skill actually improves review
  quality. L02 makes skills exist; it does not measure them.
- **Performance dashboards** — L08 owns per-agent and per-skill performance
  aggregates.

## Touched surfaces

- **contracts** — `@devdigest/shared` `knowledge.ts` already declares `Skill`,
  `SkillInput`/`SkillPatch`, `SkillVersion`, `SkillUsage`, `SkillStats`,
  `AgentSkillLink`. Any change lands in the server copy first and is mirrored
  into the client's trimmed copy.
- **server** — the `skills` module (list/CRUD, version history, stats) and the
  agent↔skill link endpoints on the agents module (`GET /agents/:id/skills`,
  `POST /agents/:id/skills` — set-and-reorder by `{skill_ids}`, or link one).
  Seed data: three built-in skills, one per provenance, linked to two agents.
- **client** — a `/skills` route tree (list, detail, Preview); a shared
  `src/components/agent-skill-picker/` promoted out of both route trees because
  a route may not import another route's internals; a `SkillsTab` mount on the
  agent editor; `src/lib/hooks/skills.ts`; `messages/en/{skills,agents}.json`.
- **nav** — `src/vendor/ui/nav.ts` gains the `SKILLS LAB` group. This is a
  vendored file: the edit is data-only and is declared to the reviewer with a
  `Vendor-update:` line in the PR body, which `scripts/pr-gate-ci.mjs` requires
  before it will let a vendored path through.
- **e2e** — `specs/08-skills.flow.json` over the seeded skills, read-only.
