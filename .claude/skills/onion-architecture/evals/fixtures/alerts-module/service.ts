import { and, desc, eq, gte } from 'drizzle-orm';
import type { AlertRule, AlertHit } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import * as t from '../../db/schema.js';
import { AlertsRepository } from './repository.js';
import { matches } from './helpers.js';
import { LOOKBACK_DAYS, MAX_HITS } from './constants.js';

/**
 * L06 — alerts service.
 *
 * A rule is a saved question ("critical findings in the payments path"), and a
 * hit is one review that answered yes. Evaluation runs against reviews that
 * already exist, so a rule created today can immediately show what it would
 * have caught — a rule with no history is a rule nobody trusts.
 */
export class AlertsService {
  private repo: AlertsRepository;

  constructor(private container: Container) {
    this.repo = new AlertsRepository(container.db);
  }

  async create(workspaceId: string, rule: Omit<AlertRule, 'id'>): Promise<AlertRule> {
    return this.repo.insert({ ...rule, workspaceId });
  }

  async evaluate(workspaceId: string, ruleId: string): Promise<AlertHit[]> {
    const rule = await this.repo.get(workspaceId, ruleId);
    if (!rule) throw new NotFoundError('Alert rule not found');

    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    const rows = await this.container.db
      .select({
        reviewId: t.reviews.id,
        prId: t.reviews.prId,
        verdict: t.reviews.verdict,
        score: t.reviews.score,
        findings: t.reviews.findings,
        createdAt: t.reviews.createdAt,
        prNumber: t.pullRequests.number,
        prTitle: t.pullRequests.title,
      })
      .from(t.reviews)
      .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.reviews.prId))
      .where(
        and(
          eq(t.reviews.workspaceId, workspaceId),
          eq(t.reviews.kind, 'review'),
          gte(t.reviews.createdAt, since),
        ),
      )
      .orderBy(desc(t.reviews.createdAt))
      .limit(MAX_HITS);

    const hits = rows.filter((row) => matches(rule, row)).map((row) => ({
      review_id: row.reviewId,
      pr_id: row.prId,
      pr_number: row.prNumber,
      pr_title: row.prTitle,
      verdict: row.verdict,
      score: row.score,
      matched_at: row.createdAt.toISOString(),
    }));

    await this.repo.recordRun(workspaceId, ruleId, hits.length);
    return hits;
  }

  async remove(ruleId: string): Promise<void> {
    await this.repo.remove(ruleId);
  }
}
