---
name: deprecation-policy
description: Requires public API surface to be deprecated before it is deleted, and flags a field removed in the same change that marked it obsolete.
type: convention
---

# Deprecation Policy

Removing public surface is allowed. Removing it *without warning* is not.

A deprecation is how a breaking change gets scheduled instead of sprung: the old
field keeps working, the annotation tells consumers to move, and the deletion
lands a release later when they have. Deleting in one step skips the part that
made it safe — and deleting the `@deprecated` marker in the same commit that
deletes the field is the clearest possible tell that no cycle happened.

## The cycle

1. **Announce** — mark `@deprecated` with the replacement named and a removal
   version. The old surface keeps working, unchanged.
2. **Ship** at least one release in that state.
3. **Remove** in the next major (see `semver-discipline`).

## Report as CRITICAL

- A field and its own `@deprecated` annotation deleted in the same hunk. The
  annotation was the warning; it never reached a release as a warning. The two
  deletions on adjacent lines are the evidence — cite them together.
- Public surface deleted with no `@deprecated` marker anywhere in its history —
  step 1 never happened at all.

## Report as WARNING

- A `@deprecated` marker with no replacement named, or no removal version — a
  warning a consumer cannot act on is barely a warning.
- A replacement added but the old surface deleted immediately, rather than after
  a release running both.

## Not a problem

- Deleting something already `@deprecated` in a *previous* release, in a major.
- Deprecating without deleting — that is the policy working.

## Examples

**Bad — flag this (CRITICAL).** The annotation and the field it annotates go out
together, so no consumer ever saw the warning:

```diff
   id: string;
-  /** @deprecated use unit_price */
-  unitPrice: number;
+  unit_price: number;
 }
```

The replacement exists, which makes this feel finished — but the release that
was supposed to carry both, and give consumers a window to move, never shipped.

**Good — do not flag.** The announcement, shipped on its own:

```diff
   id: string;
+  /** @deprecated since 4.3.0, removed in 5.0.0 — use unit_price */
   unitPrice: number;
+  unit_price: number;
 }
```

Both fields work; consumers get a release to migrate; the deletion is scheduled.

## Stay in your lane

Only the announce-then-remove question: was this surface deprecated before it
was deleted? That a removal breaks callers is `breaking-change` (requests) or
`response-schema` (responses); which version may carry it is
`semver-discipline`. Report the missing announcement, not the break itself.

## Writing the finding

Name the removed surface, say whether it was ever deprecated and where you
looked, and give the two-step alternative concretely: keep the old field this
release with a `@deprecated` pointing at the new one, delete it in the next
major.
