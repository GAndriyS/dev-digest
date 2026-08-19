/* use-media-query.ts — SSR-safe media query hook.

   The server render (and the first client render, before hydration) always
   reports "does not match" so the initial markup is identical on both sides;
   the effect then subscribes to the real matchMedia list and updates on
   change. For the one caller this exists for today — AC-26's narrow-viewport
   query, `NARROW_QUERY = "(max-width: 1023px)"`, read as `isNarrow` — a fixed
   "does not match" default reads as "assume the wide layout": a safe guess
   because the wide layout is the common case and, unlike the narrow one, does
   not need a "back to list" affordance to be usable. That reading only holds
   for THIS caller's max-width query; a min-width query would need the
   opposite default, which is why this stays a fixed constant rather than a
   parameter until a second caller actually needs the other direction.

   Environments without window.matchMedia (older embedded webviews, and any
   test that has not stubbed it) simply keep that default and never
   subscribe. */
"use client";

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mql = window.matchMedia(query);
    setMatches(mql.matches);

    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, [query]);

  return matches;
}
