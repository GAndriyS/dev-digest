import type { Container } from '../../platform/container.js';
import type { UnifiedDiff } from '@devdigest/shared';
import { parseUnifiedDiff, unifiedDiffFromPatches } from '../../adapters/git/diff-parser.js';
import * as schema from '../../db/schema.js';
import type { ReviewRepository, PullRow } from './repository.js';

/**
 * Load the unified diff for a PR. Prefers a real `git diff base...head`; falls
 * back to assembling a synthetic unified diff from the persisted pr_files
 * patches (so the reviewer works even before a clone completes / in tests).
 */
export async function loadDiff(
  container: Container,
  repo: ReviewRepository,
  workspaceId: string,
  pull: PullRow,
  repoRow: typeof schema.repos.$inferSelect,
): Promise<UnifiedDiff> {
  try {
    const diff = await container.git.diff(
      { owner: repoRow.owner, name: repoRow.name },
      pull.base,
      pull.headSha,
    );
    if (diff.files.length > 0) return diff;
  } catch {
    /* fall through to pr_files reconstruction */
  }
  return diffFromPrFiles(repo, pull.id);
}

/**
 * Reconstruct a UnifiedDiff from persisted pr_files patches.
 *
 * The header reconstruction lives in `unifiedDiffFromPatches` rather than
 * inline here: the eval runner replays a stored `pr_files.patch` too, and when
 * this was the only copy that path silently skipped it — every finding then
 * failed the grounding gate as uncited.
 */
export async function diffFromPrFiles(repo: ReviewRepository, prId: string): Promise<UnifiedDiff> {
  const files = await repo.getPrFiles(prId);
  return parseUnifiedDiff(unifiedDiffFromPatches(files));
}
