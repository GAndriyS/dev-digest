/* hooks/eval.ts — React Query hooks for the L06 Eval Pipeline: an agent's own
   eval-case set (CRUD, "Turn into eval case" from a finding), running an
   agent's set as a batch, and the Eval Dashboard overview + per-agent read.

   Scoped to `owner_kind: "agent"` throughout — the skill-owned eval surface
   (Skills Lab's own Evals tab, `/skills/:id/eval-cases`, `/eval-cases/:id/run`)
   is `hooks/skills.ts` and is not touched or duplicated here (plan Non-goals:
   two scorers coexist on purpose). Names here are prefixed `Agent*`/on
   `agent-eval-*` cache keys specifically so `export *` from this file and
   `export *` from `./skills` can sit in the same barrel (`hooks/index.ts`)
   without a name collision — `useUpdateEvalCase`/`useDeleteEvalCase` etc.
   already belong to skills.ts.

   409 surfacing (AC-24): the run-batch mutation below does nothing special —
   `api.post` already throws `ApiError` with `.status`/`.code` set from the
   response body on any non-2xx (see `lib/api.ts`), so `mutation.error` is
   already an `ApiError` a component can branch on. `isNoProviderKeyError`
   exists purely so every consumer branches on the same predicate instead of
   re-deriving `error instanceof ApiError && error.status === 409 && …` per
   call site — it mirrors `isNoProviderKey`/`NO_PROVIDER_KEY` in
   `src/app/skills/[id]/_components/SkillEvalRun/{helpers,constants}.ts`
   (same 409 `no_provider_key` code, same `NoProviderKeyError` class server-
   side — `server/src/platform/errors.ts`) without importing across features
   from a component-local folder. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiFetchWithStatus, ApiError } from "../api";
import type {
  AgentEvalBatch,
  EvalCase,
  EvalCaseInput,
  EvalDashboard,
  EvalDashboardOverview,
} from "@devdigest/shared";

/** The 409 code the run-batch (and every other LLM-backed) endpoint answers
    with when no provider key is configured — `server/src/platform/errors.ts`
    `NO_PROVIDER_KEY_CODE`. */
export const NO_PROVIDER_KEY_CODE = "no_provider_key";

/** True when a failed mutation means "no LLM provider key is configured" —
    the predicate components key their disabled Run buttons off (AC-24). */
export function isNoProviderKeyError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === NO_PROVIDER_KEY_CODE;
}

// ---- Agent eval cases (GET/POST /eval-cases, GET/PUT/DELETE /eval-cases/:id) ----

/** An agent's own eval-case set — `owner_kind=agent` is fixed here, the
    repository-side filter (plan step 5) only ever sees this one value from
    this hook. */
export function useAgentEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-eval-cases", agentId],
    queryFn: () =>
      api.get<EvalCase[]>(`/eval-cases?owner_kind=agent&owner_id=${agentId}`),
    enabled: !!agentId,
  });
}

export function useEvalCase(id: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-case", id],
    queryFn: () => api.get<EvalCase>(`/eval-cases/${id}`),
    enabled: !!id,
  });
}

/** Create/update payload for an agent-owned eval case — `owner_kind` is fixed
    by the hook, mirroring `SkillEvalCaseInput` in hooks/skills.ts. */
export type AgentEvalCaseInput = Omit<EvalCaseInput, "owner_kind">;

export function useCreateAgentEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AgentEvalCaseInput) =>
      api.post<EvalCase>("/eval-cases", { ...input, owner_kind: "agent" }),
    onSuccess: (data) =>
      qc.invalidateQueries({ queryKey: ["agent-eval-cases", data.owner_id] }),
  });
}

export interface UpdateAgentEvalCaseInput {
  /** Owning agent — carried so the list query can be invalidated by key. */
  agentId: string;
  id: string;
  patch: Partial<AgentEvalCaseInput>;
}

export function useUpdateAgentEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateAgentEvalCaseInput) =>
      api.put<EvalCase>(`/eval-cases/${id}`, patch),
    onSuccess: (_d, { agentId }) =>
      qc.invalidateQueries({ queryKey: ["agent-eval-cases", agentId] }),
  });
}

export interface DeleteAgentEvalCaseInput {
  agentId: string;
  id: string;
}

export function useDeleteAgentEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeleteAgentEvalCaseInput) =>
      api.del<{ ok: boolean }>(`/eval-cases/${id}`),
    onSuccess: (_d, { agentId }) =>
      qc.invalidateQueries({ queryKey: ["agent-eval-cases", agentId] }),
  });
}

// ---- Turn a finding into an eval case (POST /findings/:id/eval-case) ----

export interface CreateEvalCaseFromFindingResult {
  case: EvalCase;
  /** `true` on 201 (a new case was created), `false` on 200 (a case already
      existed for this finding and is returned as-is) — the status code IS
      the discriminant (AC-6); the body is the same `EvalCase` either way. A
      caller opens the case on both. */
  created: boolean;
}

export function useCreateEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (findingId: string): Promise<CreateEvalCaseFromFindingResult> => {
      const { data, status } = await apiFetchWithStatus<EvalCase>(
        `/findings/${findingId}/eval-case`,
        { method: "POST" }
      );
      return { case: data, created: status === 201 };
    },
    onSuccess: ({ case: evalCase }) =>
      qc.invalidateQueries({ queryKey: ["agent-eval-cases", evalCase.owner_id] }),
  });
}

// ---- Run an agent's eval set as a batch (POST /agents/:id/eval-runs) ----

/** Runs every case of the agent's set, sequentially, server-side (plan step
    8). Returns the aggregated `AgentEvalBatch` (batch record + one
    `EvalCaseResult` per case). 409 `no_provider_key` when the agent's
    provider key is not configured — see `isNoProviderKeyError` above. */
export function useRunAgentEvalBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.post<AgentEvalBatch>(`/agents/${agentId}/eval-runs`),
    onSuccess: (_data, agentId) => {
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-overview"] });
    },
  });
}

// ---- Eval Dashboard (GET /eval/overview, GET /eval/dashboard) ----

/** Every agent with a non-empty eval set + the most recent batches across all
    of them (AC-26, AC-27) — the `/eval` landing page. */
export function useEvalOverview() {
  return useQuery({
    queryKey: ["eval-overview"],
    queryFn: () => api.get<EvalDashboardOverview>("/eval/overview"),
  });
}

/** One agent's dashboard: current metrics + delta, trend, recent batches and
    the regression `alert` (AC-9, AC-30, AC-31) — the `/eval/[agentId]` page
    and the Evals tab's metrics section. */
export function useAgentEvalDashboard(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-eval-dashboard", agentId],
    queryFn: () => api.get<EvalDashboard>(`/eval/dashboard?owner_id=${agentId}`),
    enabled: !!agentId,
  });
}
