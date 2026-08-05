---
name: response-schema
description: Catches changes to the shape of a response — renamed, retyped, removed or newly-nullable fields, and changed status codes — which break consumers silently.
type: convention
---

# Response Schema Gate

The response is a contract too, and it is the half people forget. A request
break fails loudly at the caller's edge; a response break often fails *quietly*
— the consumer reads `undefined`, renders a blank, and nobody notices until a
customer does.

Treat the response shape as published the moment it ships.

## Report as CRITICAL

- A response field **removed** or **renamed**. A case change counts:
  `callbackUrl` → `callback_url` is a rename, not formatting.
- A field's type changed (`string` → `number`, scalar → object, object → array).
- A field that was always present becoming optional or nullable — every consumer
  that dereferences it without a guard now has a latent crash.
- A **status code** changed for the same outcome. `200` → `204` is breaking:
  the body disappears, and clients that parse it get an empty-body error.
- An enum member removed, or an existing member's value changed.

## Report as WARNING

- A new enum member added to a field consumers switch on exhaustively.
- A field's meaning changed while its name and type stayed the same — the most
  dangerous kind, because no type checker anywhere will catch it.

## Not breaking

- A new field added alongside the existing ones.
- Ordering changes in a JSON object.

## Examples

**Bad — flag this (CRITICAL).** Two renames and a status change in one hunk:

```diff
     const hook = await createWebhook(req.body);
-    reply.status(200);
-    return { id: hook.id, callbackUrl: hook.url, isActive: hook.active };
+    reply.status(204);
+    return { id: hook.id, callback_url: hook.url, enabled: hook.active };
```

Every consumer reading `callbackUrl` or `isActive` now reads `undefined` — and
with `204` there is no body to read at all, so even the correctly-renamed
`callback_url` never arrives. Report the renames and the status change
separately; they break different things and have different fixes.

**Good — do not flag.** Additive, and the old fields still mean what they meant:

```diff
-    return { id: hook.id, callbackUrl: hook.url };
+    return { id: hook.id, callbackUrl: hook.url, createdAt: hook.createdAt };
```

## Writing the finding

State the old field name and the new one, and say what a consumer sees when it
reads the old one (`undefined`, not an error). For a status change, say what
happens to the body. Cite the added line.
