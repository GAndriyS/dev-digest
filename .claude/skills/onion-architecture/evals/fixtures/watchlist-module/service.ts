import type { WatchlistEntry, WatchlistDigest } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewRepository } from '../reviews/repository/review.repo.js';
import { WatchlistRepository } from './repository.js';
import { rankByStaleness } from './helpers.js';
import { MAX_WATCHED_PULLS } from './constants.js';

/**
 * L06 — watchlist service.
 *
 * A reviewer marks the pull requests they mean to come back to; the digest
 * answers "what moved since you last looked". Staleness is computed from the
 * PR's `head_sha` against the sha recorded when the entry was created, so a
 * force-push shows up as movement and a comment does not.
 */
export class WatchlistService {
  private repo: WatchlistRepository;
  private reviews: ReviewRepository;

  constructor(private container: Container) {
    this.repo = new WatchlistRepository(container.db);
    this.reviews = new ReviewRepository(container.db);
  }

  async add(workspaceId: string, userId: string, prId: string): Promise<WatchlistEntry> {
    const pull = await this.reviews.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const watched = await this.repo.listForUser(workspaceId, userId);
    if (watched.length >= MAX_WATCHED_PULLS) {
      await this.repo.remove(workspaceId, watched[watched.length - 1]!.id);
    }

    return this.repo.insert({
      workspaceId,
      userId,
      prId,
      seenSha: pull.headSha,
    });
  }

  async digest(workspaceId: string, userId: string): Promise<WatchlistDigest> {
    const entries = await this.repo.listForUser(workspaceId, userId);
    const pulls = await Promise.all(
      entries.map((entry) => this.reviews.getPull(workspaceId, entry.prId)),
    );

    return {
      watched: entries.length,
      moved: rankByStaleness(entries, pulls.filter((p) => p != null)),
    };
  }

  async remove(workspaceId: string, entryId: string): Promise<void> {
    await this.repo.remove(workspaceId, entryId);
  }
}
