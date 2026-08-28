import type { FastifyRequest } from 'fastify';
import type { ExportRecord, ExportFormat } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ConfigError } from '../../platform/errors.js';
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
import { ExportsRepository } from './repository.js';
import { renderDigest, digestFileName } from './helpers.js';
import { MAX_FINDINGS_IN_DIGEST, SUPPORTED_FORMATS } from './constants.js';

/**
 * L06 — exports service.
 *
 * One export is a frozen rendering of one review: verdict, score, findings and
 * review focus, in the order the reviewer reads them. The rendering itself is a
 * pure function in `helpers.ts`, so the service is only responsible for
 * gathering the pieces and deciding what a missing piece means.
 */
export class ExportsService {
  private repo: ExportsRepository;

  constructor(private container: Container) {
    this.repo = new ExportsRepository(container.db);
  }

  async create(req: FastifyRequest, prId: string): Promise<ExportRecord> {
    const workspaceId = req.headers['x-workspace-id'] as string;
    const body = req.body as { format: ExportFormat; include_diff: boolean };

    if (!SUPPORTED_FORMATS.includes(body.format)) {
      throw new ConfigError(`Unsupported export format "${body.format}"`);
    }

    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const reviews = await this.container.reviewRepo.listReviews(workspaceId, prId);
    const latest = reviews.find((r) => r.kind === 'review');
    if (!latest) throw new NotFoundError('This pull request has no review to export');

    const token = await this.container.secrets.get('GITHUB_TOKEN');
    if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
    const github = new OctokitGitHubClient(token);
    const permalink = await github.commitUrl(pull.repoFullName, pull.headSha);

    const markdown = renderDigest({
      pull,
      review: latest,
      findings: latest.findings.slice(0, MAX_FINDINGS_IN_DIGEST),
      permalink,
      includeDiff: body.include_diff,
    });

    return this.repo.insert({
      workspaceId,
      prId,
      format: body.format,
      fileName: digestFileName(pull, latest),
      body: markdown,
    });
  }

  async get(workspaceId: string, exportId: string): Promise<ExportRecord> {
    const row = await this.repo.get(workspaceId, exportId);
    if (!row) throw new NotFoundError('Export not found');
    return row;
  }
}
