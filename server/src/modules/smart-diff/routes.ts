import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SmartDiffService } from './service.js';

/**
 * smart-diff module (L03).
 *   GET /pulls/:id/smart-diff → deterministic file-risk ordering (SmartDiff)
 *
 * No body, no `response:` schema (no route in this codebase declares one —
 * `modules/_shared/schemas.ts:14-27`'s `OkResponse` is unused elsewhere too)
 * and no per-route rate limit — this endpoint makes no LLM/GitHub call.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new SmartDiffService(container);

  app.get('/pulls/:id/smart-diff', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getSmartDiff(workspaceId, req.params.id);
  });
}
