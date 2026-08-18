import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ContextPaths } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ContextService } from './service.js';

/**
 * L05 — Project Context module (SPEC-01).
 *
 *   GET  /repos/:id/context           → ContextListing (bounded directory scan)
 *   GET  /repos/:id/context/doc?path= → SpecFile (single-document preview)
 *   GET  /agents/:id/context          → ContextPaths (attached, in prompt order)
 *   POST /agents/:id/context {paths}  → ContextPaths (replace the whole set)
 *   GET  /skills/:id/context          → ContextPaths (attached, in prompt order)
 *   POST /skills/:id/context {paths}  → ContextPaths (replace the whole set)
 *
 * Agent/skill routes live HERE, not in `modules/agents`/`modules/skills` —
 * the alternative would have those modules import `modules/context/service.ts`,
 * which `no-cross-module-internals` forbids. Tenancy is still checked through
 * `container.agentsRepo` / `container.skillsRepo`, the same facade
 * `run-executor.ts` uses for the same reason.
 */

/**
 * A single doc's wire shape, reused from `ContextPaths.paths`'s element rather
 * than re-derived: the contract copy is frozen after wave 1 step 1, and the
 * validation (repo-relative POSIX, no `..`, `.md`, bounded length) must stay
 * IDENTICAL between the read and the write side of an attachment.
 */
const ContextDocPathParam = ContextPaths.shape.paths.element;

const ContextDocQuery = z.object({ path: ContextDocPathParam });

export default async function contextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ContextService(container);

  app.get('/repos/:id/context', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listContext(workspaceId, req.params.id);
  });

  app.get(
    '/repos/:id/context/doc',
    { schema: { params: IdParams, querystring: ContextDocQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.readDoc(workspaceId, req.params.id, req.query.path);
    },
  );

  app.get('/agents/:id/context', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const docs = await service.agentDocs(workspaceId, req.params.id);
    if (!docs) throw new NotFoundError('Agent not found');
    return docs;
  });

  app.post(
    '/agents/:id/context',
    { schema: { params: IdParams, body: ContextPaths } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const docs = await service.setAgentDocs(workspaceId, req.params.id, req.body.paths);
      if (!docs) throw new NotFoundError('Agent not found');
      return docs;
    },
  );

  app.get('/skills/:id/context', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const docs = await service.skillDocs(workspaceId, req.params.id);
    if (!docs) throw new NotFoundError('Skill not found');
    return docs;
  });

  app.post(
    '/skills/:id/context',
    { schema: { params: IdParams, body: ContextPaths } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const docs = await service.setSkillDocs(workspaceId, req.params.id, req.body.paths);
      if (!docs) throw new NotFoundError('Skill not found');
      return docs;
    },
  );
}
