/* hooks/skills.ts — React Query hooks for the Skills Lab (L02): the /skills
   list, the skill editor and its Evals / Stats / Versions tabs.

   Key shape mirrors hooks/agents.ts: the collection is the plural noun
   (["skills"]) and a single record is ["skill", id], so an update can
   invalidate the list and prime the detail in one go. Sub-resources hang off
   the owning skill id ((["skill-stats", id]) rather than nesting under the
   detail key — invalidating the skill must not blow away its version history. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentSkillLink,
  EvalCase,
  EvalCaseInput,
  EvalRun,
  Skill,
  SkillInput,
  SkillPatch,
  SkillStats,
  SkillUsage,
  SkillVersion,
} from "@devdigest/shared";

/** Create/update payload for a skill-owned eval case — the route resolves the owner. */
export type SkillEvalCaseInput = Omit<EvalCaseInput, "owner_kind" | "owner_id">;

// ---- Skills (GET/POST /skills, GET/PUT/DELETE /skills/:id) ----

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: SkillPatch;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      // A body edit mints a new immutable version; metadata-only edits do not.
      // Invalidating unconditionally is cheaper than guessing which happened.
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
    },
  });
}

// ---- Version history (GET /skills/:id/versions[/:version], restore) ----

export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", id],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

/** One version WITH its body — the list omits `body`, the diff needs it. */
export function useSkillVersion(id: string | null | undefined, version: number | null | undefined) {
  return useQuery({
    queryKey: ["skill-version", id, version],
    queryFn: () => api.get<SkillVersion>(`/skills/${id}/versions/${version}`),
    enabled: !!id && version != null,
    // A version is immutable once written, so it never goes stale.
    staleTime: Infinity,
  });
}

export interface RestoreSkillVersionInput {
  id: string;
  version: number;
}

export function useRestoreSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: RestoreSkillVersionInput) =>
      api.post<Skill>(`/skills/${id}/versions/${version}/restore`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      // Restoring appends a new version on top rather than rewinding history.
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
    },
  });
}

// ---- Dashboard (GET /skills/:id/stats, GET /skills/:id/agents) ----

export function useSkillStats(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-stats", id],
    queryFn: () => api.get<SkillStats>(`/skills/${id}/stats`),
    enabled: !!id,
  });
}

export function useSkillAgents(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-agents", id],
    queryFn: () => api.get<SkillUsage[]>(`/skills/${id}/agents`),
    enabled: !!id,
  });
}

// ---- Agent ↔ skill links (GET/POST /agents/:id/skills) ----

/** Skills linked to an agent, in prompt order. */
export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

export interface SetAgentSkillsInput {
  agentId: string;
  /** The whole set, in prompt order — the write replaces the links wholesale. */
  skill_ids: string[];
}

export function useSetAgentSkills() {
  const qc = useQueryClient();
  return useMutation({
    // POST, not PUT: the agents module registers this path as `app.post`
    // (server/src/modules/agents/routes.ts) and there is no PUT handler, so a
    // PUT here 404s at runtime while typechecking perfectly.
    mutationFn: ({ agentId, skill_ids }: SetAgentSkillsInput) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids }),
    onSuccess: (data, { agentId }) => {
      qc.setQueryData(["agent-skills", agentId], data);
      // "Used by" on a skill's Stats tab is derived from these links.
      qc.invalidateQueries({ queryKey: ["skill-stats"] });
      qc.invalidateQueries({ queryKey: ["skill-agents"] });
    },
  });
}

// ---- Eval cases (GET/POST /skills/:id/eval-cases, PUT/DELETE /eval-cases/:id) ----

export function useSkillEvalCases(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-eval-cases", id],
    queryFn: () => api.get<EvalCase[]>(`/skills/${id}/eval-cases`),
    enabled: !!id,
  });
}

export interface CreateEvalCaseInput {
  skillId: string;
  input: SkillEvalCaseInput;
}

export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, input }: CreateEvalCaseInput) =>
      api.post<EvalCase>(`/skills/${skillId}/eval-cases`, input),
    onSuccess: (_d, { skillId }) =>
      qc.invalidateQueries({ queryKey: ["skill-eval-cases", skillId] }),
  });
}

export interface UpdateEvalCaseInput {
  /** Owning skill — carried so the list query can be invalidated by key. */
  skillId: string;
  id: string;
  patch: Partial<SkillEvalCaseInput>;
}

export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateEvalCaseInput) => api.put<EvalCase>(`/eval-cases/${id}`, patch),
    onSuccess: (_d, { skillId }) =>
      qc.invalidateQueries({ queryKey: ["skill-eval-cases", skillId] }),
  });
}

export interface DeleteEvalCaseInput {
  skillId: string;
  id: string;
}

export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeleteEvalCaseInput) => api.del<{ ok: boolean }>(`/eval-cases/${id}`),
    onSuccess: (_d, { skillId }) =>
      qc.invalidateQueries({ queryKey: ["skill-eval-cases", skillId] }),
  });
}

// ---- Running evals (409 no_provider_key when no LLM key is configured) ----

export interface RunEvalCaseInput {
  skillId: string;
  id: string;
}

export function useRunEvalCase() {
  return useMutation({
    mutationFn: ({ id }: RunEvalCaseInput) => api.post<EvalRun>(`/eval-cases/${id}/run`),
  });
}

/** Runs every case of a skill; one EvalRun per case, in list order. */
export function useRunAllEvals() {
  return useMutation({
    mutationFn: (skillId: string) => api.post<EvalRun[]>(`/skills/${skillId}/eval-run`),
  });
}
