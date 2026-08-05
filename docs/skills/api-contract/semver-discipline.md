---
name: semver-discipline
description: Requires the version bump in the diff to match the severity of the contract change — a breaking change under a minor or patch bump is itself a defect.
type: convention
---

# Semver Discipline

A version number is a promise about upgrade safety. When the diff breaks a
contract but bumps only the minor or patch digit, every consumer with a caret
range pulls the break in automatically, on a routine install, with no one having
decided to.

The wrong version is not a paperwork error. It converts a controlled break into
an uncontrolled one, so report it with the severity of the break it hides.

## The rule

Find the version change in the diff (`package.json`, a manifest, an
`openapi.yaml`, a `/v{n}/` path segment) and compare it against the largest
contract change in the same PR:

| Change in the diff | Required bump |
|---|---|
| Any breaking change (see `breaking-change`, `response-schema`) | **major** |
| New optional field, new route, new enum member | minor |
| Fix with no contract change | patch |

## Report as CRITICAL

- A breaking change shipped under a minor or patch bump.
- A breaking change with **no** version change at all in the diff.

## Report as WARNING

- A new feature under a patch bump.
- A version bumped past what the change warrants (a major for an additive
  change) — harmless to consumers, but it burns the signal.

## Examples

**Bad — flag this (CRITICAL).** The same PR removes a field consumers read, and
versions it like a feature:

```diff
 {
   "name": "@example/catalog-api",
-  "version": "4.2.7",
+  "version": "4.3.0",
   "private": false,
```

`4.3.0` is a minor bump, so anyone on `^4.2.7` upgrades into the removal on
their next install without reading a changelog. This needs `5.0.0`.

**Good — do not flag.** The same break, correctly announced:

```diff
-  "version": "4.2.7",
+  "version": "5.0.0",
```

**Also good.** An additive-only PR under a minor bump — that is exactly right.

## Stay in your lane

Only the version number. Do not re-report the underlying break; find it, name it
in one clause as the thing that forces the major, and let `breaking-change`,
`response-schema` or `deprecation-policy` own the finding about the change
itself. One version line, one finding.

## Writing the finding

Say which change forces the major bump, quote the version line as it stands, and
give the version it should be. If there is no version change in the diff at all,
say so plainly — an absent bump is easy to miss precisely because there is no
line to look at.
