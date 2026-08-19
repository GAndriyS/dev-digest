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
