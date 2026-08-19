/**
 * Extracts `:id` from a `/skills/:id` pathname; `null` on `/skills` itself and
 * on anything else. Read via `usePathname()` rather than `useParams()` — this
 * layout owns the `/skills` segment, not the child `[id]` segment, so
 * `useParams()` here would never see it (the same reasoning `repo-context.tsx`
 * documents for `:repoId`).
 *
 * `decodeURIComponent` throws `URIError` on a malformed percent-escape (e.g.
 * `/skills/%E0%A4%A`) — this call runs while the *layout* renders, so an
 * uncaught throw here would take the list, search and chrome down with it.
 * `null` degrades the caller to the same "no id resolved" path as `/skills`
 * itself, which — with an id that will never match a real skill — lands on
 * the detail column's `Skill not found` state (AC-5) instead.
 */
export function skillIdFromPathname(pathname: string | null): string | null {
  if (!pathname) return null;
  const match = /^\/skills\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

/**
 * Builds `/skills/:id?tab=:tab` from a single `URLSearchParams`. Never build
 * this with two sequential `router.push`/`setParam` calls — each would close
 * over the same `useSearchParams()` snapshot and the second overwrites the
 * first (`client/INSIGHTS.md`, 2026-08-11).
 */
export function skillHref(id: string, tab: string): string {
  const sp = new URLSearchParams();
  sp.set("tab", tab);
  return `/skills/${id}?${sp.toString()}`;
}
