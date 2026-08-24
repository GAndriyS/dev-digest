import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { dedupeKeepFirst } from './helpers.js';

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

  /**
   * Replace the whole ordered set for an agent — mirrors
   * `AgentsRepository.setSkills`, with two fixes that method doesn't need:
   * the delete + insert run inside ONE transaction (a bare sequence commits
   * the delete even if the insert then fails, losing the owner's entire
   * attachment set), and `paths` is deduped (keep-first, same rule
   * `resolveForRun`'s agent+skill merge already uses) before the insert — a
   * duplicate in the wire body would otherwise violate PK `(agent_id, path)`
   * AFTER the delete already committed, surfacing as a generic 500
   * (`server/src/app.ts`) instead of a clean replace.
   */
  async setAgentDocPaths(agentId: string, paths: string[]): Promise<void> {
    const deduped = dedupeKeepFirst(paths);
    await this.db.transaction(async (tx) => {
      await tx.delete(t.agentContextDocs).where(eq(t.agentContextDocs.agentId, agentId));
      if (deduped.length === 0) return;
      await tx
        .insert(t.agentContextDocs)
        .values(deduped.map((path, i) => ({ agentId, path, position: i })));
    });
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

  /** Replace the whole ordered set for a skill — same transaction + dedupe fix as `setAgentDocPaths`. */
  async setSkillDocPaths(skillId: string, paths: string[]): Promise<void> {
    const deduped = dedupeKeepFirst(paths);
    await this.db.transaction(async (tx) => {
      await tx.delete(t.skillContextDocs).where(eq(t.skillContextDocs.skillId, skillId));
      if (deduped.length === 0) return;
      await tx
        .insert(t.skillContextDocs)
        .values(deduped.map((path, i) => ({ skillId, path, position: i })));
    });
  }

  /**
   * How many agents currently have each of `paths` attached — the "Used by N
   * agents" badge (AC-9). Agents only (Open questions default): AC-9 names
   * "agents" and the badge is not asked for skills.
   *
   * Joined to `agents` and scoped to `workspaceId` — without the join this
   * grouped every workspace's agents together, so the badge leaked another
   * workspace's attachment counts into this one's listing.
   */
  async usedByAgentCounts(workspaceId: string, paths: string[]): Promise<Map<string, number>> {
    if (paths.length === 0) return new Map();
    const rows = await this.db
      .select({ path: t.agentContextDocs.path, n: sql<number>`count(*)::int` })
      .from(t.agentContextDocs)
      .innerJoin(t.agents, eq(t.agents.id, t.agentContextDocs.agentId))
      .where(and(eq(t.agents.workspaceId, workspaceId), inArray(t.agentContextDocs.path, paths)))
      .groupBy(t.agentContextDocs.path);
    return new Map(rows.map((r) => [r.path, r.n]));
  }
}
