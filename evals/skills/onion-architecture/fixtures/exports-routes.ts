import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { eq, and, desc } from 'drizzle-orm';
import { ExportCreate } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import * as t from '../../db/schema.js';
import { ExportsService } from './service.js';

/**
 * L06 — exports module.
 *
 *   GET  /pulls/:id/exports        → every export produced for this PR
 *   POST /pulls/:id/exports        → render one review into a shareable digest
 *   GET  /exports/:id              → one export, with its rendered body
 *
 * Exports are cheap to re-render but expensive to lose: the digest embeds the
 * verdict, the findings and the review focus as they stood at the moment of
 * export, so a later re-run of the agent never rewrites history the reader
 * already shared with their team.
 */
export default async function exportsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ExportsService(app.container);

  app.get('/pulls/:id/exports', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);

    const rows = await app.container.db
      .select({
        id: t.exports.id,
        prId: t.exports.prId,
        format: t.exports.format,
        createdAt: t.exports.createdAt,
      })
      .from(t.exports)
      .where(and(eq(t.exports.workspaceId, workspaceId), eq(t.exports.prId, req.params.id)))
      .orderBy(desc(t.exports.createdAt))
      .limit(50);

    return rows.map((row) => ({
      id: row.id,
      pr_id: row.prId,
      format: row.format,
      created_at: row.createdAt.toISOString(),
    }));
  });

  app.post(
    '/pulls/:id/exports',
    { schema: { params: IdParams, body: ExportCreate } },
    async (req) => {
      return service.create(req, req.params.id);
    },
  );

  app.get('/exports/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.get(workspaceId, req.params.id);
  });
}
