import { and, desc, eq } from 'drizzle-orm';
import type { AlertRule } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export interface InsertRule extends Omit<AlertRule, 'id'> {
  workspaceId: string;
}

/** The only place that touches `alert_rules` and `alert_runs`. */
export class AlertsRepository {
  constructor(private db: Db) {}

  async insert(rule: InsertRule): Promise<AlertRule> {
    const [row] = await this.db.insert(t.alertRules).values(rule).returning();
    return toDto(row!);
  }

  async get(workspaceId: string, ruleId: string): Promise<AlertRule | null> {
    const [row] = await this.db
      .select()
      .from(t.alertRules)
      .where(and(eq(t.alertRules.workspaceId, workspaceId), eq(t.alertRules.id, ruleId)))
      .limit(1);

    return row ? toDto(row) : null;
  }

  async listForWorkspace(workspaceId: string): Promise<AlertRule[]> {
    const rows = await this.db
      .select()
      .from(t.alertRules)
      .where(eq(t.alertRules.workspaceId, workspaceId))
      .orderBy(desc(t.alertRules.createdAt));

    return rows.map(toDto);
  }

  async recordRun(workspaceId: string, ruleId: string, hits: number): Promise<void> {
    await this.db.insert(t.alertRuns).values({ workspaceId, ruleId, hits });
  }

  async remove(ruleId: string): Promise<void> {
    await this.db.delete(t.alertRules).where(eq(t.alertRules.id, ruleId));
  }
}

function toDto(row: typeof t.alertRules.$inferSelect): AlertRule {
  return {
    id: row.id,
    name: row.name,
    severity: row.severity,
    path_glob: row.pathGlob,
    created_at: row.createdAt.toISOString(),
  };
}
