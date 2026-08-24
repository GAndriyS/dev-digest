import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { Onboarding, OnboardingGenerateBody } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { onboardingLogFields } from './helpers.js';
import { OnboardingService } from './service.js';

/**
 * Onboarding tour generator module.
 *
 *   GET  /repos/:id/onboarding           → stored tour, skeleton, or the empty pre-generation state
 *   POST /repos/:id/onboarding/generate  → (re)generate; at most one model call
 *
 * The `/repos/:id/...` prefix is owned by the feature module, same pattern as
 * `conventions`/`repo-intel`. `response[200]: Onboarding` — the same schema
 * that validates the request body's shape (for generate's `locale`) also
 * serializes what leaves the process, so a handler drifting from the
 * contract fails loudly instead of silently widening the public API.
 *
 * Exactly ONE `app.log.info` per generation (D8, AC-33/AC-35), including the
 * skeleton branches — never zero, never two.
 */
export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new OnboardingService(app.container);

  app.get(
    '/repos/:id/onboarding',
    { schema: { params: IdParams, response: { 200: Onboarding } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getTour(workspaceId, req.params.id);
    },
  );

  app.post(
    '/repos/:id/onboarding/generate',
    {
      // `.nullish()`: every field of `OnboardingGenerateBody` is already
      // optional, but that only covers a SENT-but-empty JSON body — a
      // truly body-less POST (no `content-type`) reaches the validator as
      // `null` (Fastify's default for an absent body), which fails a bare
      // `z.object({...})`. The handler reads `req.body?.locale`.
      schema: {
        params: IdParams,
        body: OnboardingGenerateBody.nullish(),
        response: { 200: Onboarding },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { tour, telemetry } = await service.generate(
        workspaceId,
        req.params.id,
        req.body?.locale,
      );
      app.log.info(onboardingLogFields(telemetry), 'onboarding tour generated');
      return tour;
    },
  );
}
