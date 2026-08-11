import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Intent, PrIntentRecord } from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent ---------------------------------------------------------------

/** Everything `upsertIntent` needs: the classifier output plus derivation metadata. */
export interface UpsertIntentInput extends Intent {
  model: string;
  headSha: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

export async function upsertIntent(db: Db, prId: string, input: UpsertIntentInput): Promise<void> {
  const values = {
    intent: input.intent,
    inScope: input.in_scope,
    outOfScope: input.out_of_scope,
    riskAreas: input.risk_areas,
    confidence: input.confidence,
    sources: input.sources,
    model: input.model,
    headSha: input.headSha,
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
    costUsd: input.costUsd,
  };
  await db
    .insert(t.prIntent)
    .values({ prId, ...values })
    // `createdAt` is intentionally NOT in the update set: a re-derive (POST
    // .../intent) overwrites everything about the classification but keeps
    // the original derivation timestamp, matching "no auto re-derive" — this
    // IS the user's button, and it replaces the row's content, not its age.
    .onConflictDoUpdate({ target: t.prIntent.prId, set: values });
}

/** Row → wire DTO (snake_case, including `pr_id` — `PrIntentRecord` declares
 *  it required, same as the sibling records at `review-api.ts:25,53`, so the
 *  record is self-identifying wherever it travels). A pre-0015 row (before
 *  this branch ran) has `risk_areas`/`sources` defaulted to `[]` by the
 *  migration and a `null` confidence — defaulted here to 0 rather than left
 *  null, since `Intent.confidence` is a required 0-1 number. */
export async function getIntent(db: Db, prId: string): Promise<PrIntentRecord | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return {
    pr_id: row.prId,
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    risk_areas: row.riskAreas,
    confidence: row.confidence ?? 0,
    sources: row.sources as Intent['sources'],
    model: row.model,
    head_sha: row.headSha,
    created_at: row.createdAt.toISOString(),
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cost_usd: row.costUsd,
  };
}
