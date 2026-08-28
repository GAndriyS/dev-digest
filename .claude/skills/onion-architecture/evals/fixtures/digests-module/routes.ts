import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { DigestBuild } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { DigestsService } from './service.js';

/**
 * L06 — digests module.
 *
 *   GET  /repos/:id/digests          → digests already built for this repo
 *   POST /repos/:id/digests          → build one for the requested window
 *   POST /digests/:id/delivered      → mark a digest as sent to its channel
 */
export default async function digestsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new DigestsService(app.container);

  app.get('/repos/:id/digests', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listForRepo(workspaceId, req.params.id);
  });

  app.post('/repos/:id/digests', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const parsed = DigestBuild.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_window', details: parsed.error.flatten() });
    }

    try {
      return await service.build(workspaceId, req.params.id, parsed.data.window);
    } catch (err) {
      if (err instanceof Error && err.message === 'Nothing merged in this window') {
        return reply.code(404).send({ error: 'empty_window', message: err.message });
      }
      throw err;
    }
  });

  app.post('/digests/:id/delivered', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.recordDelivery(req, workspaceId, req.params.id);
    return { ok: true };
  });
}
