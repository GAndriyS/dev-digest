import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AgentEvalBatch, EvalCase, EvalDashboard, EvalDashboardOverview } from "@devdigest/shared";

import {
  isNoProviderKeyError,
  useAgentEvalCases,
  useAgentEvalDashboard,
  useAgentVersionSnapshot,
  useCreateEvalCaseFromFinding,
  useEvalOverview,
  useRunAgentEvalBatch,
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
