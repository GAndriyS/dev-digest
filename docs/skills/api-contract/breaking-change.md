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
the intent: a commit titled "cleanup" that tightens a request field is a
breaking change, and the PR description is not evidence to the contrary.

## Report as CRITICAL

- A route path renamed, moved, or deleted; a segment added or removed.
- The HTTP method changed for a path, or a method removed.
- A path or query parameter renamed, retyped, or made required.
- A request field added as **required**, or an existing optional field made
  required.
- A request field renamed, retyped, or removed.
- Validation tightened so values the endpoint used to accept are now rejected —
  a new `min`, `max`, `uuid`, or format constraint, or an enum member dropped.
- A default value changed, so an unchanged call now behaves differently.

## Not breaking

- A new **optional** request field.
- A new route, or a new method on an existing path.
- Validation loosened so previously rejected input is now accepted.
- Internal refactoring behind an unchanged signature.

## Examples

**Bad — flag this (CRITICAL).** Written as a tidy-up of a listing endpoint, but
it rejects calls that used to work:

```diff
       query: z.object({
         region: z.string(),
-        cursor: z.string().optional(),
-        sort: z.enum(['created', 'name', 'legacy_rank']).optional(),
+        cursor: z.string(),
+        sort: z.enum(['created', 'name']).optional(),
       }),
```

Two breaks, not one. `cursor` became required, so every first-page call now
422s; and `legacy_rank` left the enum, so callers still sending it are rejected
on a value the endpoint accepted yesterday. Report both, cite the added lines.

**Good — do not flag.** Purely additive; every existing call still compiles and
still means what it meant:

```diff
       query: z.object({
         region: z.string(),
         cursor: z.string().optional(),
+        include_archived: z.boolean().optional(),
       }),
```

## Stay in your lane

Request and route surface only. The response shape belongs to
`response-schema`, whether a removal was announced belongs to
`deprecation-policy`, and the version number belongs to `semver-discipline`.
Report each break once, under the skill that owns it.

## Writing the finding

Name the old shape and the new one explicitly ("`cursor` was optional, is now
required"), say who breaks (existing callers that omit it) and what they will
see (a 422). Cite the exact `file:line` of the added line that does it.
