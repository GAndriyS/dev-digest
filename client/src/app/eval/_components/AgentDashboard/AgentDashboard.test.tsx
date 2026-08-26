import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalAlert, EvalBatchRecord, EvalDashboard } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";
import { ApiError } from "@/lib/api";

const AGENT_ID = "agent-1";

const state = {
  agent: undefined as Agent | undefined,
  dashboard: undefined as EvalDashboard | undefined,
  isLoading: false,
  isError: false,
  error: null as unknown,
};

const refetch = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ agentId: AGENT_ID }),
}));

// The app chrome is not what this view is about; render its children only.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/hooks/agents", () => ({
  useAgent: () => ({ data: state.agent }),
}));

vi.mock("@/lib/hooks/eval", () => ({
  useAgentEvalDashboard: () => ({
    data: state.dashboard,
    isLoading: state.isLoading,
    isError: state.isError,
    error: state.error,
    refetch,
  }),
  // Consumed by CompareModal, opened from this view — never fetched in these
  // tests (kept in an unresolved loading state), which is enough to prove
  // Compare opens the modal without asserting its own internals here (that
  // is CompareModal's own test).
  useAgentVersionSnapshot: () => ({ data: undefined, isLoading: true, isError: false }),
}));

import { AgentDashboard } from "./AgentDashboard";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: AGENT_ID,
    name: "Security Reviewer",
    description: "",
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "Review carefully.",
    output_schema: null,
    enabled: true,
    version: 3,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    ...overrides,
  };
}

function makeBatch(overrides: Partial<EvalBatchRecord> = {}): EvalBatchRecord {
  return {
    batch_id: "batch-1",
    agent_id: AGENT_ID,
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

function makeDashboard(overrides: Partial<EvalDashboard> = {}): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: AGENT_ID,
    cases_total: 3,
    current: { recall: 0.8, precision: 0.9, citation_accuracy: 0.85, traces_passed: 4, traces_total: 5, cost_usd: 0.0123 },
    delta: { recall: 0.032, precision: -0.01, citation_accuracy: 0 },
    trend: [],
    recent_runs: [],
    recent_batches: [makeBatch()],
    alert: null,
    ...overrides,
  };
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <AgentDashboard />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  state.agent = makeAgent();
  state.dashboard = makeDashboard();
  state.isLoading = false;
  state.isError = false;
  state.error = null;
  refetch.mockReset();
});

afterEach(() => cleanup());

describe("AgentDashboard", () => {
  it("shows the no-runs empty state when recent_batches is empty, never a zero metric (AC-29 CRITICAL seam)", () => {
    // current/delta are the non-nullable 0-filled placeholder shape — the
    // component must gate on recent_batches, not on these being non-zero.
    state.dashboard = makeDashboard({ recent_batches: [] });
    renderView();

    expect(screen.getByText(evalMessages.dashboard.noRuns)).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: evalMessages.compare.button })).not.toBeInTheDocument();
  });

  it("renders the three metric cards with a signed delta and never color alone (arrow + text)", () => {
    renderView();

    expect(screen.getAllByText("80%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("90%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("85%").length).toBeGreaterThan(0);
    // delta.recall = 0.032 -> "+3.2 pt"; delta.precision = -0.01 -> "-1.0 pt";
    // delta.citation_accuracy = 0 -> "0.0 pt" (AC-33's "include the zero delta").
    expect(screen.getByText("+3.2 pt")).toBeInTheDocument();
    expect(screen.getByText("-1.0 pt")).toBeInTheDocument();
    expect(screen.getByText("0.0 pt")).toBeInTheDocument();
  });

  it("shows an em dash for a null citation_accuracy, never 0% (null-metric rule)", () => {
    state.dashboard = makeDashboard({
      current: { recall: 0.8, precision: 0.9, citation_accuracy: null as unknown as number, traces_passed: 4, traces_total: 5, cost_usd: null },
    });
    renderView();

    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders the regression banner with the alerted metric, drop, and direction of the other metrics (AC-31)", () => {
    const alert: EvalAlert = {
      metric: "recall",
      drop_pp: 5.2,
      others: { recall: 0.7, precision: 0.6, citation_accuracy: 0.6 },
    };
    state.dashboard = makeDashboard({
      recent_batches: [
        makeBatch({ batch_id: "b2", precision: 0.6, citation_accuracy: 0.6, ran_at: "2026-08-21T00:00:00.000Z" }),
        makeBatch({ batch_id: "b1", precision: 0.5, citation_accuracy: 0.6, ran_at: "2026-08-20T00:00:00.000Z" }),
      ],
      alert,
    });
    renderView();

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(evalMessages.dashboard.alert.title)).toBeInTheDocument();
    expect(screen.getByText("Recall dropped 5.2 pt since the previous run")).toBeInTheDocument();
    // precision: 0.6 (latest) vs 0.5 (previous) -> rose 10.0 pt.
    expect(screen.getByText("Precision rose 10.0 pt")).toBeInTheDocument();
    // citation: 0.6 vs 0.6 -> unchanged.
    expect(screen.getByText("Citation unchanged")).toBeInTheDocument();
  });

  it("enables Compare EXACTLY at two selected batches, and only then (AC-32, 0/1/2/3)", () => {
    state.dashboard = makeDashboard({
      recent_batches: [makeBatch({ batch_id: "b1" }), makeBatch({ batch_id: "b2" }), makeBatch({ batch_id: "b3" })],
    });
    renderView();

    const compareButton = screen.getByRole("button", { name: evalMessages.compare.button });
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);

    // 0 selected.
    expect(compareButton).toBeDisabled();

    // 1 selected.
    fireEvent.click(boxes[0]!);
    expect(compareButton).toBeDisabled();
    expect(screen.getByText(evalMessages.compare.selectHint)).toBeInTheDocument();

    // 2 selected.
    fireEvent.click(boxes[1]!);
    expect(compareButton).toBeEnabled();
    expect(screen.queryByText(evalMessages.compare.selectHint)).not.toBeInTheDocument();

    // 3 selected.
    fireEvent.click(boxes[2]!);
    expect(compareButton).toBeDisabled();
  });

  it("opens the compare modal on click when exactly two batches are selected", () => {
    state.dashboard = makeDashboard({
      recent_batches: [makeBatch({ batch_id: "b1" }), makeBatch({ batch_id: "b2" })],
    });
    renderView();

    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    fireEvent.click(screen.getByRole("button", { name: evalMessages.compare.button }));

    expect(screen.getByText(evalMessages.compare.title)).toBeInTheDocument();
  });

  it("marks a batch with errored cases", () => {
    state.dashboard = makeDashboard({ recent_batches: [makeBatch({ cases_errored: 2 })] });
    renderView();

    expect(screen.getByText("2 errored")).toBeInTheDocument();
  });

  it("shows an error state with retry on load failure", () => {
    state.isError = true;
    state.error = new ApiError("boom", 500);
    renderView();

    expect(screen.getByText("boom")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });
});
