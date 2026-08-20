/* hooks/brief.ts — React Query hooks for the PR Why + Risk Brief (SPEC-04):
     GET  /pulls/:id/brief  → the stored brief, or `null` before the first
                              generation — never a 404, never a model call.
     POST /pulls/:id/brief  → exactly one structured model call, full
                              rewrite of the stored brief.

   Mirrors hooks/onboarding.ts: a mutation that rewrites a single wire
   object, not a list, with the response written straight into the query
   cache. `score` is deliberately NOT read by `useBrief`/`useGenerateBrief` —
   its single source of truth is `reviews.score` (hooks/reviews.ts
   `usePrReviews`), read independently so regenerating the brief never moves
   the score (AC-53). `usePrBriefSection` below composes all three into the
   one call site the Overview tab uses (AC-62, follow-up 20/08/2026). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PrWhyBrief } from "@devdigest/shared";
import { api } from "../api";
import { usePrReviews } from "./reviews";

/** GET /pulls/:id/brief → the stored brief, or `null` before the first
    generation (AC-2) — never a 404, so this renders an empty state, not an
    error. Never triggers a model call (AC-1). */
export function useBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-brief", prId],
    queryFn: () => api.get<PrWhyBrief | null>(`/pulls/${prId}/brief`),
    enabled: !!prId,
  });
}

/** POST /pulls/:id/brief → exactly one structured model call, full rewrite
    of the stored brief (AC-4) — fired only from an explicit click (the card
    disables the trigger via `isPending`, AC-29), never on render or on a
    head move. No request body: the server resolves the PR from `:id`. The
    response IS the new cached read — `setQueryData` writes it directly
    rather than invalidating, since POST always returns the full, final
    brief (no partial/skeleton state to reconcile, unlike the onboarding
    tour's `status: 'skeleton'`). */
export function useGenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrWhyBrief>(`/pulls/${prId}/brief`),
    onSuccess: (data) => {
      qc.setQueryData(["pr-brief", prId], data);
    },
  });
}

/** The one call site the Overview tab uses to read the brief section (SPEC-04
    follow-up, AC-62): composes `useBrief` + `useGenerateBrief` + `usePrReviews`
    into a single view model instead of each region calling its own hooks —
    two independent `useBrief` calls would still dedupe to one network request
    via the shared React Query cache, but would leave each region with its own
    `isLoading`/`isError`, which is exactly the double-skeleton/double-Retry
    AC-63 and AC-65 forbid. `brief` stays the last successful read while
    `generate` is pending — React Query does not touch query data on a
    mutation's `onSuccess` until it actually resolves — which is what lets
    region 3 keep showing the previous `review_focus[]` during a regenerate
    (AC-66). `score` is read from `usePrReviews` independently of `brief`, so
    regenerating the brief never moves it (AC-53). */
export interface PrBriefSection {
  /** The stored brief, `null` before the first generation, `undefined` while
      the initial GET is still in flight. */
  brief: PrWhyBrief | null | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  /** `reviews.score` of the newest `kind === 'review'` row, or `null` when
      the PR has no review yet (AC-47, AC-54). */
  score: number | null;
  generate: {
    mutate: () => void;
    isPending: boolean;
    isError: boolean;
    error: unknown;
  };
}

export function usePrBriefSection(prId: string | null | undefined): PrBriefSection {
  const { data: brief, isLoading, isError, refetch } = useBrief(prId);
  const generateBrief = useGenerateBrief(prId);
  const { data: reviews } = usePrReviews(prId);
  const latestReview = (reviews ?? []).find((r) => r.kind === "review");
  const score = latestReview?.score ?? null;

  return {
    brief,
    isLoading,
    isError,
    refetch: () => refetch(),
    score,
    generate: {
      mutate: () => generateBrief.mutate(),
      isPending: generateBrief.isPending,
      isError: generateBrief.isError,
      error: generateBrief.error,
    },
  };
}
