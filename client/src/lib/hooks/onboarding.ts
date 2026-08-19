/* hooks/onboarding.ts — React Query hooks for the SPEC-03 onboarding tour:
     GET  /repos/:id/onboarding          → cached tour, empty state, or skeleton
     POST /repos/:id/onboarding/generate → exactly one model call, full rewrite

   Mirrors hooks/conventions.ts: a mutation that rewrites a single wire object,
   not a list. The generate response is written straight into the query cache
   (`setQueryData`) so a `status: 'skeleton'` result renders immediately — the
   stored tour is unchanged server-side on that branch (AC-26), so there is
   nothing a refetch would add. `invalidateQueries` still runs after, so a
   `status: 'ready'` result also picks up whatever the server actually
   persisted rather than trusting the mutation response to be byte-identical
   to it. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import type { Onboarding } from "@devdigest/shared";
import { api } from "../api";

/**
 * POST /repos/:id/onboarding/generate request body. Request-only — never part
 * of the `Onboarding` wire contract, so it does NOT live in `@devdigest/shared`
 * (server keeps the canonical `OnboardingGenerateBody` zod schema next to the
 * route). `locale` is optional on the wire, but this hook always supplies it
 * (A7) rather than sending a body-less POST.
 */
interface OnboardingGenerateBody {
  locale: string;
}

/** GET /repos/:id/onboarding → the stored tour, the empty state
    (`generated_at: null`), or a deterministic skeleton — never triggers a
    model call (AC-3, AC-5). */
export function useOnboardingTour(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["onboarding", repoId],
    queryFn: () => api.get<Onboarding>(`/repos/${repoId}/onboarding`),
    enabled: !!repoId,
  });
}

/**
 * POST /repos/:id/onboarding/generate → exactly one structured model call,
 * full rewrite of the stored tour (AC-4). Always sends `{ locale }` from the
 * active UI locale (A7) so the server always has a language to write the tour
 * in, falling back to `en` server-side when there is none.
 *
 * On success the response IS the new cached read: `setQueryData` first so a
 * `status: 'skeleton'` result (AC-26 — the previously stored tour is left
 * untouched server-side, but this call's own reason must show) renders
 * immediately without an extra round trip. `invalidateQueries` still follows,
 * because `status: 'ready'` responses should refetch to pick up whatever the
 * server actually persisted (byte-identical in practice, but the response is
 * not treated as automatically authoritative — see the module doc above).
 */
export function useGenerateOnboardingTour(repoId: string | null | undefined) {
  const qc = useQueryClient();
  const locale = useLocale();
  return useMutation({
    mutationFn: () =>
      api.post<Onboarding>(`/repos/${repoId}/onboarding/generate`, {
        locale,
      } satisfies OnboardingGenerateBody),
    onSuccess: (data) => {
      qc.setQueryData(["onboarding", repoId], data);
      qc.invalidateQueries({ queryKey: ["onboarding", repoId] });
    },
  });
}
