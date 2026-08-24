import { and, desc, eq } from 'drizzle-orm';
import type { WatchlistEntry } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export interface InsertWatch {
  workspaceId: string;
  userId: string;
  prId: string;
  seenSha: string;
}

/** The only place that touches `watchlist`. */
export class WatchlistRepository {
  constructor(private db: Db) {}

  async insert(row: InsertWatch): Promise<WatchlistEntry> {
    const [inserted] = await this.db.insert(t.watchlist).values(row).returning();
    return toDto(inserted!);
  }

  async listForUser(workspaceId: string, userId: string): Promise<WatchlistEntry[]> {
    const rows = await this.db
      .select()
      .from(t.watchlist)
      .where(and(eq(t.watchlist.workspaceId, workspaceId), eq(t.watchlist.userId, userId)))
      .orderBy(desc(t.watchlist.createdAt));

    return rows.map(toDto);
  }

  async remove(workspaceId: string, entryId: string): Promise<void> {
    await this.db.delete(t.watchlist).where(eq(t.watchlist.id, entryId));
  }

  async countForPull(prId: string): Promise<number> {
    const rows = await this.db.select().from(t.watchlist).where(eq(t.watchlist.prId, prId));
    return rows.length;
  }
}

function toDto(row: typeof t.watchlist.$inferSelect): WatchlistEntry {
  return {
    id: row.id,
    pr_id: row.prId,
    seen_sha: row.seenSha,
    created_at: row.createdAt.toISOString(),
  };
}
