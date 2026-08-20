import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrWhyBrief } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { briefLogFields } from './helpers.js';
import { BriefGenerationError, BriefService } from './service.js';

/**
 * PR Why + Risk Brief module (L05/SPEC-04).
 *   GET  /pulls/:id/brief   → the stored brief, or `null` before the first generation
 *   POST /pulls/:id/brief   → (re)generate; exactly one model call, replaces the stored brief
 *
 * The GET makes no LLM and no GitHub call — a pure read over `pr_brief` +
 * the PR's `head_sha` — so it carries no rate limit, same reasoning as
 * `blast/routes.ts`'s GET. The POST spends money, so it is limited exactly
 * like `POST /pulls/:id/intent` (`reviews/routes.ts:149-156`). It declares
 * NO `body` schema at all: there is no request body, and a body-less POST
 * reaches the validator as `null` (`server/INSIGHTS.md:199-207`) — declaring
 * one here would 422 every real call.
 *
 * `response[200]` on both routes is the same schema that serializes what
 * leaves the process, so a handler drifting from the contract fails loudly
 * instead of silently widening the public API (Zod-first, `AGENTS.md:36-38`).
 *
 * Exactly ONE `app.log.info` per generation ATTEMPT (AC-45, amendment A4),
 * success or failure — the success line mirrors `onboarding/routes.ts:59`'s
 * precedent; the failure line exists because A4's whole point is telling
 * "the model found nothing" apart from "the source was unavailable" from
 * logs alone, and that question matters most for the attempt that never
 * wrote a row. `service.generate` throws `BriefGenerationError` (carrying
 * the SAME `BriefTelemetry` a success returns) on a genuine model failure
 * (AC-16) — the route logs it here, then rethrows unchanged so the 502
 * still reaches the caller exactly as before.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BriefService(container);

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: PrWhyBrief.nullable() } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getBrief(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams, response: { 200: PrWhyBrief } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      try {
        const { brief, telemetry } = await service.generate(workspaceId, req.params.id);
        app.log.info(briefLogFields(telemetry), 'pr brief generated');
        return brief;
      } catch (err) {
        if (err instanceof BriefGenerationError) {
          app.log.info(briefLogFields(err.telemetry), 'pr brief generation failed');
        }
        throw err;
      }
    },
  );
}
