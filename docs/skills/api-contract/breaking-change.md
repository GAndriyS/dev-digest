---
name: breaking-change
description: Flags any non-additive change to a published API contract as CRITICAL, reconstructing the old shape from removed lines and the new one from added lines.
type: convention
---

# Breaking Change Gate

A change to an EXISTING contract that is not purely additive is **BREAKING**.
Report it as CRITICAL.

The callers you cannot see — another service, a shipped mobile build, a
customer's script — are not updated by this pull request. They break later, in
production, on someone else's shift. That delay is the whole reason this needs
catching at review time.

## How to read the diff

Reconstruct the OLD contract from the removed (`-`) lines and the NEW one from
the added (`+`) lines, then compare them field by field. Judge the contract, not
the intent: a commit titled "cleanup" that renames a response field is a
breaking change, and the PR description is not evidence to the contrary.

## Report as CRITICAL

- A route path renamed, moved, or deleted; a segment added or removed.
- The HTTP method changed for a path, or a method removed.
- A path or query parameter renamed, retyped, or made required.
- A request field added as **required**, or an existing optional field made
  required.
- A request field renamed, retyped, or removed.
- Validation tightened so values the endpoint used to accept are now rejected —
  a new `min`, `max`, `enum`, `uuid`, or format constraint.
- A default value changed, so an unchanged call now behaves differently.

## Not breaking

- A new **optional** request field.
- A new response field added alongside the existing ones.
- A new route, or a new method on an existing path.
- Internal refactoring behind an unchanged signature.

## Examples

**Bad — flag this (CRITICAL).** An optional field becomes required, so every
existing caller that omitted it now gets a 422:

```diff
       body: z.object({
         url: z.string().url(),
-        secret: z.string().optional(),
+        secret: z.string(),
+        events: z.array(z.string()).min(1),
       }),
```

Two breaks here, not one: `secret` became required, and `events` was added as a
required field. Report both, cite the added lines.

**Good — do not flag.** Purely additive; every existing call still compiles and
still means what it meant:

```diff
       body: z.object({
         url: z.string().url(),
         secret: z.string().optional(),
+        description: z.string().optional(),
       }),
```

## Writing the finding

Name the old shape and the new one explicitly ("`secret` was optional, is now
required"), say who breaks (existing callers that omit it) and what they will
see (a 422). Cite the exact `file:line` of the added line that does it.
