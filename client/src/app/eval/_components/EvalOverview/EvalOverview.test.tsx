import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalAgentSummary, EvalBatchRecord, EvalDashboardOverview } from "@devdigest/shared";
import type { RunAllOutcome } from "@/lib/hooks/eval";
import evalMessages from "../../../../../messages/en/eval.json";
import { ApiError } from "@/lib/api";

const state = {
  data: undefined as EvalDashboardOverview | undefined,
  isLoading: false,
  isError: false,
  error: null as unknown,
};

// Controls for the `Run all agents` fan-out hook — a SEPARATE mock state
// from `state` above, since `useEvalOverview` and `useRunAllAgentEvalBatches`
// are independent hooks the page composes (client/INSIGHTS.md 2026-08-20: a
// new export missing from this plain mock factory is a hard vitest mock
// error mid-render, not an assertion failure — both hooks must be stubbed
// here).
const runAllState = {
  isRunning: false,
  outcomes: [] as RunAllOutcome[],
  allNoProviderKey: false,
};

const refetch = vi.fn();
const runMock = vi.fn();

vi.mock("@/lib/hooks/eval", () => ({
  useEvalOverview: () => ({
    data: state.data,
    isLoading: state.isLoading,
    isError: state.isError,
    error: state.error,
    refetch,
  }),
  useRunAllAgentEvalBatches: () => ({
    run: runMock,
    isRunning: runAllState.isRunning,
    outcomes: runAllState.outcomes,
    allNoProviderKey: runAllState.allNoProviderKey,
  }),
}));

// The app chrome is not what this view is about; render its children only.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { EvalOverview } from "./EvalOverview";

function makeAgent(overrides: Partial<EvalAgentSummary> = {}): EvalAgentSummary {
  return {
    agent_id: "agent-1",
    name: "Security Reviewer",
    model: "gpt-4.1",
    cases_total: 5,
    last_batch: null,
    // Placeholder trend — the AGENTS section renders the real `AgentRow`
    // (not a mock, per react-testing-library: never mock your own
    // components), and `AgentRow`'s own suite already covers `trend`'s
    // sparkline gate in isolation.
    trend: [],
    ...overrides,
  };
}

function makeBatch(overrides: Partial<EvalBatchRecord> = {}): EvalBatchRecord {
  return {
    batch_id: "batch-1",
    agent_id: "agent-1",
    agent_name: "Security Reviewer",
    agent_version: 3,
    ran_at: "2026-08-20T00:00:00.000Z",
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 0.85,
    traces_passed: 4,
    traces_total: 5,
    cases_errored: 0,
    duration_ms: 4000,
    cost_usd: 0.0123,
    ...overrides,
  };
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <EvalOverview />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  state.data = undefined;
  state.isLoading = false;
  state.isError = false;
  state.error = null;
  runAllState.isRunning = false;
  runAllState.outcomes = [];
  runAllState.allNoProviderKey = false;
  refetch.mockReset();
  runMock.mockReset();
});

afterEach(() => cleanup());

describe("EvalOverview", () => {
  it("shows the empty-agents state when no agent has any eval case yet (AC-26)", () => {
    state.data = { agents: [], recent_batches: [] };
    renderView();

    expect(screen.getByText(evalMessages.dashboard.overview.emptyAgents)).toBeInTheDocument();
    expect(screen.getByText(evalMessages.dashboard.noRuns)).toBeInTheDocument();
  });

  it("shows a never-run row for an agent with cases but no batch yet, never a zero metric (AC-8, AC-29, AC-42)", () => {
    state.data = { agents: [makeAgent({ last_batch: null })], recent_batches: [] };
    renderView();

    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText(evalMessages.evalsTab.neverRun)).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.getByText(evalMessages.dashboard.noRuns)).toBeInTheDocument();
  });

  it("renders the agent row's last-run metrics and the recent-batches table with the version cell as the only link (AC-27, AC-43, AC-44)", () => {
    const batch = makeBatch();
    state.data = { agents: [makeAgent({ last_batch: batch })], recent_batches: [batch] };
    renderView();

    // AgentRow and the table both render the metric, as a rounded
    // percentage — never a raw fraction.
    expect(screen.getAllByText(/80%/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/90%/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/85%/).length).toBeGreaterThan(0);

    // AC-43: the version cell is the only link in the recent-batches table —
    // the agent name moved to plain text. `AgentRow`'s own full-row link has
    // a much longer composed accessible name, so it never matches "Security
    // Reviewer" exactly.
    const versionLink = screen.getByRole("link", { name: "v3" });
    expect(versionLink).toHaveAttribute("href", "/eval/agent-1");
    expect(screen.queryByRole("link", { name: "Security Reviewer" })).not.toBeInTheDocument();
    expect(screen.getByText("4/5")).toBeInTheDocument();
    expect(screen.getByText("$0.0123")).toBeInTheDocument();
  });

  it("shows an em dash for a genuinely null citation_accuracy, never 0% (null-metric rule)", () => {
    const batch = makeBatch({ citation_accuracy: null, cost_usd: null });
    state.data = { agents: [makeAgent({ last_batch: batch })], recent_batches: [batch] };
    renderView();

    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("marks a batch with errored cases (dashboard.table.errored)", () => {
    const batch = makeBatch({ cases_errored: 2, traces_total: 5, traces_passed: 3 });
    state.data = { agents: [makeAgent({ last_batch: batch })], recent_batches: [batch] };
    renderView();

    expect(screen.getByText("2 errored")).toBeInTheDocument();
  });

  it("shows an error state with retry on load failure", () => {
    state.isError = true;
    state.error = new ApiError("boom", 500);
    renderView();

    expect(screen.getByText("boom")).toBeInTheDocument();
    screen.getByRole("button", { name: /retry/i }).click();
    expect(refetch).toHaveBeenCalled();
  });

  it("shows the AC-36 header, opens the confirm dialog before running anything, and Confirm fans the run out over every agent (AC-46, AC-47)", () => {
    const agentA = makeAgent({ agent_id: "agent-1", name: "Security Reviewer", cases_total: 5 });
    const agentB = makeAgent({ agent_id: "agent-2", name: "Style Reviewer", cases_total: 3 });
    state.data = { agents: [agentA, agentB], recent_batches: [] };
    renderView();

    expect(screen.getByRole("heading", { name: evalMessages.dashboard.overview.title })).toBeInTheDocument();
    expect(screen.getByText(evalMessages.dashboard.overview.subtitle)).toBeInTheDocument();

    const runButton = screen.getByRole("button", { name: evalMessages.runAllAgents.button });
    expect(runButton).toBeEnabled();

    fireEvent.click(runButton);
    expect(runMock).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("2 agents");
    expect(dialog).toHaveTextContent("8 eval cases");

    fireEvent.click(screen.getByRole("button", { name: evalMessages.runAllAgents.confirm }));
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith([
      { agent_id: "agent-1", name: "Security Reviewer" },
      { agent_id: "agent-2", name: "Style Reviewer" },
    ]);
  });

  it("disables Run all agents while a run is in progress (AC-49)", () => {
    state.data = { agents: [makeAgent()], recent_batches: [] };
    runAllState.isRunning = true;
    renderView();

    expect(screen.getByRole("button", { name: evalMessages.runAllAgents.button })).toBeDisabled();
  });

  it("disables Run all agents with a textual reason when no agent has cases (AC-50)", () => {
    state.data = { agents: [], recent_batches: [] };
    renderView();

    expect(screen.getByRole("button", { name: evalMessages.runAllAgents.button })).toBeDisabled();
    // Textual reason, not just a `title` attribute (NFR Доступність).
    expect(screen.getByText(evalMessages.runAllAgents.disabledReason)).toBeInTheDocument();
  });

  it("sticky-disables Run all agents with dashboard.noProviderKey once every attempted agent failed 409 (AC-52)", () => {
    state.data = { agents: [makeAgent()], recent_batches: [] };
    runAllState.allNoProviderKey = true;
    renderView();

    expect(screen.getByRole("button", { name: evalMessages.runAllAgents.button })).toBeDisabled();
    expect(screen.getByText(evalMessages.dashboard.noProviderKey)).toBeInTheDocument();
  });

  it("renders per-agent failure reasons after a partial run, cleared once the next run starts (AC-51)", () => {
    const expectedFailureLine = evalMessages.runAllAgents.failure
      .replace("{name}", "Style Reviewer")
      .replace("{reason}", "No provider key configured");

    state.data = { agents: [makeAgent()], recent_batches: [] };
    runAllState.outcomes = [
      {
        agent_id: "agent-2",
        name: "Style Reviewer",
        status: "error",
        code: "no_provider_key",
        message: "No provider key configured",
      },
    ];
    renderView();

    expect(screen.getByText(expectedFailureLine)).toBeInTheDocument();
    cleanup();

    // A new run starting hides the previous run's failure list — the hook
    // itself only overwrites `outcomes` once the whole run settles, so this
    // is the page's own doing (plan Open questions default).
    runAllState.isRunning = true;
    renderView();
    expect(screen.queryByText(expectedFailureLine)).not.toBeInTheDocument();
  });
});
