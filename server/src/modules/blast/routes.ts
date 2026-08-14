import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * blast module (L04).
 *   GET  /pulls/:id/blast          → the impact map, straight from the index
 *   POST /pulls/:id/blast/summary  → one model call explaining that map
 *
 * The GET makes no LLM and no GitHub call — it is a pure read over repo-intel,
 * so it carries no rate limit and always answers 200 for a PR that exists,
 * with `status` (full / partial / degraded) saying how much of the index
 * backed the answer. The POST spends money, so it is limited exactly like
 * `POST /pulls/:id/intent` (`reviews/routes.ts:150-156`).
 *
 * No `response:` schema — no route in this codebase declares one; the service's
 * return type is the contract.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BlastService(container);

  app.get('/pulls/:id/blast', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getBlast(workspaceId, req.params.id);
  });

  app.post(
    '/pulls/:id/blast/summary',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getBlastSummary(workspaceId, req.params.id);
    },
  );
}
