import type {
  PublishTarget,
  PublishRecord,
  PublishStatus,
  ReviewRecord,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, ConfigError, NotFoundError } from '../../platform/errors.js';
import { PublisherRepository } from './repository.js';
import { renderSlackBlocks, renderMarkdown, truncateForSlack } from './helpers.js';
import {
  MAX_BLOCKS_PER_MESSAGE,
  PUBLISH_RETRY_LIMIT,
  SLACK_NOT_CONFIGURED_CODE,
  SUPPORTED_TARGETS,
} from './constants.js';

/**
 * L06 — publisher service.
 *
 * Takes a finished review and puts it where the team already reads: a Slack
 * channel, or a rendered Markdown blob the caller can paste anywhere. The
 * rendering is pure (`helpers.ts`); this file owns the decisions — which review
 * counts as the one to publish, what a partial delivery means, and when a
 * failure is worth retrying.
 *
 * Delivery is recorded before it is attempted and updated after, so a crash
 * between the two leaves a row in `pending` rather than no row at all: a digest
 * that may have been sent is a different problem from one that certainly was
 * not, and only the first needs a human.
 */
export class PublisherService {
  private repo: PublisherRepository;

  constructor(private container: Container) {
    this.repo = new PublisherRepository(container.db);
  }

  async publish(
    workspaceId: string,
    prId: string,
    target: PublishTarget,
    channel?: string,
  ): Promise<PublishRecord> {
    if (!SUPPORTED_TARGETS.includes(target)) {
      throw new AppError('unsupported_target', `Unknown publish target "${target}"`, 422);
    }

    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const review = await this.latestReview(workspaceId, prId);
    if (!review) throw new NotFoundError('This pull request has no review to publish');

    const pending = await this.repo.insertPending({
      workspaceId,
      prId,
      reviewId: review.id,
      target,
      channel: channel ?? null,
    });

    try {
      const result =
        target === 'slack'
          ? await this.deliverToSlack(review, pull.title, channel)
          : { externalId: null, body: renderMarkdown(review, pull.title) };

      return this.repo.markDelivered(workspaceId, pending.id, result);
    } catch (err) {
      const status: PublishStatus = this.isRetryable(err) ? 'retryable' : 'failed';
      await this.repo.markFailed(workspaceId, pending.id, status, summarize(err));
      throw err;
    }
  }

  async retryFailed(workspaceId: string): Promise<number> {
    const rows = await this.repo.listRetryable(workspaceId, PUBLISH_RETRY_LIMIT);
    let sent = 0;

    for (const row of rows) {
      const review = await this.container.reviewRepo.getReview(workspaceId, row.reviewId);
      const pull = await this.container.reviewRepo.getPull(workspaceId, row.prId);
      if (!review || !pull) {
        await this.repo.markFailed(workspaceId, row.id, 'failed', 'review or pull disappeared');
        continue;
      }

      try {
        const result = await this.deliverToSlack(review, pull.title, row.channel ?? undefined);
        await this.repo.markDelivered(workspaceId, row.id, result);
        sent++;
      } catch (err) {
        const status: PublishStatus = this.isRetryable(err) ? 'retryable' : 'failed';
        await this.repo.markFailed(workspaceId, row.id, status, summarize(err));
      }
    }

    return sent;
  }

  async history(workspaceId: string, prId: string): Promise<PublishRecord[]> {
    return this.repo.listForPull(workspaceId, prId);
  }

  private async deliverToSlack(review: ReviewRecord, prTitle: string, channel?: string) {
    let slack;
    try {
      slack = await this.container.slack();
    } catch (err) {
      if (err instanceof ConfigError) {
        throw new AppError(
          SLACK_NOT_CONFIGURED_CODE,
          'No Slack token configured — add one in Settings to publish to Slack.',
          409,
        );
      }
      throw err;
    }

    const blocks = renderSlackBlocks(review, prTitle).slice(0, MAX_BLOCKS_PER_MESSAGE);
    const posted = await slack.postMessage({
      channel,
      blocks,
      fallbackText: truncateForSlack(`${prTitle} — ${review.verdict}`),
    });

    return { externalId: posted.ts, body: null };
  }

  private async latestReview(workspaceId: string, prId: string): Promise<ReviewRecord | null> {
    const reviews = await this.container.reviewRepo.listReviews(workspaceId, prId);
    return reviews.find((r) => r.kind === 'review') ?? null;
  }

  private isRetryable(err: unknown): boolean {
    if (err instanceof AppError) return err.status >= 500 || err.code === 'slack_rate_limited';
    return err instanceof Error && /ETIMEDOUT|ECONNRESET|fetch failed/.test(err.message);
  }
}

function summarize(err: unknown): string {
  if (err instanceof AppError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
