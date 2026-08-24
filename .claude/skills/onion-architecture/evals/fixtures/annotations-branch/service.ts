import type { Annotation, AnnotationInput, AttachmentRecord } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { AnnotationsRepository } from './repository.js';
import { sanitizeFileName, isAllowedContentType } from './helpers.js';
import { MAX_ATTACHMENTS_PER_REVIEW, MAX_ATTACHMENT_BYTES } from './constants.js';

/**
 * L06 — review annotations.
 *
 * One note per review, written by a human after reading the agent's verdict.
 * The note is what turns a disagreement into a record: six weeks later nobody
 * remembers why the team merged a PR the agent wanted changed, and the note is
 * the only place that answer survives.
 */
export class AnnotationsService {
  private repo: AnnotationsRepository;

  constructor(private container: Container) {
    this.repo = new AnnotationsRepository(container.db);
  }

  async upsert(
    workspaceId: string,
    userId: string,
    reviewId: string,
    input: AnnotationInput,
  ): Promise<Annotation> {
    const review = await this.repo.getReview(workspaceId, reviewId);
    if (!review) throw new NotFoundError('Review not found');

    const text = input.text.trim();
    if (text.length === 0) throw new AppError('empty_annotation', 'Annotation is empty', 422);

    return this.repo.saveAnnotation(workspaceId, reviewId, {
      text,
      authorId: userId,
      annotatedAt: new Date(),
    });
  }

  async get(workspaceId: string, reviewId: string): Promise<Annotation | null> {
    return this.repo.getAnnotation(workspaceId, reviewId);
  }

  async attach(
    workspaceId: string,
    reviewId: string,
    file: { name: string; contentType: string; bytes: number; storageKey: string },
  ): Promise<AttachmentRecord> {
    if (!isAllowedContentType(file.contentType)) {
      throw new AppError('unsupported_type', `Cannot attach ${file.contentType}`, 422);
    }
    if (file.bytes > MAX_ATTACHMENT_BYTES) {
      throw new AppError('attachment_too_large', 'Attachment exceeds the size limit', 413);
    }

    const existing = await this.repo.listAttachments(workspaceId, reviewId);
    if (existing.length >= MAX_ATTACHMENTS_PER_REVIEW) {
      throw new AppError('too_many_attachments', 'This review already has the maximum', 409);
    }

    return this.repo.insertAttachment(workspaceId, {
      reviewId,
      fileName: sanitizeFileName(file.name),
      contentType: file.contentType,
      byteSize: file.bytes,
      storageKey: file.storageKey,
    });
  }

  async removeAnnotation(workspaceId: string, reviewId: string): Promise<void> {
    const annotation = await this.repo.getAnnotation(workspaceId, reviewId);
    if (!annotation) throw new NotFoundError('Review has no annotation');

    await this.repo.clearAnnotation(workspaceId, reviewId);
  }

  async listAttachments(workspaceId: string, reviewId: string): Promise<AttachmentRecord[]> {
    return this.repo.listAttachments(workspaceId, reviewId);
  }
}
