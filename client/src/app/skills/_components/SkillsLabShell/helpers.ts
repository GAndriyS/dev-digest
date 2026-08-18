/**
 * Extracts `:id` from a `/skills/:id` pathname; `null` on `/skills` itself and
 * on anything else. Read via `usePathname()` rather than `useParams()` — this
 * layout owns the `/skills` segment, not the child `[id]` segment, so
 * `useParams()` here would never see it (the same reasoning `repo-context.tsx`
 * documents for `:repoId`).
 */
export function skillIdFromPathname(pathname: string | null): string | null {
  if (!pathname) return null;
  const match = /^\/skills\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : null;
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
