import { realpath } from 'node:fs/promises';
import type { Onboarding, OnboardingSkeletonReason } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, ConfigError, NotFoundError, errSummary, NoProviderKeyError } from '../../platform/errors.js';
import { loadPromptTemplate, renderTemplate } from '../../platform/prompts.js';
import { readInsideClone } from '../_shared/clone-fs.js';
import { resolveFeatureModel } from '../settings/index.js';
import type { IndexState } from '../repo-intel/types.js';
import {
  MAX_FILE_BYTES,
  MAX_STRUCTURED_RETRIES,
  SCHEMA_NAME,
  SECTION_KINDS,
} from './constants.js';
import { collectFacts } from './facts.js';
import {
  OnboardingDraft,
  assembleSections,
  buildSkeleton,
  buildTourMessages,
  deriveIndexSummary,
  parseStoredTour,
} from './helpers.js';
import { OnboardingRepository } from './repository.js';
import type { OnboardingTelemetry } from './types.js';

/**
 * Onboarding tour generator — service.
 *
 * `getTour` NEVER calls the model — cache, skeleton or the pre-generation
 * empty state, in that order (A10). `generate` makes AT MOST one
 * `completeStructured` call: a degraded/no-clone/disabled repo, or a
 * previously-attempted generation, returns the same deterministic skeleton
 * as a polite no-op (AC-25) — the model is only ever reached once the index
 * is actually healthy.
 */

export { NoProviderKeyError } from '../../platform/errors.js';

export interface OnboardingGenerateResult {
  tour: Onboarding;
  telemetry: OnboardingTelemetry;
}

export class OnboardingService {
  private repo: OnboardingRepository;

  constructor(private container: Container) {
    this.repo = new OnboardingRepository(container.db);
  }

  /** GET — zero model calls, ever. Stored row wins (AC-5/AC-29) → skeleton → empty (AC-3). */
  async getTour(workspaceId: string, repoId: string): Promise<Onboarding> {
    const basics = await this.repo.repoBasics(workspaceId, repoId);
    if (!basics) throw new NotFoundError('Repository not found');

    const stored = await this.repo.getTour(repoId);
    if (stored) {
      const parsed = parseStoredTour(stored.json);
      if (parsed) {
        return {
          status: 'ready',
          reason: null,
          generated_at: stored.generatedAt.toISOString(),
          index: parsed.index,
          sections: parsed.sections,
        };
      }
      // Unparseable jsonb (contract moved on since this row was written) —
      // fall through exactly as if no row existed, never a 500.
    }

    const state = await this.container.repoIntel.getIndexState(repoId);
    const index = deriveIndexSummary(state);
    const reason = skeletonReason(basics.clonePath, this.container.config.repoIntelEnabled, state);
    if (reason) return buildSkeleton(reason, index);

    return { status: 'ready', reason: null, generated_at: null, index, sections: [] };
  }

  /** POST /generate — at most one model call; skeleton branches never reach it (AC-23, AC-25). */
  async generate(
    workspaceId: string,
    repoId: string,
    locale: string | undefined,
  ): Promise<OnboardingGenerateResult> {
    const startedAt = Date.now();
    const basics = await this.repo.repoBasics(workspaceId, repoId);
    if (!basics) throw new NotFoundError('Repository not found');

    // Resolved BEFORE the skeleton check so every log line — including
    // skeleton ones — names the provider/model that would have been used
    // (A8), without validating a key exists (that only matters once we are
    // actually about to call the model).
    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'onboarding');

    const state = await this.container.repoIntel.getIndexState(repoId);
    const index = deriveIndexSummary(state);
    const reason = skeletonReason(basics.clonePath, this.container.config.repoIntelEnabled, state);
    if (reason) {
      return {
        tour: buildSkeleton(reason, index),
        telemetry: skeletonTelemetry(provider, model, repoId, reason, startedAt, 0),
      };
    }

    const llm = await this.container.llm(provider).catch((e) => {
      // Translate the container's "key missing" into the 409 the UI renders.
      if (e instanceof ConfigError) throw new NoProviderKeyError(provider, 'generate the onboarding tour');
      throw e;
    });

    const root = await realpath(basics.clonePath!).catch(() => null);
    if (root === null) {
      // `clone_path` set but not actually on disk (race with a delete/move) —
      // same user-facing outcome as never having cloned.
      return {
        tour: buildSkeleton('no_clone', index),
        telemetry: skeletonTelemetry(provider, model, repoId, 'no_clone', startedAt, 0),
      };
    }

    const facts = await collectFacts(repoId, {
      repoIntel: this.container.repoIntel,
      root,
      read: (relPath, maxBytes) => readInsideClone(root, relPath, maxBytes),
    });

    const language = locale && locale.trim().length > 0 ? locale : 'en';
    const systemPrompt = renderTemplate(await loadPromptTemplate('onboarding.system.md'), {
      sections: SECTION_KINDS.join(', '),
      language,
    });
    const messages = buildTourMessages(facts, language, systemPrompt);

    let result;
    try {
      result = await llm.completeStructured<OnboardingDraft>({
        model,
        schema: OnboardingDraft,
        schemaName: SCHEMA_NAME,
        messages,
        temperature: 0,
        maxRetries: MAX_STRUCTURED_RETRIES,
      });
    } catch (err) {
      // Network failure, or valid-JSON-but-schema-invalid after every retry
      // (`openai.ts:132-134`) — the PREVIOUSLY stored tour, if any, is left
      // untouched (AC-26): we never write here. `ConfigError` (missing key,
      // translated to `NoProviderKeyError`) is thrown from `container.llm(...)`
      // ABOVE, outside this `try` — this catch only ever sees a genuine
      // `completeStructured` failure, never the 409 case.
      return {
        tour: buildSkeleton('llm_failed', index),
        telemetry: skeletonTelemetry(
          provider,
          model,
          repoId,
          'llm_failed',
          startedAt,
          1,
          // `completeStructured` doesn't expose how many attempts it made
          // before throwing — `ExternalServiceError`'s `details` carries only
          // `raw` (openai.ts:132-134), and a network/timeout failure can
          // throw well before `MAX_STRUCTURED_RETRIES + 1` attempts. Honest
          // `null` beats inventing a number that's only ever true for the
          // schema-exhausted case.
          null,
          errSummary(err).message,
        ),
      };
    }

    const { sections, droppedPaths } = assembleSections(result.data, facts);
    const generatedAt = new Date();
    await this.repo.upsertTour(repoId, { json: { sections, index }, generatedAt });

    const tour: Onboarding = {
      status: 'ready',
      reason: null,
      generated_at: generatedAt.toISOString(),
      index,
      sections,
    };
    const telemetry: OnboardingTelemetry = {
      provider,
      model,
      calls: 1,
      attempts: result.attempts,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
      droppedPaths,
      repoId,
      durationMs: Date.now() - startedAt,
    };
    return { tour, telemetry };
  }
}

/**
 * A10's binding order: no clone → repo-intel disabled → never indexed →
 * degraded → failed. `null` means the index is healthy enough to generate.
 */
function skeletonReason(
  clonePath: string | null,
  repoIntelEnabled: boolean,
  state: IndexState,
): OnboardingSkeletonReason | null {
  if (!clonePath) return 'no_clone';
  if (!repoIntelEnabled) return 'disabled';
  if (state.degradedReason === 'no_data') return 'not_indexed';
  if (state.status === 'degraded') return 'degraded';
  if (state.status === 'failed') return 'failed';
  return null;
}

function skeletonTelemetry(
  provider: string,
  model: string,
  repoId: string,
  reason: OnboardingSkeletonReason,
  startedAt: number,
  calls: number,
  attempts: number | null = 0,
  error?: string,
): OnboardingTelemetry {
  return {
    provider,
    model,
    calls,
    attempts,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: null,
    droppedPaths: 0,
    repoId,
    durationMs: Date.now() - startedAt,
    reason,
    ...(error ? { error } : {}),
  };
}
