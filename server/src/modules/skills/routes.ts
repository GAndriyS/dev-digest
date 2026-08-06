import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillImportRequest, SkillInput, SkillPatch, SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { IMPORT_BODY_LIMIT_BYTES } from './constants.js';
import { ExpectedEvalOutput } from './helpers.js';
import { SkillsService } from './service.js';

/**
 * A1 — skills module (the Skills Lab).
 *
 *   GET    /skills                                → list (?type=, ?enabled=)
 *   POST   /skills                                → create (201)
 *   POST   /skills/import/preview                 → preview an uploaded .md/.zip (saves nothing)
 *   GET    /skills/:id                            → one skill
 *   PUT    /skills/:id                            → update (changed body ⇒ new version)
 *   DELETE /skills/:id                            → delete
 *   GET    /skills/:id/versions                   → body history (no bodies)
 *   GET    /skills/:id/versions/:version          → one snapshot (with body)
 *   POST   /skills/:id/versions/:version/restore  → re-apply an old body as a NEW version
 *   GET    /skills/:id/agents                     → agents that link this skill
 *   GET    /skills/:id/stats                      → dashboard numbers
 *   GET    /skills/:id/eval-cases                 → cases owned by this skill
 *   POST   /skills/:id/eval-cases                 → create a case (201)
 *   PUT    /eval-cases/:id                        → update a case
 *   DELETE /eval-cases/:id                        → delete a case
 *   POST   /eval-cases/:id/run                    → run ONE case (real model call)
 *   POST   /skills/:id/eval-run                   → run every case for the skill
 *
 * The edge only validates and delegates; every 404/409 is a domain error thrown
 * by the service. Eval routes answer 409 `no_provider_key` when no provider key
 * is configured, which is what the UI keys its disabled Run buttons off.
 */

/** `/skills/:id/versions/:version` — id is a uuid, version a positive integer. */
const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

/**
 * `?enabled=` is a string on the wire. `z.coerce.boolean()` would read "false"
 * as `true` (any non-empty string is truthy), so the literals are parsed.
 */
const ListSkillsQuery = z.object({
  type: SkillType.optional(),
  enabled: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

/**
 * An eval case. `expected_output` is validated against the shape the comparator
 * actually reads, so a malformed expectation fails at the edge (422) instead of
 * silently scoring every run against "expected nothing".
 */
const EvalCaseBody = z.object({
  name: z.string().min(1),
  input_diff: z.string().min(1),
  input_files: z.unknown().optional(),
  input_meta: z.unknown().optional(),
  expected_output: ExpectedEvalOutput.optional(),
  notes: z.string().nullish(),
});
// Strict for the same reason as `SkillPatch`: a typo'd key would otherwise be
// stripped, match nothing, and answer 200 as if the edit had landed.
const EvalCasePatchBody = EvalCaseBody.partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Provide at least one field to update',
  });

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', { schema: { querystring: ListSkillsQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const { type, enabled } = req.query;
    return service.list(workspaceId, {
      ...(type !== undefined ? { type } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
    });
  });

  app.post('/skills', { schema: { body: SkillInput } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = req.body;
    const skill = await service.create(workspaceId, {
      name: body.name,
      description: body.description,
      type: body.type,
      source: body.source,
      body: body.body,
      enabled: body.enabled,
      ...(body.evidence_files !== undefined ? { evidence_files: body.evidence_files } : {}),
    });
    reply.status(201);
    return skill;
  });

  /**
   * Import step 1 of 2 — PREVIEW. Reads the upload and answers with the skill
   * core it found; writes nothing. Step 2 is `POST /skills` above, with the
   * confirmed fields and `source: 'imported_url'`.
   *
   * `bodyLimit` is raised for this one route: the global limit in `app.ts` is
   * 1 MiB, which would 413 a legitimate archive before the handler could apply
   * (and explain) its own caps. It stays pinned to `MAX_IMPORT_BASE64_CHARS`, so
   * there is exactly one number to change.
   *
   * No `getContext`: the preview reads a file the caller already has and stores
   * nothing, so there is no workspace to scope it to.
   */
  app.post(
    '/skills/import/preview',
    { bodyLimit: IMPORT_BODY_LIMIT_BYTES, schema: { body: SkillImportRequest } },
    async (req) => service.importPreview(req.body),
  );

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.get(workspaceId, req.params.id);
  });

  app.put('/skills/:id', { schema: { params: IdParams, body: SkillPatch } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.update(workspaceId, req.params.id, req.body);
  });

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return { deleted: await service.delete(workspaceId, req.params.id) };
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listVersions(workspaceId, req.params.id);
  });

  app.get('/skills/:id/versions/:version', { schema: { params: VersionParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getVersion(workspaceId, req.params.id, req.params.version);
  });

  app.post(
    '/skills/:id/versions/:version/restore',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.restoreVersion(workspaceId, req.params.id, req.params.version);
    },
  );

  app.get('/skills/:id/agents', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.usedBy(workspaceId, req.params.id);
  });

  app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.stats(workspaceId, req.params.id);
  });

  // ---- eval cases ---------------------------------------------------------

  app.get('/skills/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listEvalCases(workspaceId, req.params.id);
  });

  app.post(
    '/skills/:id/eval-cases',
    { schema: { params: IdParams, body: EvalCaseBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const created = await service.createEvalCase(workspaceId, req.params.id, req.body);
      reply.status(201);
      return created;
    },
  );

  app.put(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: EvalCasePatchBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.updateEvalCase(workspaceId, req.params.id, req.body);
    },
  );

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return { deleted: await service.deleteEvalCase(workspaceId, req.params.id) };
  });

  app.post('/eval-cases/:id/run', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.runEvalCase(workspaceId, req.params.id);
  });

  app.post('/skills/:id/eval-run', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.runSkillEvals(workspaceId, req.params.id);
  });
}
