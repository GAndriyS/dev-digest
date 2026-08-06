# Waivers

A gate with no way to disagree with it gets deleted the first time it is wrong
at an inconvenient hour. This is the escape valve — deliberately narrow, and
deliberately visible.

## The rule

**A waiver needs a reason. A waiver without a reason does not count**, and is
itself reported as a finding. The reason is the entire point: it turns "I
silenced this" into "I considered this and here is why it is fine", and it puts
that sentence in front of the reviewer.

Every applied waiver appears in the run report **and** in the drafted PR body.
Waivers are never silent.

## Inline waiver

For a one-off, within two lines of the finding:

```ts
// pr-gate-ignore: no-cross-route-internals — one-shot migration script, deleted next week
import { legacyRow } from "@/app/repos/[repoId]/pulls/helpers";
```

Format: `pr-gate-ignore: <rule> — <reason>`. The rule name is whatever the
finding reported. Reasons like "false positive", "not applicable" or "fine" do
not count — say what makes it fine.

## Standing waiver

For something cross-cutting that will not be fixed this week, add a row here.
Standing waivers cost more than inline ones on purpose: they outlive the person
who added them, so they carry a date and get reviewed.

| Rule | Path glob | Reason | Added |
|---|---|---|---|
| _(none yet)_ | | | |

## Three strikes

A rule waived three or more times across runs is flagged in the report.

That is not a nag — it is a signal that the rule is probably wrong. At that
point the fix is one of two things, never a fourth waiver:

- **The rule is wrong** → change it in the skill that owns it, bump that skill's
  `metadata.version`, note it in its CHANGELOG.
- **The code is wrong** → fix the code and drop the waivers.

Same principle as `WILDCARD_BARREL_DEBT` in
`client/scripts/check-ui-conventions.mjs` and the `GRANDFATHERED` lists in the
dependency-cruiser configs: an exception list is a ratchet that shrinks, not a
place to put things.

## Waiver vs baseline

Two different tools, easy to confuse:

- **Baseline** (`scripts/pr-gate-baseline.json`) — findings that already existed
  when the gate was adopted. Not your doing, not this PR's problem. Machine-
  managed and shrink-only; `scripts/pr-gate-ci.mjs` fails the build if it grows.
- **Waiver** (this file) — a finding in *your* change that you have judged
  acceptable. Human-written, needs a reason.

If you are reaching for a baseline entry to silence something your branch
introduced, you want a waiver, and you should expect to justify it.
