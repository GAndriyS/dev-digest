import type { Container } from '../../platform/container.js';
import type { SmartDiff } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { buildSmartDiff, type SmartDiffInputFile } from './helpers.js';

/**
 * Smart Diff service (L03). Deterministic file-risk ordering: combines the
 * already-imported `pr_files` with the findings of every `kind:'review'`
 * run. No LLM call, no GitHub reach-out — `GET /pulls/:id` is what
 * refreshes `pr_files` (`pulls/routes.ts:249-258`); this endpoint reads
 * whatever is already persisted.
 *
 * Data access goes through `container.reviewRepo` (the sanctioned
 * cross-module seam, `platform/container.ts:101`) rather than a new
 * repository — `pr_files`/`reviews`/`findings` already hold everything this
 * endpoint needs, and there is no new SQL to own.
 */
export class SmartDiffService {
  private repo: Container['reviewRepo'];

  constructor(container: Container) {
    this.repo = container.reviewRepo;
  }

  /**
   * `getPull` is the only tenancy gate — `pr_files` carries no
   * `workspace_id` of its own (`db/schema/pulls.ts:36-45`), so scoping
   * happens through the PR row. No review yet → every file gets
   * `finding_lines: []`; ordering (role, then additions+deletions, then
   * path) still holds.
   */
  async getSmartDiff(workspaceId: string, prId: string): Promise<SmartDiff> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const [files, findingsByPath] = await Promise.all([
      this.repo.getPrFiles(prId),
      this.reviewFindings(prId),
    ]);

    const input: SmartDiffInputFile[] = files.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
    }));
    return buildSmartDiff(input, findingsByPath);
  }

  /**
   * Findings from EVERY `kind:'review'` run, grouped by file path, dismissed
   * ones excluded. `buildSmartDiff` dedupes and sorts, so a line two agents
   * both flagged is one entry.
   *
   * Across all runs rather than the latest, because that is the rule the PR
   * list's own findings column already uses and states — every review, unlike
   * `score`, which is deliberately the latest only (`pulls/routes.ts:174-177`).
   * A badge that disagrees with the counter the reader clicked through from is
   * the bug; a re-run that legitimately found nothing does not erase the lines
   * an earlier run flagged.
   *
   * Dismissed stay out because these lines are an attention signal, not a
   * tally: the same split `ReviewRunAccordion.tsx:59` makes for its blocker
   * count, while `RunHistory/helpers.ts` counts dismissed in like
   * `findings_count` does.
   */
  private async reviewFindings(prId: string): Promise<Map<string, number[]>> {
    const rows = await this.repo.reviewsForPull(prId);
    const byPath = new Map<string, number[]>();
    for (const { review, findings } of rows) {
      if (review.kind !== 'review') continue;
      for (const finding of findings) {
        if (finding.dismissedAt != null) continue;
        const lines = byPath.get(finding.file) ?? [];
        lines.push(finding.startLine);
        byPath.set(finding.file, lines);
      }
    }
    return byPath;
  }
}
