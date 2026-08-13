import type { Agent, PrMeta, Repo } from '@devdigest/shared';
import type { ApiClient } from './api-client.js';
import {
  agentNotFoundError,
  prMissingIdError,
  prNotFoundError,
  repoAmbiguousError,
  repoNotFoundError,
} from './errors.js';

/**
 * Resolution seam (plan decision 3): tool arguments are human-friendly
 * strings/numbers, not internal ids. Every miss lists the candidates in the
 * error so the caller's next call is obvious. No cross-call cache — a
 * repo/PR/agent set can change between calls, and staleness here would be a
 * worse bug than the extra round trip.
 */

/** `repo` matches `full_name` ("owner/name") case-insensitively; a bare
 *  `name` also matches when it is unambiguous among imported repos. */
export async function resolveRepo(api: ApiClient, repoArg: string): Promise<Repo> {
  const repos = await api.listRepos();
  const needle = repoArg.trim().toLowerCase();

  const byFullName = repos.find((r) => r.full_name.toLowerCase() === needle);
  if (byFullName) return byFullName;

  const byName = repos.filter((r) => r.name.toLowerCase() === needle);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) {
    throw repoAmbiguousError(
      repoArg,
      byName.map((r) => r.full_name),
    );
  }

  throw repoNotFoundError(
    repoArg,
    repos.map((r) => r.full_name),
  );
}

/** `pr` matches on the GitHub PR `number`. A resolved PR with no internal id
 *  (verified API fact: `PrMeta.id` is nullable) is rejected with an onward
 *  message rather than silently proceeding with `null`. */
export async function resolvePr(
  api: ApiClient,
  repo: Repo,
  prNumber: number,
): Promise<{ pr: PrMeta; prId: string }> {
  const pulls = await api.listPulls(repo.id);
  const pr = pulls.find((p) => p.number === prNumber);
  if (!pr) {
    throw prNotFoundError(
      repo.full_name,
      prNumber,
      pulls.map((p) => p.number),
    );
  }
  if (!pr.id) throw prMissingIdError(repo.full_name, prNumber);
  return { pr, prId: pr.id };
}

/** `agent` matches `name` case-insensitively, falling back to a uuid match. */
export async function resolveAgent(api: ApiClient, agentArg: string): Promise<Agent> {
  const agents = await api.listAgents();
  const needle = agentArg.trim().toLowerCase();

  const byName = agents.find((a) => a.name.toLowerCase() === needle);
  if (byName) return byName;

  const byId = agents.find((a) => a.id === agentArg);
  if (byId) return byId;

  throw agentNotFoundError(
    agentArg,
    agents.map((a) => a.name),
  );
}
