/* hooks/conventions.ts — React Query hooks for the L03 conventions extractor:
     GET  /repos/:id/conventions          → stored candidates
     POST /repos/:id/conventions/extract  → scan the clone, replace pending rows
     PUT  /conventions/:id                → accept / reject / reword one rule */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ConventionCandidate,
  ConventionExtractResult,
  ConventionPatch,
} from "@devdigest/shared";
import { api } from "../api";

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/**
 * A mutation, not a query: it is a POST that rewrites rows, and pressing
 * Re-scan must actually re-run the scan rather than serve a cached list.
 *
 * The result carries the full list, so it is written straight into the cache —
 * invalidating instead would leave the user staring at the old candidates for
 * one more round trip after a scan that already took several seconds.
 */
export function useExtractConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<ConventionExtractResult>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (data) => {
      qc.setQueryData(["conventions", repoId], data.candidates);
    },
  });
}

/** Accept, reject, or correct one rule. Scoped by repoId only to key the cache. */
export function useUpdateConvention(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ConventionPatch }) =>
      api.put<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: (updated) => {
      qc.setQueryData<ConventionCandidate[]>(["conventions", repoId], (prev) =>
        prev?.map((c) => (c.id === updated.id ? updated : c)),
      );
    },
  });
}
