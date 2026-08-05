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

- Public surface deleted with no `@deprecated` marker anywhere in its history —
  step 1 never happened.
- A field and its own `@deprecated` annotation deleted in the same hunk. The
  annotation was the warning; it never reached a release as a warning.

## Report as WARNING

- A `@deprecated` marker with no replacement named, or no removal version — a
  warning a consumer cannot act on is barely a warning.
- A replacement added but the old field deleted immediately, rather than after a
  release running both.

## Not a problem

- Deleting something already `@deprecated` in a *previous* release, in a major.
- Deprecating without deleting — that is the policy working.

## Examples

**Bad — flag this (CRITICAL).** The annotation and the field it annotates go out
together, so no consumer ever saw the warning:

```diff
   id: string;
-  /** @deprecated use callback_url */
-  callbackUrl: string;
-  isActive: boolean;
+  callback_url: string;
+  enabled: boolean;
 }
```

`isActive` is worse still — deleted with no marker at any point.

**Good — do not flag.** The announcement, shipped on its own:

```diff
   id: string;
+  /** @deprecated since 2.5.0, removed in 3.0.0 — use callback_url */
   callbackUrl: string;
+  callback_url: string;
 }
```

Both fields work; consumers get a release to migrate; the deletion is scheduled.

## Writing the finding

Name the removed surface, say whether it was ever deprecated, and give the
two-step alternative concretely: keep the old field this release with a
`@deprecated` pointing at the new one, delete it in the next major.
