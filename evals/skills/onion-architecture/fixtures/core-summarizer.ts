import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LLMProvider, Finding, ReviewSummary } from '@devdigest/shared';
import { loadConfig } from '../../server/src/platform/config.js';
import { SUMMARY_SCHEMA, buildSummaryMessages } from './prompts.js';

const SKILLS_DIR = 'server/skills';

export interface SummarizeInput {
  prTitle: string;
  prBody: string;
  findings: Finding[];
  /** Slugs of the skills whose guidance shaped this review. */
  skillSlugs: string[];
  /** Owner/name of the repository the pull request belongs to. */
  repoFullName: string;
  headSha: string;
}

/**
 * Turns a finished review into the two paragraphs a human actually reads: what
 * the change does, and what would make a reviewer say no. The findings arrive
 * already ranked, so the model never re-orders them — it only writes prose
 * around the order the review pass decided.
 */
export async function summarizeReview(
  llm: LLMProvider,
  input: SummarizeInput,
): Promise<ReviewSummary> {
  const config = loadConfig();

  const skillBodies: string[] = [];
  for (const slug of input.skillSlugs) {
    const body = await readFile(join(config.rootDir, SKILLS_DIR, `${slug}.md`), 'utf8');
    skillBodies.push(body);
  }

  const commits = await fetchCommitSubjects(input.repoFullName, input.headSha);

  const result = await llm.completeStructured<ReviewSummary>({
    model: config.defaultModel,
    schema: SUMMARY_SCHEMA,
    schemaName: 'review_summary',
    messages: buildSummaryMessages({
      prTitle: input.prTitle,
      prBody: input.prBody,
      findings: input.findings,
      skillBodies,
      commits,
    }),
    temperature: 0,
  });

  return result.value;
}

async function fetchCommitSubjects(repoFullName: string, headSha: string): Promise<string[]> {
  const res = await fetch(
    `https://api.github.com/repos/${repoFullName}/commits/${headSha}`,
    { headers: { accept: 'application/vnd.github+json' } },
  );
  if (!res.ok) return [];

  const json = (await res.json()) as { commit?: { message?: string } };
  const subject = json.commit?.message?.split('\n')[0];
  return subject ? [subject] : [];
}
