/**
 * PROMOTED from `modules/reviews/intent-inputs.ts` (pure move, no behaviour
 * change — L05 amendment A2) so `modules/brief/**` can read the same linked-
 * issue number without importing another module's `helpers.ts`/`service.ts`
 * (`no-cross-module-internals`, `.dependency-cruiser.cjs:83-97`).
 * `modules/reviews/intent-inputs.ts` re-exports this under the same name.
 */

/** Same shape as the (private) regex in `adapters/github/octokit.ts:128` — that
 *  method isn't reusable (correction 1: private, and reaching it directly
 *  would trip `no-direct-adapter-clients`), so the pattern is duplicated here. */
const LINKED_ISSUE_RE = /(?:closes|fixes|resolves)?\s*#(\d+)/i;

/** The first `#N` referenced in a PR body (optionally preceded by a closing
 *  keyword), or `undefined` for an absent/empty body or no match. */
export function linkedIssueNumber(body: string | null | undefined): number | undefined {
  if (!body) return undefined;
  const m = body.match(LINKED_ISSUE_RE);
  if (!m?.[1]) return undefined;
  return Number(m[1]);
}
