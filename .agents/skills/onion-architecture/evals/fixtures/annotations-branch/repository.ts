import { and, desc, eq } from 'drizzle-orm';
import type { Annotation, AttachmentRecord } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export interface AnnotationPatch {
  text: string;
  authorId: string;
  annotatedAt: Date;
}

export interface InsertAttachment {
  reviewId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  storageKey: string;
}

/** Reads and writes the annotation columns on `reviews`, plus its attachments. */
export class AnnotationsRepository {
  constructor(private db: Db) {}

  async getReview(workspaceId: string, reviewId: string) {
    const [row] = await this.db
      .select({ id: t.reviews.id, prId: t.reviews.prId })
      .from(t.reviews)
      .where(and(eq(t.reviews.workspaceId, workspaceId), eq(t.reviews.id, reviewId)))
      .limit(1);

    return row ?? null;
  }

  async saveAnnotation(
    workspaceId: string,
    reviewId: string,
    patch: AnnotationPatch,
  ): Promise<Annotation> {
    const [row] = await this.db
      .update(t.reviews)
      .set({
        annotationText: patch.text,
        annotationAuthorId: patch.authorId,
        annotatedAt: patch.annotatedAt,
      })
      .where(and(eq(t.reviews.workspaceId, workspaceId), eq(t.reviews.id, reviewId)))
      .returning();

    return toAnnotation(row!);
  }

  async getAnnotation(workspaceId: string, reviewId: string): Promise<Annotation | null> {
    const [row] = await this.db
      .select()
      .from(t.reviews)
      .where(and(eq(t.reviews.workspaceId, workspaceId), eq(t.reviews.id, reviewId)))
      .limit(1);

    if (!row || row.annotationText == null) return null;
    return toAnnotation(row);
  }

  async clearAnnotation(workspaceId: string, reviewId: string): Promise<void> {
    await this.db
      .update(t.reviews)
      .set({ annotationText: null, annotationAuthorId: null, annotatedAt: null })
      .where(and(eq(t.reviews.workspaceId, workspaceId), eq(t.reviews.id, reviewId)));
  }

  async insertAttachment(workspaceId: string, row: InsertAttachment): Promise<AttachmentRecord> {
    const [inserted] = await this.db
      .insert(t.annotationAttachments)
      .values({ ...row, workspaceId })
      .returning();

    return toAttachment(inserted!);
  }

  async listAttachments(workspaceId: string, reviewId: string): Promise<AttachmentRecord[]> {
    const rows = await this.db
      .select()
      .from(t.annotationAttachments)
      .where(
        and(
          eq(t.annotationAttachments.workspaceId, workspaceId),
          eq(t.annotationAttachments.reviewId, reviewId),
        ),
      )
      .orderBy(desc(t.annotationAttachments.createdAt));

    return rows.map(toAttachment);
  }

  async deleteAttachment(attachmentId: string): Promise<void> {
    await this.db
      .delete(t.annotationAttachments)
      .where(eq(t.annotationAttachments.id, attachmentId));
  }
}

function toAnnotation(row: typeof t.reviews.$inferSelect): Annotation {
  return {
    review_id: row.id,
    text: row.annotationText ?? '',
    author_id: row.annotationAuthorId,
    annotated_at: row.annotatedAt?.toISOString() ?? null,
  };
}

function toAttachment(row: typeof t.annotationAttachments.$inferSelect): AttachmentRecord {
  return {
    id: row.id,
    review_id: row.reviewId,
    file_name: row.fileName,
    content_type: row.contentType,
    byte_size: row.byteSize,
    created_at: row.createdAt.toISOString(),
  };
}
