import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AnnotationInput, AttachmentInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AnnotationsService } from './service.js';

/**
 * L06 — annotations module.
 *
 *   GET    /reviews/:id/annotation    → the note on this review, or null
 *   PUT    /reviews/:id/annotation    → write or replace it
 *   DELETE /reviews/:id/annotation    → remove it
 *   POST   /reviews/:id/attachments   → attach a file to the note
 *   GET    /reviews/:id/attachments   → list them
 */
export default async function annotationsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new AnnotationsService(app.container);

  app.get('/reviews/:id/annotation', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.get(workspaceId, req.params.id);
  });

  app.put(
    '/reviews/:id/annotation',
    { schema: { params: IdParams, body: AnnotationInput } },
    async (req) => {
      const { workspaceId, userId } = await getContext(app.container, req);
      return service.upsert(workspaceId, userId, req.params.id, req.body);
    },
  );

  app.delete('/reviews/:id/annotation', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.removeAnnotation(workspaceId, req.params.id);
    return { ok: true };
  });

  app.post(
    '/reviews/:id/attachments',
    { schema: { params: IdParams, body: AttachmentInput } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { name, content_type, bytes, storage_key } = req.body;
      return service.attach(workspaceId, req.params.id, {
        name,
        contentType: content_type,
        bytes,
        storageKey: storage_key,
      });
    },
  );

  app.get('/reviews/:id/attachments', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listAttachments(workspaceId, req.params.id);
  });
}
