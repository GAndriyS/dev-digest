import { realpath } from 'node:fs/promises';
import type { Container } from '../../platform/container.js';
import type { Intent, IntentSource, PrIntentRecord, UnifiedDiff } from '@devdigest/shared';
import { Intent as IntentSchema } from '@devdigest/shared';
import { assemblePrompt } from '../../platform/prompt.js';
import { RunLogger } from '../../platform/run-logger.js';
import { NotFoundError } from '../../platform/errors.js';
import * as schema from '../../db/schema.js';
import type { ReviewRepository, PullRow } from './repository.js';
import { readInsideClone } from '../_shared/clone-fs.js';
import {
  INTENT_MAX_RETRIES,
  INTENT_SYSTEM_PROMPT,
  MAX_ISSUE_BODY_CHARS,
  MAX_REPO_FILE_BYTES,
} from './constants.js';
import { resolveFeatureModel } from '../settings/index.js';
import { externalLinkRefs, hunkHeaderDigest, linkedIssueNumber, repoMarkdownRefs } from './intent-inputs.js';

/**
 * L03 — the intent classifier. A one-shot model call, run once per PR before
 * the per-agent review fan-out (`run-executor.ts`), so every agent's task
 * line can carry the same derived intent.
 *
 * Deliberately does NOT send the diff's patch body — only a file list + hunk
 * headers (`hunkHeaderDigest`). Everything it reads is untrusted, wrapped
 * through `assemblePrompt`'s `specs` slot (issue + repo-file blocks) or the
 * `diff` slot (the header digest); the shared `INJECTION_GUARD` already names
 * "derived intent/scope" (`reviewer-core/src/prompt.ts:16-18`).
 */
export async function deriveIntent(
  container: Container,
  repo: ReviewRepository,
  workspaceId: string,
  pull: PullRow,
  repoRow: typeof schema.repos.$inferSelect,
  diff: UnifiedDiff,
  log?: RunLogger,
): Promise<Intent> {
  const { provider, model } = await resolveFeatureModel(container, workspaceId, 'review_intent');
  const llm = await container.llm(provider);

  const sources: IntentSource[] = [];
  const specs: string[] = [];

  // ---- PR title + description --------------------------------------------
  // Not fetched — it's already on the row — so it's always "used" when present.
  if (pull.body && pull.body.trim().length > 0) {
    sources.push({ type: 'description', status: 'used' });
  }

  // ---- Linked GitHub issue (correction 1: via the port, never the private
  // Octokit method) -----------------------------------------------------
  const issueNum = linkedIssueNumber(pull.body);
  if (issueNum !== undefined) {
    const ref = `#${issueNum}`;
    try {
      const github = await container.github();
      const issue = await github.getIssue({ owner: repoRow.owner, name: repoRow.name }, issueNum);
      const body = (issue.body ?? '').slice(0, MAX_ISSUE_BODY_CHARS);
      specs.push(`Linked issue #${issueNum} "${issue.title}" (${issue.state}):\n${body}`);
      sources.push({ type: 'linked_issue', ref, status: 'used' });
    } catch (err) {
      sources.push({ type: 'linked_issue', ref, status: 'unavailable' });
      log?.info(`Intent: linked issue ${ref} unavailable — ${(err as Error).message}`);
    }
  }

  // ---- Repo-local *.md files referenced from the PR body (correction 2/3:
  // read ONLY through the Step-5 guarded reader, never GitClient.readFile) --
  const mdRefs = repoMarkdownRefs(pull.body);
  if (mdRefs.length > 0) {
    // Open question 2: no port exists to read a clone at an arbitrary ref, so
    // this reads the WORKING TREE — never claimed as "at head" in sources[].
    // `head_sha` is still stored from `pull.headSha` for the staleness badge.
    const root = repoRow.clonePath ? await realpath(repoRow.clonePath).catch(() => null) : null;
    for (const ref of mdRefs) {
      const content = root ? await readInsideClone(root, ref, MAX_REPO_FILE_BYTES) : null;
      if (content !== null && content.trim().length > 0) {
        specs.push(`File "${ref}" referenced from the PR body (working tree, not necessarily at head):\n${content}`);
        sources.push({ type: 'repo_file', ref, status: 'used' });
      } else {
        sources.push({ type: 'repo_file', ref, status: 'unavailable' });
      }
    }
  }

  // ---- External http(s) links — never fetched ------------------------------
  // IntentSource has no dedicated "external link" variant (Step 1 locked the
  // three-way `type` enum): recorded as an unreachable `repo_file` — same
  // semantic (a referenced document), just one this branch deliberately never
  // fetches, per Open question 1.
  for (const ref of externalLinkRefs(pull.body)) {
    sources.push({ type: 'repo_file', ref, status: 'unavailable' });
  }

  // One line per source — type, ref, status — never a file's contents, a
  // patch body, or a secret, so a low-confidence classification can be
  // explained from the run log alone (the aggregate line below is a summary,
  // not a substitute: it can't say WHICH source was unavailable).
  for (const s of sources) {
    log?.info(`Intent source: ${s.type}${s.ref ? ` ${s.ref}` : ''} — ${s.status}`);
  }

  const usedCount = sources.filter((s) => s.status === 'used').length;
  const unavailableCount = sources.length - usedCount;
  log?.tool(
    `Intent: requesting ${provider}/${model} — ${sources.length} source(s) ` +
      `(${usedCount} used, ${unavailableCount} unavailable)`,
  );

  const diffDigest = hunkHeaderDigest(diff);
  const { messages } = assemblePrompt({
    system: INTENT_SYSTEM_PROMPT,
    ...(specs.length > 0 ? { specs } : {}),
    ...(pull.body ? { prDescription: pull.body } : {}),
    // Self-describing first line (Open question 3): this is the ONLY diff
    // content the classifier ever sees — file list + hunk headers, never a
    // patch body (the whole point of this redesign; see Step-6a).
    diff: `File list with hunk headers only — no patch bodies:\n${diffDigest}`,
    task: `Classify pull request #${pull.number} "${pull.title}" by ${pull.author}.`,
  });

  const res = await llm.completeStructured<Intent>({
    model,
    schema: IntentSchema,
    schemaName: 'Intent',
    messages,
    maxRetries: INTENT_MAX_RETRIES,
  });

  // NOTE: intent is author/repo-influenced (the LLM reads untrusted PR text,
  // an untrusted linked issue, and untrusted repo files), so it is NEVER
  // trusted as a directive downstream — it's rendered to the reviewer as an
  // <untrusted> block (`taskLine`), and an out-of-scope finding is DROPPED
  // unless it's CRITICAL or its category is security/bug — those always
  // survive (`flagOutOfScope`). Persisted as-is, no keyword scrubbing.
  log?.result(
    `Intent: ${res.data.risk_areas.length} risk area(s), confidence ${res.data.confidence.toFixed(2)}, ` +
      `diff digest ${diffDigest.length} chars, description ${(pull.body ?? '').length} chars ` +
      `(${res.tokensIn}→${res.tokensOut} tokens, $${(res.costUsd ?? 0).toFixed(4)})`,
  );

  await repo.upsertIntent(pull.id, {
    ...res.data,
    model,
    headSha: pull.headSha,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    costUsd: res.costUsd,
  });

  return res.data;
}

/** Persisted intent for a PR, or `null` for "no intent derived yet" — 404s
 *  only when the PR itself doesn't exist. */
export async function getIntent(
  repo: ReviewRepository,
  workspaceId: string,
  prId: string,
): Promise<PrIntentRecord | null> {
  const pull = await repo.getPull(workspaceId, prId);
  if (!pull) throw new NotFoundError('Pull request not found');
  const intent = await repo.getIntent(prId);
  return intent ?? null;
}
