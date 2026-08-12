import type { UnifiedDiff } from '@devdigest/shared';

/**
 * L03 — pure input builders for the intent classifier. No I/O, no container:
 * side-effect free, taking only plain values so they are cheaply unit-tested
 * (the risk they exist to guard against — a patch body leaking into the
 * classifier prompt — is the whole point of this redesign).
 */

/** Cap on how many repo-relative `*.md` refs are extracted from a PR body. */
export const MAX_REPO_MD_REFS = 5;

/** Cap on how many external http(s) links are extracted (for provenance only — never fetched). */
export const MAX_EXTERNAL_URL_REFS = 5;

/**
 * A file-list + hunk-header digest of a diff — NEVER `diff.raw` and NEVER a
 * `+`/`-` content line. This is the entire point of the redesign: the old
 * (`15fa391^`) intent pass sent the whole patch body to the classifier model;
 * this one sends only what file changed and where, reconstructed from the
 * parsed hunks (`adapters/git/diff-parser.ts`).
 */
export function hunkHeaderDigest(diff: UnifiedDiff): string {
  const lines: string[] = [];
  for (const file of diff.files) {
    lines.push(file.path);
    for (const hunk of file.hunks) {
      lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    }
  }
  return lines.join('\n');
}

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

/** A path-shaped token ending in `.md`, loose enough to catch bare mentions
 *  and markdown-link destinations alike; filtering below does the real work. */
const MD_REF_RE = /[^\s()<>[\]"'`]+\.md\b/gi;

/**
 * Repo-relative `*.md` paths referenced from a PR body — never an absolute
 * path, a `~`-relative path, a path containing `..` (defense in depth; the
 * Step-5 guarded reader also catches an escape via symlink), or anything with
 * a URL scheme. Deduplicated, capped at `max`. Empty/absent body → `[]`.
 */
export function repoMarkdownRefs(body: string | null | undefined, max = MAX_REPO_MD_REFS): string[] {
  if (!body) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of body.match(MD_REF_RE) ?? []) {
    const path = raw.trim();
    if (path.length === 0) continue;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(path)) continue; // scheme (http://, ftp://…)
    if (path.startsWith('/') || path.startsWith('\\')) continue; // POSIX/Windows absolute
    if (/^[a-zA-Z]:[\\/]/.test(path)) continue; // Windows drive-letter absolute
    if (path.startsWith('~')) continue;
    if (path.split(/[\\/]/).includes('..')) continue; // no directory traversal
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
    if (out.length >= max) break;
  }
  return out;
}

const URL_RE = /\bhttps?:\/\/[^\s()<>[\]"'`]+/gi;

/**
 * External http(s) URLs mentioned in a PR body — extraction only, never
 * fetched (Open question 1: recorded in `sources[]` as `unavailable`, lowers
 * confidence, and the content is never invented). Deduplicated, capped.
 */
export function externalLinkRefs(body: string | null | undefined, max = MAX_EXTERNAL_URL_REFS): string[] {
  if (!body) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of body.match(URL_RE) ?? []) {
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length >= max) break;
  }
  return out;
}
