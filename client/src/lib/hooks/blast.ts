/* hooks/blast.ts — Blast Radius (L04): what else a PR's diff can touch.
   The map itself is a free read off the repo-intel index; the paragraph that
   explains it is a separate, opt-in model call. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadius } from "@devdigest/shared";

/** Server-computed impact map — no model call, no runtime Zod on the client
    (same convention as `usePrSmartDiff`). `status` says how much of the index
    backed it, so an empty map and an unusable index stay distinguishable. */
export function usePrBlast(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-blast", prId],
    queryFn: () => api.get<BlastRadius>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}

/** The one model call in this feature — explicit, per PR, never on render.
    Cached under the PR so re-opening the tab doesn't spend a second call. */
export function useBlastSummary(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ summary: string }>(`/pulls/${prId}/blast/summary`),
    onSuccess: (data) => {
      qc.setQueryData(["pr-blast-summary", prId], data.summary);
    },
  });
}

/** The last generated paragraph for this PR, if one was generated this session. */
export function useCachedBlastSummary(prId: string | null | undefined): string | undefined {
  const qc = useQueryClient();
  return qc.getQueryData<string>(["pr-blast-summary", prId]);
}
