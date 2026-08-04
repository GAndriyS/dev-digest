import { z } from 'zod';

/**
 * Shared route param schemas. Most `/:id` routes address a DB row whose primary
 * key is a uuid (see db/schema/*), so validate that shape at the edge — an
 * invalid id becomes a clean 422 instead of a downstream DB/500.
 *
 * NOTE: not every `:id` is a uuid (e.g. `/providers/:id` where id is a provider
 * name like "openai"); those routes use their own schema.
 */
export const IdParams = z.object({ id: z.string().uuid() });
export type IdParams = z.infer<typeof IdParams>;

/**
 * Shared RESPONSE schemas. Declaring `schema.response[200]` is not decoration:
 * the serializer validates what leaves the process, so a handler that starts
 * returning a raw Drizzle row (with `workspaceId`, internal timestamps, …)
 * fails loudly instead of silently widening the public API. It also makes the
 * route self-documenting — the contract is readable without opening the service.
 *
 * Response schemas live next to the routes; the DTO shapes themselves come from
 * `@devdigest/shared`, which stays the single source of truth.
 */

/** `{ ok: boolean }` — actions whose only result is success/failure. */
export const OkResponse = z.object({ ok: z.boolean() });
export type OkResponse = z.infer<typeof OkResponse>;
