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

import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiFetchWithStatus, ApiError } from "../api";
import type {
  AgentEvalBatch,
  AgentVersion,
  EvalCase,
  EvalCaseInput,
  EvalDashboard,
  EvalDashboardOverview,
  EvalRunRecord,
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
    // The only caller (FindingCard) translates `eval_case_no_diff` itself
    // (AC-5), so the app-wide mutation toast must stand down — otherwise one
    // click stacks the raw server message on top of the translated one.
    meta: { ownErrorToast: true },
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

// ---- Run one agent-owned eval case (POST /agents/:id/eval-cases/:caseId/run) ----

export interface RunAgentEvalCaseInput {
  agentId: string;
  caseId: string;
}

/** Runs exactly one case against its owning agent — one model call (AC-63) —
    over the new, agent-scoped path the case editor's `Run case` button and
    its `Run on save` toggle both use (plan step 6:
    `POST /agents/:id/eval-cases/:caseId/run`, a different route than the
    batch endpoint above). A failed run still answers 200 with an
    `EvalRunRecord` whose `pass`/`error` describe the failure (plan's
    "Contract & migration impact" — only "not found" and 409
    `no_provider_key` reject the promise), so a caller reads `data.error`
    for AC-69, not only `mutation.isError`.

    `onSuccess` invalidates `["agent-eval-dashboard", agentId]` **only** —
    never `["eval-overview"]`. AC-71: a single-case run must never disturb
    the `/eval` landing page's batch aggregates, which are keyed off that
    query and derived from a disjoint, batch-only read
    (`repository.ts` `isNotNull(batchId)`).

    The case editor renders its own failure reason (AC-69), so this opts out
    of the app-wide mutation toast with `meta: { ownErrorToast: true }`
    (`client/INSIGHTS.md` 2026-08-26) and then owns every error branch. */
export function useRunAgentEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, caseId }: RunAgentEvalCaseInput) =>
      api.post<EvalRunRecord>(`/agents/${agentId}/eval-cases/${caseId}/run`),
    onSuccess: (_data, { agentId }) =>
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard", agentId] }),
    meta: { ownErrorToast: true },
  });
}

// ---- Run all agents' eval sets (client-side fan-out, "Run all agents") ----

/** One agent as the fan-out needs to see it — just enough to attempt a run
    and to label its outcome; callers pass `EvalAgentSummary` rows straight
    through (both fields already sit on that shape). */
export interface RunAllAgentInput {
  agent_id: string;
  name: string;
}

/** Per-agent result of one `run()` call. `status: "ok"` always carries a
    `batch` and never `code`/`message`; `status: "error"` never carries a
    `batch`. `code` is the server's own error code —
    `NO_PROVIDER_KEY_CODE` (AC-52), `empty_eval_set`, or anything else
    `POST /agents/:id/eval-runs` answers with. Plan: Contract & migration
    impact, "Lane-internal contract". */
export type RunAllOutcome =
  | { agent_id: string; name: string; status: "ok"; batch: AgentEvalBatch }
  | { agent_id: string; name: string; status: "error"; code: string; message: string };

export interface UseRunAllAgentEvalBatchesResult {
  /** Runs the given agents' sets **sequentially**, one
      `POST /agents/:id/eval-runs` each — reusing the same endpoint
      `useRunAgentEvalBatch` calls above. Never stops early: a 409/422/5xx
      on one agent is captured as that agent's outcome and the loop moves to
      the next agent (AC-51), including the case where every agent so far
      failed with 409 `no_provider_key` (plan Open questions default — the
      fan-out does not short-circuit on that). Resolves with every outcome;
      it never rejects, even when every agent failed, so a caller never needs
      a try/catch around it. */
  run(agents: ReadonlyArray<RunAllAgentInput>): Promise<RunAllOutcome[]>;
  /** True for the whole duration of one `run()` call. The re-entry guard
      below does not depend on a caller reading this — see `run`'s own doc. */
  isRunning: boolean;
  /** The last completed run's per-agent results; `[]` before the first run
      (and also the transient result of a re-entrant `run()` call — see
      below). */
  outcomes: RunAllOutcome[];
  /** AC-52: every agent the last run *attempted* failed with 409
      `no_provider_key` — false before the first run and false on an empty
      `outcomes` list, so an unattempted button never reads as "all failed". */
  allNoProviderKey: boolean;
}

/** `Run all agents` (AC-46…AC-52): fans a batch run out across every agent
    the caller hands it, sequentially and over the existing single-agent
    mutation path (`useRunAgentEvalBatch`'s endpoint) rather than a new
    server route — see the plan's "Mechanism for `Run all agents`" decision.
    The page renders every per-agent failure itself (AC-51), so this
    mutation opts out of the app-wide mutation toast with
    `meta: { ownErrorToast: true }` (`client/INSIGHTS.md` 2026-08-26) and
    then owns every error branch below. */
export function useRunAllAgentEvalBatches(): UseRunAllAgentEvalBatchesResult {
  const qc = useQueryClient();
  const [isRunning, setIsRunning] = useState(false);
  const [outcomes, setOutcomes] = useState<RunAllOutcome[]>([]);
  // A ref, not just the `isRunning` state, so a second `run()` call in the
  // same synchronous tick (before React has committed the state update) is
  // still refused — AC-49 puts the guard in the hook, not only in the
  // button's `disabled`.
  const runningRef = useRef(false);

  const mutation = useMutation({
    mutationFn: (agentId: string) => api.post<AgentEvalBatch>(`/agents/${agentId}/eval-runs`),
    onSuccess: (_data, agentId) => {
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard", agentId] });
    },
    meta: { ownErrorToast: true },
  });

  const run = useCallback(
    async (agents: ReadonlyArray<RunAllAgentInput>): Promise<RunAllOutcome[]> => {
      if (runningRef.current) {
        // Re-entry guard (AC-49): starts nothing, reports nothing new.
        return [];
      }
      runningRef.current = true;
      setIsRunning(true);

      const results: RunAllOutcome[] = [];
      try {
        // Sequential on purpose — one `POST` at a time, in the order given,
        // so "exactly one batch per agent" (AC-47) holds by construction and
        // a later agent's attempt never depends on an earlier agent's
        // outcome (AC-51).
        for (const agent of agents) {
          try {
            const batch = await mutation.mutateAsync(agent.agent_id);
            results.push({ agent_id: agent.agent_id, name: agent.name, status: "ok", batch });
          } catch (error) {
            results.push({
              agent_id: agent.agent_id,
              name: agent.name,
              status: "error",
              code: isNoProviderKeyError(error)
                ? NO_PROVIDER_KEY_CODE
                : error instanceof ApiError
                  ? (error.code ?? "unknown_error")
                  : "unknown_error",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } finally {
        // At least one agent may have produced a new batch — refresh the
        // overview once for the whole run, not once per agent (AC-47).
        qc.invalidateQueries({ queryKey: ["eval-overview"] });
        setOutcomes(results);
        runningRef.current = false;
        setIsRunning(false);
      }
      return results;
    },
    [mutation, qc]
  );

  const allNoProviderKey =
    outcomes.length > 0 &&
    outcomes.every((outcome) => outcome.status === "error" && outcome.code === NO_PROVIDER_KEY_CODE);

  return { run, isRunning, outcomes, allNoProviderKey };
}

// ---- Agent version snapshot (GET /agents/:id/versions/:version) ----

/**
 * The immutable config snapshot captured whenever an agent's config changes
 * — the compare modal (AC-33/34) only reads `config.system_prompt` off it.
 * Now the mirrored `@devdigest/shared` type (fix pass, item 9 closed the gap
 * this comment used to describe: `AgentVersion`/`AgentVersionConfig` existed
 * in the server's canonical `vendor/shared/contracts/knowledge.ts` but were
 * never mirrored into the client's trimmed copy). Aliased under its old local
 * name so every existing call site keeps compiling unchanged. */
export type AgentVersionSnapshot = AgentVersion;

/**
 * One agent-version snapshot, for the compare modal's system-prompt diff
 * (AC-33). 404 (the snapshot no longer exists, AC-34) is an expected, not
 * transient, outcome, so this never retries — a caller branches on
 * `isError`/`error instanceof ApiError && error.status === 404` to show
 * `compare.promptDiffUnavailable` instead of an empty block. */
export function useAgentVersionSnapshot(
  agentId: string | null | undefined,
  version: number | null | undefined
) {
  return useQuery({
    queryKey: ["agent-version-snapshot", agentId, version],
    queryFn: () => api.get<AgentVersionSnapshot>(`/agents/${agentId}/versions/${version}`),
    enabled: !!agentId && version != null,
    retry: false,
    // A version snapshot is immutable once written, so it never goes stale.
    staleTime: Infinity,
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
