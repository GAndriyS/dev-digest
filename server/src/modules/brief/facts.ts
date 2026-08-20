import type { BriefInput } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { PullRow } from '../../db/rows.js';
import { linkedIssueNumber } from '../_shared/linked-issue.js';
import {
  MAX_BRIEF_CONTEXT_CHARS,
  MAX_BRIEF_CONTEXT_DOCS,
  MAX_BRIEF_CONTEXT_DOC_DROPPED_INPUTS,
} from './constants.js';
import { diffFactsFromPrFiles, relevantContextDocs } from './helpers.js';
import type { BriefFacts, ContextDocFacts, LinkedIssueFacts } from './types.js';

/**
 * PR Why + Risk Brief — fact collection (AC-6). Reads exactly the five
 * sources the spec names, through the container (never another module's
 * `service.ts`): `container.reviewRepo` (intent, `pr_files`),
 * `container.blast`, `container.github`, `container.projectContext`. Every
 * source degrades to `unavailable` in `inputs` rather than failing the whole
 * generation (AC-8, AC-9, AC-10, AC-13) — the ONLY thing this function
 * throws on is `getPull` returning nothing, and that is the caller's job
 * (tenancy), not this function's.
 */
export async function collectBriefFacts(
  container: Container,
  workspaceId: string,
  pull: PullRow,
): Promise<BriefFacts> {
  const inputs: BriefInput[] = [];

  // ---- intent (AC-8) ----
  const intentRecord = await container.reviewRepo.getIntent(pull.id);
  inputs.push({ type: 'intent', ref: null, status: intentRecord ? 'used' : 'unavailable' });

  // ---- blast (AC-9) ----
  const blast = await container.blast.getBlast(workspaceId, pull.id);
  inputs.push({
    type: 'blast',
    ref: blast.indexed_sha,
    // `full` is the only status that reads as `used` on the wire — `partial`
    // and `degraded` are the one variant where those statuses are legal
    // (contract, `vendor/shared/contracts/brief.ts`).
    status: blast.status === 'full' ? 'used' : blast.status,
  });

  // ---- diff (AC-7, EC-6) ----
  const prFiles = await container.reviewRepo.getPrFiles(pull.id);
  const diffFiles = diffFactsFromPrFiles(prFiles);
  // `pr_files` is populated as a side effect of `GET /pulls/:id`, not on
  // import (`server/INSIGHTS.md:106-114`) — a PR nobody has opened yet has
  // none, and that is a named gap, not a silent empty diff.
  inputs.push({ type: 'diff', ref: null, status: diffFiles.length > 0 ? 'used' : 'unavailable' });

  // ---- linked issue (AC-10) ----
  const issueNumber = linkedIssueNumber(pull.body);
  let linkedIssue: LinkedIssueFacts | null = null;
  if (issueNumber !== undefined) {
    try {
      const repo = await container.reviewRepo.getRepo(pull.repoId);
      if (!repo) throw new Error('repo not found');
      const github = await container.github();
      const issue = await github.getIssue({ owner: repo.owner, name: repo.name }, issueNumber);
      linkedIssue = { number: issue.number, title: issue.title, body: issue.body ?? null };
    } catch {
      // No linked issue, no GITHUB_TOKEN configured, or the API call failed —
      // all the same outcome here: continue without it (AC-10).
      linkedIssue = null;
    }
  }
  inputs.push({
    type: 'linked_issue',
    ref: issueNumber !== undefined ? `#${issueNumber}` : null,
    status: linkedIssue ? 'used' : 'unavailable',
  });

  // ---- Project Context docs (AC-11, AC-12, AC-13) ----
  const changedPaths = diffFiles.map((f) => f.path);
  const contextDocs: ContextDocFacts[] = [];
  const contextInputs: BriefInput[] = [];
  try {
    const listing = await container.projectContext.listContext(workspaceId, pull.repoId);
    const relevant = relevantContextDocs(listing.files, changedPaths);
    let usedChars = 0;
    // Individually-listed DROPPED entries only — `used` entries are already
    // bounded by `MAX_BRIEF_CONTEXT_DOCS` above and always get their own
    // entry. `relevant` can run into the hundreds (any leading-segment match
    // counts, `relevantContextDocs`), so listing every drop by name would
    // make `inputs[]` — persisted in `pr_brief.json`, returned on every
    // `GET /pulls/:id/brief`, and written in full into the generation log
    // line (amendment A4) — unbounded. Anything past the bound rolls up into
    // ONE synthetic entry below rather than being omitted, so "documents
    // were dropped" survives even though the individual paths do not
    // (code review fix pass 1, item 3).
    let listedDrops = 0;
    let rolledUpDrops = 0;
    const recordDropped = (path: string) => {
      if (listedDrops < MAX_BRIEF_CONTEXT_DOC_DROPPED_INPUTS) {
        contextInputs.push({ type: 'context_doc', ref: path, status: 'unavailable' });
        listedDrops++;
      } else {
        rolledUpDrops++;
      }
    };
    for (const f of relevant) {
      if (contextDocs.length >= MAX_BRIEF_CONTEXT_DOCS) {
        // Dropped by the count budget — silent to the model, visible in `inputs` (AC-12).
        recordDropped(f.path);
        continue;
      }
      try {
        const doc = await container.projectContext.readDoc(workspaceId, pull.repoId, f.path);
        // `SpecFile.content` is wire-nullable (listing rows carry `null`) even
        // though a single-doc read always populates it — guard rather than trust.
        const content = doc.content ?? '';
        if (usedChars + content.length > MAX_BRIEF_CONTEXT_CHARS) {
          recordDropped(f.path);
          continue;
        }
        contextDocs.push({ path: f.path, content });
        contextInputs.push({ type: 'context_doc', ref: f.path, status: 'used' });
        usedChars += content.length;
      } catch {
        // Unreadable (over the per-doc byte limit, vanished, escapes the clone) — AC-12.
        recordDropped(f.path);
      }
    }
    if (rolledUpDrops > 0) {
      // Bounded shape chosen for item 3: keep every `used` entry plus up to
      // `MAX_BRIEF_CONTEXT_DOC_DROPPED_INPUTS` individually-named drops, then
      // ONE rollup entry carrying the remainder count in `ref` (the wire
      // `BriefInput` shape is frozen — no count field to add). This keeps
      // amendment A4's guarantee intact: "the model found nothing" (zero
      // `context_doc` entries because `relevant` was empty) stays
      // distinguishable from "the source was unavailable" (an `unavailable`
      // entry — individually named or rolled up — is present either way).
      contextInputs.push({
        type: 'context_doc',
        ref: `+${rolledUpDrops} more relevant document(s) dropped, not listed individually`,
        status: 'unavailable',
      });
    }
  } catch {
    // `clone_path = null` (`RepoNotClonedError`), or the repo lookup failed —
    // zero documents, never a throw (AC-13). No `context_doc` entries at all
    // is the honest provenance here: there was nothing to even list.
  }
  inputs.push(...contextInputs);

  return {
    intent: intentRecord ?? null,
    blast,
    diffFiles,
    linkedIssue,
    contextDocs,
    inputs,
  };
}
