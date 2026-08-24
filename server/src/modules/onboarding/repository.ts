import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Onboarding tour generator — repository.
 *
 * `onboarding` (`repo_id` PK, `json`, `generated_at`) already has exactly the
 * shape this module needs (`0000_init.sql:205`, `db/schema/context.ts`) — no
 * migration. One row per repo, fully overwritten on each `generate()`
 * (`ON CONFLICT (repo_id) DO UPDATE`) — the tour is never patched (AC-4/AC-5).
 */

export interface RepoBasics {
  clonePath: string | null;
  fullName: string;
  defaultBranch: string;
}

export interface OnboardingRow {
  /** `jsonb` — already-parsed JS value; caller `safeParse`s it (`parseStoredTour`). */
  json: unknown;
  generatedAt: Date;
}

export interface StoredTourUpsert {
  json: unknown;
  generatedAt: Date;
}

export class OnboardingRepository {
  constructor(private db: Db) {}

  /** Workspace-scoped — `undefined` when the repo doesn't exist or belongs to another workspace. */
  async repoBasics(workspaceId: string, repoId: string): Promise<RepoBasics | undefined> {
    const [row] = await this.db
      .select({
        clonePath: t.repos.clonePath,
        fullName: t.repos.fullName,
        defaultBranch: t.repos.defaultBranch,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /** `undefined` when no tour has ever been generated for this repo (AC-3). */
  async getTour(repoId: string): Promise<OnboardingRow | undefined> {
    const [row] = await this.db
      .select({ json: t.onboarding.json, generatedAt: t.onboarding.generatedAt })
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId));
    return row;
  }

  /** Full row replacement — never a partial patch (AC-4, AC-5, "two tabs" edge case). */
  async upsertTour(repoId: string, stored: StoredTourUpsert): Promise<void> {
    await this.db
      .insert(t.onboarding)
      .values({ repoId, json: stored.json, generatedAt: stored.generatedAt })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: { json: stored.json, generatedAt: stored.generatedAt },
      });
  }
}
