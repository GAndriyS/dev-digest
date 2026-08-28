import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type {
  AgentEvalBatch,
  EvalCase,
  EvalDashboard,
  EvalDashboardOverview,
  EvalRunRecord,
} from "@devdigest/shared";

import {
  isNoProviderKeyError,
  NO_PROVIDER_KEY_CODE,
  useAgentEvalCases,
  useAgentEvalDashboard,
  useAgentVersionSnapshot,
  useCreateEvalCaseFromFinding,
  useEvalOverview,
  useRunAgentEvalBatch,
  useRunAgentEvalCase,
  useRunAllAgentEvalBatches,
} from "./eval";
import { ApiError } from "../api";

// INSIGHTS client#2026-08-20: logic in src/lib/hooks/* falls out of every
// route suite because those suites mock the hooks module wholesale — this
// file is that hook's own test, in the same change that added the hooks.

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : status === 201 ? "Created" : "Error",
    json: async () => body,
  };
}

function evalCase(over: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "case-1",
    owner_kind: "agent",
    owner_id: "agent-1",
    name: "Accepted finding case",
    input_diff: "diff --git a/x b/x\n",
    input_files: null,
    input_meta: null,
    expected_output: { findings: [{ file: "x", start_line: 1, end_line: 2 }] },
    notes: null,
    source_finding_id: "finding-1",
    ...over,
  };
}

function makeBatch(agentId: string, over: Partial<AgentEvalBatch> = {}): AgentEvalBatch {
  return {
    batch_id: `batch-${agentId}`,
    agent_id: agentId,
    agent_name: agentId,
    agent_version: 1,
    ran_at: "2026-08-26T00:00:00.000Z",
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    traces_passed: 2,
    traces_total: 2,
    cases_errored: 0,
    duration_ms: 1200,
    cost_usd: 0.01,
    cases: [],
    ...over,
  };
}

function makeRunRecord(caseId: string, over: Partial<EvalRunRecord> = {}): EvalRunRecord {
  return {
    id: `run-${caseId}`,
    case_id: caseId,
    case_name: null,
    batch_id: null,
    agent_version: 1,
    ran_at: "2026-08-27T00:00:00.000Z",
    actual_output: { findings: [] },
    error: null,
    pass: true,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    duration_ms: 400,
    cost_usd: 0.002,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useAgentEvalCases", () => {
  it("scopes the list query to owner_kind=agent and the given owner_id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("/eval-cases?owner_kind=agent&owner_id=agent-1");
        return jsonResponse(200, [evalCase()]);
      })
    );

    const client = makeClient();
    const { result } = renderHook(() => useAgentEvalCases("agent-1"), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.owner_id).toBe("agent-1");
  });

  it("does not fetch when agentId is not provided", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient();
    renderHook(() => useAgentEvalCases(undefined), { wrapper: wrapperFor(client) });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useCreateEvalCaseFromFinding — 201 vs 200 discrimination (AC-6)", () => {
  it("reports created:true on a 201 (a new case was just made)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toContain("/findings/finding-1/eval-case");
        expect(init?.method).toBe("POST");
        return jsonResponse(201, evalCase());
      })
    );

    const client = makeClient();
    const { result } = renderHook(() => useCreateEvalCaseFromFinding(), {
      wrapper: wrapperFor(client),
    });

    let outcome: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      outcome = await result.current.mutateAsync("finding-1");
    });

    expect(outcome?.created).toBe(true);
    expect(outcome?.case.id).toBe("case-1");
  });

  it("reports created:false on a 200 (the case already existed) with the same body shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, evalCase({ id: "case-existing" })))
    );

    const client = makeClient();
    const { result } = renderHook(() => useCreateEvalCaseFromFinding(), {
      wrapper: wrapperFor(client),
    });

    let outcome: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      outcome = await result.current.mutateAsync("finding-1");
    });

    expect(outcome?.created).toBe(false);
    expect(outcome?.case.id).toBe("case-existing");
  });
});

describe("409 no_provider_key surfacing (AC-24)", () => {
  it("isNoProviderKeyError is true only for a 409 with code no_provider_key", () => {
    expect(isNoProviderKeyError(new ApiError("no key", 409, "no_provider_key"))).toBe(true);
    expect(isNoProviderKeyError(new ApiError("conflict", 409, "other_code"))).toBe(false);
    expect(isNoProviderKeyError(new ApiError("boom", 500, "no_provider_key"))).toBe(false);
    expect(isNoProviderKeyError(new Error("boom"))).toBe(false);
    expect(isNoProviderKeyError(null)).toBe(false);
  });

  it("useRunAgentEvalBatch surfaces a 409 as an ApiError the caller can key its disabled Run button off", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(409, { error: { code: "no_provider_key", message: "No API key configured" } })
      )
    );

    const client = makeClient();
    const { result } = renderHook(() => useRunAgentEvalBatch(), { wrapper: wrapperFor(client) });

    act(() => {
      result.current.mutate("agent-1");
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(isNoProviderKeyError(result.current.error)).toBe(true);
  });
});

describe("useEvalOverview / useAgentEvalDashboard — happy paths", () => {
  it("useEvalOverview returns the agent summaries and recent batches", async () => {
    const overview: EvalDashboardOverview = {
      agents: [
        {
          agent_id: "agent-1",
          name: "Security Reviewer",
          model: "gpt-4.1",
          cases_total: 3,
          last_batch: null,
          trend: [],
        },
      ],
      recent_batches: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("/eval/overview");
        return jsonResponse(200, overview);
      })
    );

    const client = makeClient();
    const { result } = renderHook(() => useEvalOverview(), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.agents).toHaveLength(1);
    expect(result.current.data?.agents[0]?.agent_id).toBe("agent-1");
  });

  it("useAgentEvalDashboard queries GET /eval/dashboard?owner_id=<agentId> and returns null-safe aggregates", async () => {
    const dashboard: EvalDashboard = {
      owner_kind: "agent",
      owner_id: "agent-1",
      cases_total: 0,
      current: {
        recall: 0,
        precision: 0,
        citation_accuracy: 0,
        traces_passed: 0,
        traces_total: 0,
        cost_usd: null,
      },
      delta: { recall: 0, precision: 0, citation_accuracy: 0 },
      trend: [],
      recent_runs: [],
      recent_batches: [],
      alert: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("/eval/dashboard?owner_id=agent-1");
        return jsonResponse(200, dashboard);
      })
    );

    const client = makeClient();
    const { result } = renderHook(() => useAgentEvalDashboard("agent-1"), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.alert).toBeNull();
    expect(result.current.data?.cases_total).toBe(0);
  });

  it("does not fetch when agentId is not provided", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient();
    renderHook(() => useAgentEvalDashboard(undefined), { wrapper: wrapperFor(client) });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useRunAgentEvalBatch — happy path", () => {
  it("returns the aggregated AgentEvalBatch on success", async () => {
    const batch: AgentEvalBatch = {
      batch_id: "batch-1",
      agent_id: "agent-1",
      agent_name: "Security Reviewer",
      agent_version: 3,
      ran_at: "2026-08-26T00:00:00.000Z",
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      traces_passed: 2,
      traces_total: 2,
      cases_errored: 0,
      duration_ms: 1200,
      cost_usd: 0.01,
      cases: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toContain("/agents/agent-1/eval-runs");
        expect(init?.method).toBe("POST");
        return jsonResponse(200, batch);
      })
    );

    const client = makeClient();
    const { result } = renderHook(() => useRunAgentEvalBatch(), { wrapper: wrapperFor(client) });

    let data: AgentEvalBatch | undefined;
    await act(async () => {
      data = await result.current.mutateAsync("agent-1");
    });

    expect(data?.batch_id).toBe("batch-1");
    expect(data?.traces_passed).toBe(2);
  });
});

describe("useRunAgentEvalCase — per-case run (AC-63, AC-70, AC-71)", () => {
  it("posts to /agents/:id/eval-cases/:caseId/run and returns the EvalRunRecord", async () => {
    const record = makeRunRecord("case-1", { pass: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toContain("/agents/agent-1/eval-cases/case-1/run");
        expect(init?.method).toBe("POST");
        return jsonResponse(200, record);
      })
    );

    const client = makeClient();
    const { result } = renderHook(() => useRunAgentEvalCase(), { wrapper: wrapperFor(client) });

    let data: EvalRunRecord | undefined;
    await act(async () => {
      data = await result.current.mutateAsync({ agentId: "agent-1", caseId: "case-1" });
    });

    expect(data?.id).toBe("run-case-1");
    expect(data?.batch_id).toBeNull();
    expect(data?.pass).toBe(true);
  });

  it("invalidates only the agent's own dashboard query, never the eval-overview query (AC-71)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, makeRunRecord("case-1")))
    );

    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useRunAgentEvalCase(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync({ agentId: "agent-1", caseId: "case-1" });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["agent-eval-dashboard", "agent-1"] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ["eval-overview"] });
  });

  it("returns a 200 body with pass:null and an error on a failed run, rather than rejecting (AC-69)", async () => {
    const failed = makeRunRecord("case-1", {
      pass: null,
      recall: null,
      precision: null,
      citation_accuracy: null,
      error: { code: "provider_error", message: "provider timed out" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, failed))
    );

    const client = makeClient();
    const { result } = renderHook(() => useRunAgentEvalCase(), { wrapper: wrapperFor(client) });

    let data: EvalRunRecord | undefined;
    await act(async () => {
      data = await result.current.mutateAsync({ agentId: "agent-1", caseId: "case-1" });
    });

    expect(result.current.isError).toBe(false);
    expect(data?.pass).toBeNull();
    expect(data?.error).toEqual({ code: "provider_error", message: "provider timed out" });
  });

  it("opts out of the app-wide mutation toast (meta.ownErrorToast) so a component's own failure copy is not doubled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(404, { error: { code: "not_found", message: "Eval case not found" } })
      )
    );

    const toasted: unknown[] = [];
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      // Mirrors `providers.tsx`'s real mutationCache — the check this test
      // exists for is that `meta.ownErrorToast` actually suppresses it.
      mutationCache: new MutationCache({
        onError: (err, _vars, _ctx, mutation) => {
          if (mutation.meta?.ownErrorToast) return;
          toasted.push(err);
        },
      }),
    });
    const { result } = renderHook(() => useRunAgentEvalCase(), { wrapper: wrapperFor(client) });

    act(() => {
      result.current.mutate({ agentId: "agent-1", caseId: "case-1" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toasted).toEqual([]);
  });
});

describe("useAgentVersionSnapshot — compare modal prompt diff (AC-33, AC-34)", () => {
  it("queries GET /agents/:id/versions/:version and returns the config snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("/agents/agent-1/versions/3");
        return jsonResponse(200, {
          agent_id: "agent-1",
          version: 3,
          config: { system_prompt: "You are a careful reviewer." },
          created_at: "2026-08-20T00:00:00.000Z",
        });
      })
    );

    const client = makeClient();
    const { result } = renderHook(() => useAgentVersionSnapshot("agent-1", 3), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.config.system_prompt).toBe("You are a careful reviewer.");
  });

  it("surfaces a 404 (deleted snapshot) as an error without retrying (AC-34)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(404, { error: { code: "not_found", message: "Agent version not found" } }))
    );

    const client = makeClient();
    const { result } = renderHook(() => useAgentVersionSnapshot("agent-1", 1), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).status).toBe(404);
  });

  it("does not fetch when version is not provided", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient();
    renderHook(() => useAgentVersionSnapshot("agent-1", undefined), { wrapper: wrapperFor(client) });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useRunAllAgentEvalBatches — Run all agents fan-out (AC-47, AC-49, AC-51, AC-52)", () => {
  const agents = [
    { agent_id: "agent-1", name: "Security Reviewer" },
    { agent_id: "agent-2", name: "Style Reviewer" },
    { agent_id: "agent-3", name: "Perf Reviewer" },
  ];

  it("runs agents sequentially — never two requests in flight at once — and posts once per agent", async () => {
    const calls: string[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(url);
        expect(init?.method).toBe("POST");
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 5));
        concurrent--;
        const agentId = agents.find((a) => url.includes(`/agents/${a.agent_id}/eval-runs`))!.agent_id;
        return jsonResponse(200, makeBatch(agentId));
      })
    );

    const client = makeClient();
    const { result } = renderHook(() => useRunAllAgentEvalBatches(), { wrapper: wrapperFor(client) });

    let outcomes: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      outcomes = await result.current.run(agents);
    });

    expect(maxConcurrent).toBe(1);
    expect(calls).toEqual([
      expect.stringContaining("/agents/agent-1/eval-runs"),
      expect.stringContaining("/agents/agent-2/eval-runs"),
      expect.stringContaining("/agents/agent-3/eval-runs"),
    ]);
    expect(outcomes).toHaveLength(3);
    for (const [i, outcome] of outcomes!.entries()) {
      expect(outcome.status).toBe("ok");
      expect(outcome.agent_id).toBe(agents[i]!.agent_id);
      expect(outcome.status === "ok" && outcome.batch.batch_id).toBe(`batch-${agents[i]!.agent_id}`);
    }
    expect(result.current.outcomes).toEqual(outcomes);
    expect(result.current.isRunning).toBe(false);
  });

  it("keeps running the remaining agents after one fails (AC-51) and reports its reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/agents/agent-2/eval-runs")) {
          return jsonResponse(409, {
            error: { code: "no_provider_key", message: "No API key configured" },
          });
        }
        const agentId = agents.find((a) => url.includes(`/agents/${a.agent_id}/eval-runs`))!.agent_id;
        return jsonResponse(200, makeBatch(agentId));
      })
    );

    const client = makeClient();
    const { result } = renderHook(() => useRunAllAgentEvalBatches(), { wrapper: wrapperFor(client) });

    let outcomes: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      outcomes = await result.current.run(agents);
    });

    expect(outcomes).toHaveLength(3);
    expect(outcomes![0]).toMatchObject({ agent_id: "agent-1", status: "ok" });
    expect(outcomes![1]).toMatchObject({
      agent_id: "agent-2",
      status: "error",
      code: "no_provider_key",
    });
    expect(outcomes![2]).toMatchObject({ agent_id: "agent-3", status: "ok" });
    // The surviving agents still complete — not aborted by the middle failure.
    expect((outcomes![0] as { status: "ok"; batch: AgentEvalBatch }).batch.batch_id).toBe("batch-agent-1");
    expect((outcomes![2] as { status: "ok"; batch: AgentEvalBatch }).batch.batch_id).toBe("batch-agent-3");
    expect(result.current.allNoProviderKey).toBe(false);
  });

  it("attempts every agent even once all so far have 409'd, and reports allNoProviderKey (AC-52)", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(409, { error: { code: "no_provider_key", message: "No API key configured" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient();
    const { result } = renderHook(() => useRunAllAgentEvalBatches(), { wrapper: wrapperFor(client) });

    let outcomes: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      outcomes = await result.current.run(agents);
    });

    // No early stop: every agent is attempted even though earlier ones
    // already 409'd (plan Open questions default).
    expect(fetchMock).toHaveBeenCalledTimes(agents.length);
    expect(outcomes).toHaveLength(3);
    expect(outcomes!.every((o) => o.status === "error" && o.code === NO_PROVIDER_KEY_CODE)).toBe(true);
    expect(result.current.allNoProviderKey).toBe(true);
  });

  it("does not report allNoProviderKey before any run has happened", () => {
    const client = makeClient();
    const { result } = renderHook(() => useRunAllAgentEvalBatches(), { wrapper: wrapperFor(client) });

    expect(result.current.outcomes).toEqual([]);
    expect(result.current.allNoProviderKey).toBe(false);
    expect(result.current.isRunning).toBe(false);
  });

  it("refuses a second run while one is already in flight (AC-49) — the guard lives in the hook", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const agentId = agents.find((a) => url.includes(`/agents/${a.agent_id}/eval-runs`))!.agent_id;
      return jsonResponse(200, makeBatch(agentId));
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient();
    const { result } = renderHook(() => useRunAllAgentEvalBatches(), { wrapper: wrapperFor(client) });

    let firstRun: Promise<Awaited<ReturnType<typeof result.current.run>>>;
    let secondOutcomes: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      firstRun = result.current.run(agents);
      // Fired synchronously while the first run is still in flight.
      secondOutcomes = await result.current.run(agents);
    });

    expect(secondOutcomes).toEqual([]);

    let firstOutcomes: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      firstOutcomes = await firstRun;
    });

    expect(firstOutcomes).toHaveLength(3);
    // Only the first run's requests went out — the second call started no
    // second fan-out.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.isRunning).toBe(false);
  });
});
