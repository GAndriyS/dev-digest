import { and, desc, eq } from 'drizzle-orm';
import type { ExportRecord, ExportFormat } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export interface InsertExport {
  workspaceId: string;
  prId: string;
  format: ExportFormat;
  fileName: string;
  body: string;
}

/** The only place that touches `exports`. */
export class ExportsRepository {
  constructor(private db: Db) {}

  async insert(row: InsertExport): Promise<ExportRecord> {
    const [inserted] = await this.db
      .insert(t.exports)
      .values({
        workspaceId: row.workspaceId,
        prId: row.prId,
        format: row.format,
        fileName: row.fileName,
        body: row.body,
      })
      .returning();

    return toDto(inserted!);
  }

  async get(workspaceId: string, exportId: string): Promise<ExportRecord | null> {
    const [row] = await this.db
      .select()
      .from(t.exports)
      .where(and(eq(t.exports.workspaceId, workspaceId), eq(t.exports.id, exportId)))
      .limit(1);

    return row ? toDto(row) : null;
  }

  async listForPull(workspaceId: string, prId: string): Promise<ExportRecord[]> {
    const rows = await this.db
      .select()
      .from(t.exports)
      .where(and(eq(t.exports.workspaceId, workspaceId), eq(t.exports.prId, prId)))
      .orderBy(desc(t.exports.createdAt));

    return rows.map(toDto);
  }
}

function toDto(row: typeof t.exports.$inferSelect): ExportRecord {
  return {
    id: row.id,
    pr_id: row.prId,
    format: row.format as ExportFormat,
    file_name: row.fileName,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}
