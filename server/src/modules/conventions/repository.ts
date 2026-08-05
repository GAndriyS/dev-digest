import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ConventionStatus } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * L03 — conventions data-access layer. The ONLY place that touches the
 * `conventions` table. Every query is scoped by `workspaceId` (tenancy guard).
 *
 * It also reads the two `repos` columns the extractor needs (`clonePath` for
 * reading files, `fullName`/`defaultBranch` for the UI's GitHub links). That
 * duplicates a little of the repos repository on purpose: a module may not
 * import another module's repository (`no-cross-module-internals`), and the
 * alternative — widening a shared facade for two columns — is the bigger change.
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
  fullName: string;
  defaultBranch: string;
  clonePath: string | null;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  async repoBasics(workspaceId: string, repoId: string): Promise<RepoBasics | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        fullName: t.repos.fullName,
        defaultBranch: t.repos.defaultBranch,
        clonePath: t.repos.clonePath,
      })
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
   * Drop only the untouched candidates of a repo. Accepted and rejected rows are
   * user decisions and survive a re-scan — that is what makes "Re-scan" safe to
   * press twice.
   */
  async deletePending(workspaceId: string, repoId: string): Promise<void> {
    await this.db
      .delete(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.status, 'pending'),
        ),
      );
  }

  async insertMany(values: InsertConvention[]): Promise<ConventionRow[]> {
    if (values.length === 0) return [];
    return this.db.insert(t.conventions).values(values).returning();
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
