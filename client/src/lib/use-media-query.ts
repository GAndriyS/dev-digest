/* use-media-query.ts — SSR-safe media query hook.

   The server render (and the first client render, before hydration) always
   reports "matches" so the initial markup is identical on both sides; the
   effect then subscribes to the real matchMedia list and updates on change.
   For the one caller this exists for today (AC-26's ≥1024px breakpoint) the
   "always matches" default reads as "assume the wide layout" — a safe guess
   because the wide layout is the common case and, unlike the narrow one, does
   not need a "back to list" affordance to be usable.

   Environments without window.matchMedia (older embedded webviews, and any
   test that has not stubbed it) simply keep that default and never
   subscribe. */
"use client";

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(true);

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
