/* hooks/brief.ts — React Query hooks for the PR Why + Risk Brief (SPEC-04):
     GET  /pulls/:id/brief  → the stored brief, or `null` before the first
                              generation — never a 404, never a model call.
     POST /pulls/:id/brief  → exactly one structured model call, full
                              rewrite of the stored brief.

   Mirrors hooks/onboarding.ts: a mutation that rewrites a single wire
   object, not a list, with the response written straight into the query
   cache. `score` is deliberately NOT read here — its single source of truth
   is `reviews.score` (hooks/reviews.ts `usePrReviews`), read independently
   by the card so regenerating the brief never moves the score (AC-53). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PrWhyBrief } from "@devdigest/shared";
import { api } from "../api";

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
