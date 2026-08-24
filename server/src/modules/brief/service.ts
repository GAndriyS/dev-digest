import type { PrWhyBrief } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import {
  ConfigError,
  ExternalServiceError,
  NoProviderKeyError,
  NotFoundError,
  errSummary,
} from '../../platform/errors.js';
import { loadPromptTemplate } from '../../platform/prompts.js';
import { resolveFeatureModel } from '../settings/index.js';
import { MAX_STRUCTURED_RETRIES, SCHEMA_NAME } from './constants.js';
import { collectBriefFacts } from './facts.js';
import { BriefDraft, buildBriefMessages, groundBrief, parseStoredBrief } from './helpers.js';
import { BriefRepository } from './repository.js';
import type { BriefTelemetry } from './types.js';

export { NoProviderKeyError } from '../../platform/errors.js';

export interface BriefGenerateResult {
  brief: PrWhyBrief;
  telemetry: BriefTelemetry;
}

/**
 * Thrown instead of a bare `ExternalServiceError` when `completeStructured`
 * fails — carries the SAME `BriefTelemetry` shape a successful `generate()`
 * returns (amendment A4), so the route can log `inputs[]` in full for the
 * one case a postmortem needs it most: a generation that never wrote a row.
 * `telemetry` is an extra property on the instance, not part of `details`
 * (`AppError`'s client-facing field) — the 502 body the caller sees is
 * unchanged; only the route's own log line gains structure. The service
 * itself never calls a logger: no route in this codebase logs from a
 * service, and `Container` carries no logger to inject.
 */
export class BriefGenerationError extends ExternalServiceError {
  constructor(
    message: string,
    details: unknown,
    public readonly telemetry: BriefTelemetry,
  ) {
    super(message, details);
  }
}

/**
 * PR Why + Risk Brief — service.
 *
 * `getBrief` NEVER calls the model — cache or the pre-generation `null`
 * state, in that order (AC-1, AC-25/AC-26). `generate` makes EXACTLY one
 * `completeStructured` call (AC-4, NFR-2) and writes `pr_brief` only after a
 * successful parse — a failed generation throws `BriefGenerationError` and
 * leaves any previously stored brief untouched (AC-16, AC-28), the same
 * "resolve model before any branch, write only on success" shape as
 * `onboarding/service.ts:82-198`. Unlike that precedent, a `completeStructured`
 * failure here still carries `BriefTelemetry` out on the thrown error
 * (amendment A4) — `facts.inputs` is already known by that point, and the
 * one case a postmortem most needs source-availability for is the one that
 * never reached a successful return to log from.
 */
export class BriefService {
  private repo: BriefRepository;

  constructor(private container: Container) {
    this.repo = new BriefRepository(container.db);
  }

  /** GET — zero model calls, ever. `null` when nothing has been generated yet (AC-2). */
  async getBrief(workspaceId: string, prId: string): Promise<PrWhyBrief | null> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const stored = await this.repo.getBrief(prId);
    if (!stored) return null;

    const parsed = parseStoredBrief(stored.json);
    if (!parsed) return null; // unparseable jsonb (contract moved on) — treat as absent, never a 500

    // `stale` is ALWAYS server-computed from the dedicated column, never
    // trusted from the stored json (AC-26). A row without a `head_sha`
    // column value (pre-this-feature) reads as stale of unknown origin.
    return { ...parsed, stale: stored.headSha !== pull.headSha };
  }

  /** POST — at most one model call; a previously stored brief survives any failure (AC-16, AC-28). */
  async generate(workspaceId: string, prId: string): Promise<BriefGenerateResult> {
    const startedAt = Date.now();
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'risk_brief');

    // Facts are collected BEFORE the model is resolved to a live client so a
    // missing-key 409 still reflects real source availability if the caller
    // inspects it — and so `inputs` is available to log even when the model
    // call itself fails below.
    const facts = await collectBriefFacts(this.container, workspaceId, pull);

    const llm = await this.container.llm(provider).catch((e) => {
      // Translate the container's "key missing" into the 409 the UI renders.
      if (e instanceof ConfigError) throw new NoProviderKeyError(provider, 'generate the PR brief');
      throw e;
    });

    const systemPrompt = await loadPromptTemplate('brief.system.md');
    const messages = buildBriefMessages(facts, systemPrompt);

    let result;
    try {
      result = await llm.completeStructured<BriefDraft>({
        model,
        schema: BriefDraft,
        schemaName: SCHEMA_NAME,
        messages,
        temperature: 0,
        maxRetries: MAX_STRUCTURED_RETRIES,
      });
    } catch (err) {
      // Network failure, or valid-JSON-but-schema-invalid after every retry —
      // AC-16: respond with an error, and the row this.repo.upsertBrief would
      // have written is simply never written (AC-28's "previously stored brief
      // untouched" — there is no write on this path at all). `facts.inputs`
      // was already collected above (amendment A4) — carry it out on the
      // error so the route's log line still has every source's status.
      const telemetry: BriefTelemetry = {
        outcome: 'failed',
        provider,
        model,
        calls: 1,
        attempts: null,
        tokensIn: null,
        tokensOut: null,
        costUsd: null,
        prId,
        durationMs: Date.now() - startedAt,
        inputs: facts.inputs,
        droppedRisks: null,
        droppedReviewFocus: null,
      };
      throw new BriefGenerationError('Failed to generate PR brief', errSummary(err), telemetry);
    }

    const grounded = groundBrief(result.data, facts);
    const generatedAt = new Date();
    const brief: PrWhyBrief = {
      what: result.data.what,
      why: result.data.why,
      risk_level: result.data.risk_level,
      risks: grounded.risks,
      review_focus: grounded.reviewFocus,
      inputs: facts.inputs,
      head_sha: pull.headSha,
      generated_at: generatedAt.toISOString(),
      model,
      // Never trusted back out of storage (see `getBrief`) — persisted only
      // because the wire type requires SOME value on the stored blob.
      stale: false,
    };

    await this.repo.upsertBrief(prId, {
      json: brief,
      headSha: pull.headSha,
      generatedAt,
      model,
    });

    const telemetry: BriefTelemetry = {
      outcome: 'success',
      provider,
      model,
      calls: 1,
      attempts: result.attempts,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
      prId,
      durationMs: Date.now() - startedAt,
      inputs: facts.inputs,
      droppedRisks: grounded.droppedRisks,
      droppedReviewFocus: grounded.droppedReviewFocus,
    };

    return { brief, telemetry };
  }
}
