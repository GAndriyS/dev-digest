import { and, desc, eq, inArray } from 'drizzle-orm';
import type { PublishRecord, PublishStatus, PublishTarget } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export interface InsertPending {
  workspaceId: string;
  prId: string;
  reviewId: string;
  target: PublishTarget;
  channel: string | null;
}

export interface DeliveryResult {
  externalId: string | null;
  body: string | null;
}

/** The only place that touches `publications`. */
export class PublisherRepository {
  constructor(private db: Db) {}

  async insertPending(row: InsertPending): Promise<PublishRecord> {
    const [inserted] = await this.db
      .insert(t.publications)
      .values({ ...row, status: 'pending' })
      .returning();

    return toDto(inserted!);
  }

  async markDelivered(
    workspaceId: string,
    id: string,
    result: DeliveryResult,
  ): Promise<PublishRecord> {
    const [row] = await this.db
      .update(t.publications)
      .set({
        status: 'delivered',
        externalId: result.externalId,
        body: result.body,
        deliveredAt: new Date(),
        error: null,
      })
      .where(and(eq(t.publications.workspaceId, workspaceId), eq(t.publications.id, id)))
      .returning();

    return toDto(row!);
  }

  async markFailed(
    workspaceId: string,
    id: string,
    status: PublishStatus,
    error: string,
  ): Promise<void> {
    await this.db
      .update(t.publications)
      .set({ status, error, attempts: sqlIncrement() })
      .where(and(eq(t.publications.workspaceId, workspaceId), eq(t.publications.id, id)));
  }

  async listForPull(workspaceId: string, prId: string): Promise<PublishRecord[]> {
    const rows = await this.db
      .select()
      .from(t.publications)
      .where(and(eq(t.publications.workspaceId, workspaceId), eq(t.publications.prId, prId)))
      .orderBy(desc(t.publications.createdAt));

    return rows.map(toDto);
  }

  async listRetryable(workspaceId: string, limit: number): Promise<PublishRecord[]> {
    const rows = await this.db
      .select()
      .from(t.publications)
      .where(
        and(
          eq(t.publications.workspaceId, workspaceId),
          inArray(t.publications.status, ['retryable']),
        ),
      )
      .orderBy(desc(t.publications.createdAt))
      .limit(limit);

    return rows.map(toDto);
  }

  async listRecent(prIds: string[]): Promise<PublishRecord[]> {
    const rows = await this.db
      .select()
      .from(t.publications)
      .where(inArray(t.publications.prId, prIds))
      .orderBy(desc(t.publications.createdAt))
      .limit(200);

    return rows.map(toDto);
  }
}

function sqlIncrement() {
  return undefined as unknown as number;
}

function toDto(row: typeof t.publications.$inferSelect): PublishRecord {
  return {
    id: row.id,
    pr_id: row.prId,
    review_id: row.reviewId,
    target: row.target as PublishTarget,
    channel: row.channel,
    status: row.status as PublishStatus,
    external_id: row.externalId,
    error: row.error,
    created_at: row.createdAt.toISOString(),
    delivered_at: row.deliveredAt?.toISOString() ?? null,
  };
}
