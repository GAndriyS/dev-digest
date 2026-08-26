import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalAgentSummary, EvalBatchRecord, EvalDashboardOverview } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";
import { ApiError } from "@/lib/api";

const state = {
  data: undefined as EvalDashboardOverview | undefined,
  isLoading: false,
  isError: false,
  error: null as unknown,
};

const refetch = vi.fn();

vi.mock("@/lib/hooks/eval", () => ({
  useEvalOverview: () => ({
    data: state.data,
    isLoading: state.isLoading,
    isError: state.isError,
    error: state.error,
    refetch,
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
    // Placeholder — step 5 (W2-A) is the server side that fills this for
    // real; step 6/8 (W2-B/W3-A) tests override it per-case. See the plan's
    // Contract & migration impact for what `[]` vs a non-empty series means.
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
  refetch.mockReset();
});

afterEach(() => cleanup());

describe("EvalOverview", () => {
  it("shows the empty-agents state when no agent has any eval case yet (AC-26)", () => {
    state.data = { agents: [], recent_batches: [] };
    renderView();

    expect(screen.getByText(evalMessages.dashboard.overview.emptyAgents)).toBeInTheDocument();
    expect(screen.getByText(evalMessages.dashboard.noRuns)).toBeInTheDocument();
  });

  it("shows a never-run card for an agent with cases but no batch yet, never a zero metric (AC-8, AC-29)", () => {
    state.data = { agents: [makeAgent({ last_batch: null })], recent_batches: [] };
    renderView();

    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText(evalMessages.evalsTab.neverRun)).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.getByText(evalMessages.dashboard.noRuns)).toBeInTheDocument();
  });

  it("renders an agent card's last-run metrics and the recent-batches table (AC-27)", () => {
    const batch = makeBatch();
    state.data = { agents: [makeAgent({ last_batch: batch })], recent_batches: [batch] };
    renderView();

    // Card + table both render the metric, as a rounded percentage — never a raw fraction.
    expect(screen.getAllByText(/80%/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/90%/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/85%/).length).toBeGreaterThan(0);

    // Recent batches table: one row per batch, agent name linked to /eval/:id.
    const link = screen.getByRole("link", { name: "Security Reviewer" });
    expect(link).toHaveAttribute("href", "/eval/agent-1");
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
});
