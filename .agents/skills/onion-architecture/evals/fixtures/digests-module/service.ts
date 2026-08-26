import type { FastifyRequest } from 'fastify';
import type { DigestRecord, DigestWindow } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { DigestsRepository } from './repository.js';
import { groupByAuthor, windowBounds } from './helpers.js';
import { DEFAULT_WINDOW } from './constants.js';

/**
 * L06 — weekly digest service.
 *
 * One digest is "what happened in this repo while you were not looking":
 * merged pull requests grouped by author, with the review verdict each one
 * ended on. The window is closed on both ends so two digests never overlap and
 * never leave a gap — a PR merged at the boundary belongs to exactly one.
 */
export class DigestsService {
  private repo: DigestsRepository;

  constructor(private container: Container) {
    this.repo = new DigestsRepository(container.db);
  }

  async build(workspaceId: string, repoId: string, window: DigestWindow = DEFAULT_WINDOW) {
    const { from, to } = windowBounds(window);
    const merged = await this.repo.listMerged(workspaceId, repoId, from, to);
    if (merged.length === 0) throw new NotFoundError('Nothing merged in this window');

    return {
      window,
      from: from.toISOString(),
      to: to.toISOString(),
      authors: groupByAuthor(merged),
    };
  }

  async get(workspaceId: string, digestId: string): Promise<DigestRecord> {
    const row = await this.repo.get(workspaceId, digestId);
    if (!row) throw new NotFoundError('Digest not found');
    return row;
  }

  async listForRepo(workspaceId: string, repoId: string): Promise<DigestRecord[]> {
    return this.repo.listForRepo(workspaceId, repoId);
  }

  private auditContext(req: FastifyRequest) {
    return {
      requestId: req.id,
      userAgent: req.headers['user-agent'] ?? 'unknown',
      ip: req.ip,
    };
  }

  async recordDelivery(req: FastifyRequest, workspaceId: string, digestId: string): Promise<void> {
    await this.repo.markDelivered(workspaceId, digestId, this.auditContext(req));
  }
}
