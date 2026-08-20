import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * PR Why + Risk Brief — repository.
 *
 * `pr_brief` (`pr_id` PK) already exists — this module is its first real
 * writer (AC-23, AC-24); `db/seed.ts` seeds one row for fixtures. `json`
 * stores the full `PrWhyBrief` shape (minus a trustworthy `stale`, which is
 * never read from here — `service.ts` recomputes it on every read by
 * comparing the dedicated `headSha` COLUMN against `pull_requests.head_sha`).
 * One row per PR, fully overwritten on each `generate()` — never patched.
 */

export interface BriefRow {
  /** `jsonb` — already-parsed JS value; caller `safeParse`s it (`parseStoredBrief`). */
  json: unknown;
  headSha: string | null;
  generatedAt: Date | null;
  model: string | null;
}

export interface BriefUpsert {
  json: unknown;
  headSha: string;
  generatedAt: Date;
  model: string | null;
}

export class BriefRepository {
  constructor(private db: Db) {}

  /** `undefined` when no brief has ever been generated for this PR (AC-2). */
  async getBrief(prId: string): Promise<BriefRow | undefined> {
    const [row] = await this.db
      .select({
        json: t.prBrief.json,
        headSha: t.prBrief.headSha,
        generatedAt: t.prBrief.generatedAt,
        model: t.prBrief.model,
      })
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId));
    return row;
  }

  /** Full row replacement — never a partial patch (AC-4, AC-16/AC-28's "leave the previous row untouched" only applies BEFORE this is called). */
  async upsertBrief(prId: string, values: BriefUpsert): Promise<void> {
    await this.db
      .insert(t.prBrief)
      .values({
        prId,
        json: values.json,
        headSha: values.headSha,
        generatedAt: values.generatedAt,
        model: values.model,
      })
      .onConflictDoUpdate({
        target: t.prBrief.prId,
        set: {
          json: values.json,
          headSha: values.headSha,
          generatedAt: values.generatedAt,
          model: values.model,
        },
      });
  }
}
