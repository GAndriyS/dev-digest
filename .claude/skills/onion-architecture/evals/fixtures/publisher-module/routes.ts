import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PublishRequest } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { PublisherService } from './service.js';

/**
 * L06 — publisher module.
 *
 *   GET  /pulls/:id/publications      → delivery history for this PR
 *   POST /pulls/:id/publications      → publish the latest review
 *   POST /publications/retry          → re-attempt everything marked retryable
 */
export default async function publisherRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new PublisherService(app.container);

  app.get('/pulls/:id/publications', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.history(workspaceId, req.params.id);
  });

  app.post(
    '/pulls/:id/publications',
    { schema: { params: IdParams, body: PublishRequest } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { target, channel } = req.body;
      return service.publish(workspaceId, req.params.id, target, channel);
    },
  );

  app.post('/publications/retry', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const sent = await service.retryFailed(workspaceId);
    return { sent };
  });
}
