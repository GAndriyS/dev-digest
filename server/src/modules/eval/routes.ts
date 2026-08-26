import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AgentEvalBatch, EvalCase, EvalCaseInput, EvalDashboard, EvalDashboardOverview } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { EvalService } from './service.js';
import { EvalRunner } from './runner.js';
import { getEvalDashboard, getEvalOverview } from './dashboard.js';

/**
 * A4 — eval module (SPEC-05, step 10). Agent-owned eval cases (CRUD, minus
 * update/delete — see below), "Turn into eval case", the batch runner and the
 * Eval Dashboard read models.
 *
 *   GET    /eval-cases                → an agent's case set (?owner_kind=agent&owner_id=<agentId>)
 *   POST   /eval-cases                → create one (201)
 *   GET    /eval-cases/:id            → one case
 *   POST   /findings/:id/eval-case    → mint (or return) a case from a decided finding (201 created / 200 existing)
 *   POST   /agents/:id/eval-runs      → run the agent's whole set as one batch
 *   GET    /eval/overview             → every agent with a non-empty set + recent batches
 *   GET    /eval/dashboard            → one agent's dashboard (?owner_id=<agentId>)
 *
 * NO `PUT /eval-cases/:id` / `DELETE /eval-cases/:id` here: `skills/routes.ts`
 * already registers both on the SAME path, generically over `eval_cases`
 * (`SkillsRepository#updateEvalCase`/`#deleteEvalCase` filter by
 * `workspaceId`+`id` only, never `owner_kind` — they already serve
 * agent-owned rows). Fastify's router is one flat table across every
 * registered plugin (`modules/index.ts` — no per-module prefix/encapsulation),
 * so registering the same method+path again here would throw
 * `FST_ERR_DUPLICATED_ROUTE` at boot. See the implementation report for the
 * one known wire mismatch this reuse carries (`DELETE` answers
 * `{ deleted: id }`, not `{ ok: boolean }`) — out of this module's ownership
 * to fix.
 *
 * Zod `params`/`body`/`querystring` are declared ON THE ROUTE (422 before the
 * handler runs, `server/AGENTS.md:18-19`); every response is served straight
 * off the same shared contracts that validate the request side
 * (`schema.response`) so a handler drifting from the contract fails loudly.
 * Domain errors are `AppError` thrown from the service/runner/dashboard layer
 * — the structured error handler (`platform/errors.ts` + `app.ts`) maps
 * `NotFoundError` → 404, `AppError.statusCode` → itself (422 empty set, 400
 * wrong owner, …), `NoProviderKeyError` → 409. Nothing here re-handles that.
 */

/** `GET /eval-cases` is agent-only from this module (the skill-owned set is
 *  `GET /skills/:id/eval-cases`) — `owner_kind` is a literal, not the full
 *  `EvalOwnerKind` enum, so a `skill` query 422s at the edge instead of
 *  reaching a service that would silently ignore it. */
const EvalCasesQuery = z.object({
  owner_kind: z.literal('agent'),
  owner_id: z.string().uuid(),
});

/** `GET /eval/dashboard` addresses one agent by id — same shape, querystring
 *  instead of a path param (mirrors `useAgentEvalDashboard`). */
const EvalDashboardQuery = z.object({ owner_id: z.string().uuid() });

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new EvalService(app.container);
  const runner = new EvalRunner(app.container);

  app.get(
    '/eval-cases',
    { schema: { querystring: EvalCasesQuery, response: { 200: z.array(EvalCase) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.list(workspaceId, req.query.owner_id);
    },
  );

  app.post(
    '/eval-cases',
    { schema: { body: EvalCaseInput, response: { 201: EvalCase } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const body = req.body;
      const created = await service.create(workspaceId, {
        owner_kind: body.owner_kind,
        owner_id: body.owner_id,
        name: body.name,
        input_diff: body.input_diff,
        ...(body.input_files !== undefined ? { input_files: body.input_files } : {}),
        ...(body.input_meta !== undefined ? { input_meta: body.input_meta } : {}),
        ...(body.expected_output !== undefined ? { expected_output: body.expected_output } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      });
      reply.status(201);
      return created;
    },
  );

  app.get(
    '/eval-cases/:id',
    { schema: { params: IdParams, response: { 200: EvalCase } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.get(workspaceId, req.params.id);
    },
  );

  // ---- Turn a decided finding into an eval case (AC-3..AC-6) ---------------

  app.post(
    '/findings/:id/eval-case',
    { schema: { params: IdParams, response: { 200: EvalCase, 201: EvalCase } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const { case: evalCase, created } = await service.createCaseFromFinding(
        workspaceId,
        req.params.id,
      );
      reply.status(created ? 201 : 200);
      return evalCase;
    },
  );

  // ---- Run an agent's whole set as one batch (AC-12..AC-25) ----------------

  app.post(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams, response: { 200: AgentEvalBatch } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return runner.runAgentBatch(workspaceId, req.params.id);
    },
  );

  // ---- Eval Dashboard read models (AC-9, AC-26..AC-31) ----------------------

  app.get(
    '/eval/overview',
    { schema: { response: { 200: EvalDashboardOverview } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return getEvalOverview(app.container, workspaceId);
    },
  );

  app.get(
    '/eval/dashboard',
    { schema: { querystring: EvalDashboardQuery, response: { 200: EvalDashboard } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return getEvalDashboard(app.container, workspaceId, req.query.owner_id);
    },
  );
}
