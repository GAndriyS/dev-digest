import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ConventionPatch } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ConventionsService } from './service.js';

/**
 * L03 — conventions module (the Conventions Extractor).
 *
 *   GET  /repos/:id/conventions          → stored candidates for a repo
 *   POST /repos/:id/conventions/extract  → scan the clone, replace pending rows
 *   PUT  /conventions/:id                → accept / reject / reword one rule
 *
 * The `/repos/:id/...` prefix is owned by whichever module implements the
 * feature, not by the repos module — repo-intel already registers
 * `/repos/:id/resync` the same way.
 *
 * The edge only validates and delegates. `extract` answers 409 for the three
 * states the UI must render rather than treat as a fault: no provider key, repo
 * not cloned yet, nothing readable to sample.
 */
export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.post('/repos/:id/conventions/extract', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.extract(workspaceId, req.params.id);
  });

  app.put(
    '/conventions/:id',
    { schema: { params: IdParams, body: ConventionPatch } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { rule, status } = req.body;
      return service.patch(workspaceId, req.params.id, {
        ...(rule !== undefined ? { rule } : {}),
        ...(status !== undefined ? { status } : {}),
      });
    },
  );
}
