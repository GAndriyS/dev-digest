/**
 * Negative cache for repos GitHub answers 404 for.
 *
 * The PR list is polled once a minute per open tab, and it syncs from GitHub on
 * every read. When the repo is not reachable — deleted, renamed, private to
 * this token, or seeded fixture data like `acme/payments-api` that never
 * existed — that sync 404s every single time, and each miss costs a rate-limit
 * unit (two, with Octokit's retry) plus a multi-KB error log, forever. Nothing
 * about the answer changes minute to minute, so remember it.
 *
 * Deliberately in-memory and TTL'd rather than a column on `repos`: a 404 is a
 * fact about right now (grant a token access and it flips), so it should not
 * outlive the process, and it must expire on its own without anyone clearing a
 * flag. A restart re-probing once per repo is the correct cost.
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class GitHubRepoAvailability {
  private missingUntil = new Map<string, number>();

  constructor(
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** True while a recent 404 for this repo is still cached. */
  isKnownMissing(repoId: string): boolean {
    const until = this.missingUntil.get(repoId);
    if (until == null) return false;
    if (this.now() >= until) {
      this.missingUntil.delete(repoId);
      return false;
    }
    return true;
  }

  /** Record that GitHub 404'd for this repo; suppresses calls for the TTL. */
  markMissing(repoId: string): void {
    this.missingUntil.set(repoId, this.now() + this.ttlMs);
  }

  /** Record a successful call — clears any cached 404 immediately. */
  markPresent(repoId: string): void {
    this.missingUntil.delete(repoId);
  }
}

/** Process-wide instance used by the pulls routes. */
export const githubRepoAvailability = new GitHubRepoAvailability();
