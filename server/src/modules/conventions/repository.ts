import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ConventionStatus } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * L03 — conventions data-access layer. The ONLY place that touches the
 * `conventions` table. Every query is scoped by `workspaceId` (tenancy guard).
 *
 * It also reads the one `repos` column the extractor needs — `clonePath`, to
 * find the files to sample. That duplicates a little of the repos repository on
 * purpose: a module may not import another module's repository
 * (`no-cross-module-internals`), and widening a shared facade for one column is
 * the bigger change. The UI's GitHub deep-links do NOT come from here; the
 * client already holds the repo's full name and branch from its own repo list.
 */

export type ConventionRow = typeof t.conventions.$inferSelect;

export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  category: string;
  rule: string;
  evidencePath: string;
  evidenceSnippet: string;
  evidenceLine: number;
  confidence: number;
}

export interface RepoBasics {
  id: string;
  clonePath: string | null;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  async repoBasics(workspaceId: string, repoId: string): Promise<RepoBasics | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /** Newest first, so a fresh scan's candidates head the list. */
  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(desc(t.conventions.createdAt));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  /**
   * Swap a repo's untouched candidates for a fresh set, atomically.
   *
   * Only `pending` rows go: accepted and rejected are user decisions and
   * survive, which is what makes "Re-scan" safe to press twice. The delete and
   * the insert share one transaction because half of this operation is worse
   * than none of it — a failed insert after a committed delete leaves an empty
   * triage list recoverable only by paying for another model call.
   */
  async replacePending(
    workspaceId: string,
    repoId: string,
    values: InsertConvention[],
  ): Promise<ConventionRow[]> {
    return this.db.transaction(async (tx) => {
      await tx
        .delete(t.conventions)
        .where(
          and(
            eq(t.conventions.workspaceId, workspaceId),
            eq(t.conventions.repoId, repoId),
            eq(t.conventions.status, 'pending'),
          ),
        );
      if (values.length === 0) return [];
      return tx.insert(t.conventions).values(values).returning();
    });
  }

  async update(
    workspaceId: string,
    id: string,
    patch: { rule?: string; status?: ConventionStatus },
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set(patch)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  /** Rules already stored for this repo — the dedupe set for a re-scan. */
  async existingRules(workspaceId: string, repoId: string): Promise<string[]> {
    const rows = await this.db
      .select({ rule: t.conventions.rule })
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          inArray(t.conventions.status, ['accepted', 'rejected']),
        ),
      );
    return rows.map((r) => r.rule);
  }
}
