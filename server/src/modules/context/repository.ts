import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * L05 — Project Context data-access. The only place that touches
 * `agent_context_docs` and `skill_context_docs`.
 *
 * It also reads the one `repos` column the listing/preview needs —
 * `clonePath` — duplicating a little of the repos repository on purpose:
 * `no-cross-module-internals` forbids importing another module's
 * repository, and widening a shared facade for one column is the bigger
 * change (same reasoning as `modules/conventions/repository.ts`).
 */

export interface RepoBasics {
  id: string;
  clonePath: string | null;
}

export class ContextRepository {
  constructor(private db: Db) {}

  async repoBasics(workspaceId: string, repoId: string): Promise<RepoBasics | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  // ---- agent_context_docs ---------------------------------------------------

  /** Paths attached directly to an agent, in prompt order. */
  async agentDocPaths(agentId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.agentContextDocs.path })
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.agentId, agentId))
      .orderBy(asc(t.agentContextDocs.position), asc(t.agentContextDocs.path));
    return rows.map((r) => r.path);
  }

  /** Replace the whole ordered set for an agent — mirrors `AgentsRepository.setSkills`. */
  async setAgentDocPaths(agentId: string, paths: string[]): Promise<void> {
    await this.db.delete(t.agentContextDocs).where(eq(t.agentContextDocs.agentId, agentId));
    if (paths.length === 0) return;
    await this.db
      .insert(t.agentContextDocs)
      .values(paths.map((path, i) => ({ agentId, path, position: i })));
  }

  // ---- skill_context_docs ----------------------------------------------------

  /** Paths attached directly to a skill, in prompt order. */
  async skillDocPaths(skillId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.skillContextDocs.path })
      .from(t.skillContextDocs)
      .where(eq(t.skillContextDocs.skillId, skillId))
      .orderBy(asc(t.skillContextDocs.position), asc(t.skillContextDocs.path));
    return rows.map((r) => r.path);
  }

  /** Replace the whole ordered set for a skill. */
  async setSkillDocPaths(skillId: string, paths: string[]): Promise<void> {
    await this.db.delete(t.skillContextDocs).where(eq(t.skillContextDocs.skillId, skillId));
    if (paths.length === 0) return;
    await this.db
      .insert(t.skillContextDocs)
      .values(paths.map((path, i) => ({ skillId, path, position: i })));
  }

  /**
   * How many agents currently have each of `paths` attached — the "Used by N
   * agents" badge (AC-9). Agents only (Open questions default): AC-9 names
   * "agents" and the badge is not asked for skills.
   */
  async usedByAgentCounts(paths: string[]): Promise<Map<string, number>> {
    if (paths.length === 0) return new Map();
    const rows = await this.db
      .select({ path: t.agentContextDocs.path, n: sql<number>`count(*)::int` })
      .from(t.agentContextDocs)
      .where(inArray(t.agentContextDocs.path, paths))
      .groupBy(t.agentContextDocs.path);
    return new Map(rows.map((r) => [r.path, r.n]));
  }
}
