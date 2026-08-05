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

- A response field **removed** or **renamed**. Re-spelling a key is a rename,
  not formatting: changing `unitPrice` to `unit_price` deletes `unitPrice` as
  far as every consumer is concerned.
- A field's type changed (`string` → `number`, scalar → object, object → array),
  or a list wrapped or unwrapped (`[...]` ↔ `{ items: [...] }`).
- A field that was always present becoming optional or nullable — every consumer
  that dereferences it without a guard now has a latent crash.
- A **status code** changed for the same outcome. Any change counts: clients
  assert on the number, and a code with no body leaves nothing to parse.
- An enum member removed from a response, or an existing member's value changed.

## Report as WARNING

- A new enum member added to a field consumers switch on exhaustively.
- A field's meaning or units changed while its name and type stayed the same —
  seconds to milliseconds, cents to dollars. The most dangerous kind, because no
  type checker anywhere will catch it.

## Not breaking

- A new field added alongside the existing ones.
- Ordering changes in a JSON object.

## Examples

**Bad — flag this (CRITICAL).** A rename and a status change in one hunk:

```diff
     const order = await placeOrder(req.body);
-    reply.status(201);
-    return { id: order.id, unitPrice: order.price, placedAt: order.created };
+    reply.status(202);
+    return { id: order.id, unit_price: order.price, placedAt: order.created };
```

Every consumer reading `unitPrice` now reads `undefined` — silently, since the
key is simply absent rather than an error. Separately, a client that branches on
`201` no longer takes that branch. Report the rename and the status change
separately; they break different things and have different fixes.

**Good — do not flag.** Additive, and the old fields still mean what they meant:

```diff
-    return { id: order.id, unitPrice: order.price };
+    return { id: order.id, unitPrice: order.price, currency: order.currency };
```

## Stay in your lane

The response shape and the status code only. Request fields, query parameters
and route paths belong to `breaking-change`; whether a removed field was ever
announced belongs to `deprecation-policy`; the version number belongs to
`semver-discipline`.

## Writing the finding

State the old field name and the new one, and say what a consumer sees when it
reads the old one (`undefined`, not an error). For a status change, say which
client branch stops firing and what happens to the body. Cite the added line.
