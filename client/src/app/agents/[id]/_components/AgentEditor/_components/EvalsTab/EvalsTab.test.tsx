import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalBatchRecord, EvalCase, EvalDashboard, EvalRunRecord } from "@devdigest/shared";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import { ApiError } from "@/lib/api";

const AGENT_ID = "ag1";

const runMutate = vi.fn();
const deleteMutate = vi.fn();
const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();

const state = {
  cases: [] as EvalCase[],
  casesLoading: false,
  casesError: false,
  dashboard: undefined as EvalDashboard | undefined,
  runError: null as unknown,
  runPending: false,
};

vi.mock("@/lib/hooks/eval", () => ({
  isNoProviderKeyError: (error: unknown) =>
    error instanceof ApiError && error.status === 409 && error.code === "no_provider_key",
  useAgentEvalCases: () => ({
    data: state.cases,
    isLoading: state.casesLoading,
    isError: state.casesError,
    refetch: vi.fn(),
  }),
  useAgentEvalDashboard: () => ({ data: state.dashboard }),
  useDeleteAgentEvalCase: () => ({ mutate: deleteMutate, isPending: false }),
  useRunAgentEvalBatch: () => ({ mutate: runMutate, isPending: state.runPending, error: state.runError }),
  useCreateAgentEvalCase: () => ({
    mutateAsync: createMutateAsync,
    isPending: false,
    isError: false,
    error: null,
  }),
  useUpdateAgentEvalCase: () => ({
    mutateAsync: updateMutateAsync,
    isPending: false,
    isError: false,
    error: null,
  }),
  // Step 7 stub: `EvalCaseModal` (rendered by this tab) imports this hook;
  // an omitted export here is a hard vitest mock error mid-render, not an
  // assertion failure (`client/INSIGHTS.md` 2026-08-20).
  useRunAgentEvalCase: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import { EvalsTab } from "./EvalsTab";

function makeCase(id: string, name: string, findings: unknown[]): EvalCase {
  return {
    id,
    owner_kind: "agent",
    owner_id: AGENT_ID,
    name,
    input_diff: "@@ -1 +1 @@",
    input_files: null,
    input_meta: null,
    expected_output: { findings },
    notes: null,
    source_finding_id: null,
  };
}

function makeRun(caseId: string, overrides: Partial<EvalRunRecord> = {}): EvalRunRecord {
  return {
    id: `run-${caseId}`,
    case_id: caseId,
    case_name: null,
    batch_id: "b1",
    agent_version: 1,
    ran_at: "2026-08-20T00:00:00.000Z",
    actual_output: null,
    error: null,
    pass: true,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    duration_ms: 100,
    cost_usd: null,
    ...overrides,
  };
}

function makeBatch(overrides: Partial<EvalBatchRecord> = {}): EvalBatchRecord {
  return {
    batch_id: "b1",
    agent_id: AGENT_ID,
    agent_name: "Security Reviewer",
    agent_version: 1,
    ran_at: "2026-08-20T00:00:00.000Z",
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 0.85,
    traces_passed: 3,
    traces_total: 4,
    cases_errored: 0,
    duration_ms: 5000,
    cost_usd: 0.02,
    ...overrides,
  };
}

// CRITICAL seam: current/delta are non-nullable 0-filled placeholders when no
// batch has run — the dashboard read never varies their shape, only
// `recent_batches` (and `trend`) go from empty to populated.
function makeDashboard(overrides: Partial<EvalDashboard> = {}): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: AGENT_ID,
    cases_total: 0,
    current: { recall: 0, precision: 0, citation_accuracy: 0, traces_passed: 0, traces_total: 0, cost_usd: null },
    delta: { recall: 0, precision: 0, citation_accuracy: 0 },
    trend: [],
    recent_runs: [],
    recent_batches: [],
    alert: null,
    ...overrides,
  };
}

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common: { actions: { cancel: "Cancel" }, states: { error: "Something went wrong" } } }}>
      <EvalsTab agentId={AGENT_ID} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.cases = [];
  state.casesLoading = false;
  state.casesError = false;
  state.dashboard = undefined;
  state.runError = null;
  state.runPending = false;
  runMutate.mockReset();
  deleteMutate.mockReset();
  createMutateAsync.mockReset();
  updateMutateAsync.mockReset();
});
afterEach(cleanup);

describe("EvalsTab", () => {
  it("invites the first case when the set is empty, with no metric zeros", () => {
    renderTab();
    expect(
      screen.getByText(
        "No eval cases yet. Create one to assert this agent's expected findings on a sample diff.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/traces passed/)).not.toBeInTheDocument();
  });

  it("shows a never-run case with its expectation count", () => {
    state.cases = [makeCase("c1", "block eval() of user input", [{ file: "a.ts", start_line: 1, end_line: 2 }])];
    renderTab();
    expect(screen.getByText("block eval() of user input")).toBeInTheDocument();
    expect(screen.getByText("never run")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("labels each case with its expectation kind in words, next to the icon+count badge (AC-7)", () => {
    state.cases = [
      makeCase("c1", "must find case", [{ file: "a.ts" }]),
      makeCase("c2", "must not flag case", []),
    ];
    renderTab();
    expect(screen.getByText("must_find")).toBeInTheDocument();
    expect(screen.getByText("must_not_flag")).toBeInTheDocument();
  });

  it("prefers the stored expectation_kind over the derived one for the row's label", () => {
    // Findings say must_find, but the stored kind says otherwise — the row
    // must print the stored word (AC-7 reads the stored field, never
    // re-derives it), not the one `expected_output` would imply on its own.
    state.cases = [{ ...makeCase("c1", "drifted case", [{ file: "a.ts" }]), expectation_kind: "must_not_flag" }];
    renderTab();
    expect(screen.getByText("must_not_flag")).toBeInTheDocument();
    expect(screen.queryByText("must_find")).not.toBeInTheDocument();
  });

  it("shows a textual mismatch warning when the stored kind contradicts the expectations (AC-58)", () => {
    state.cases = [{ ...makeCase("c1", "drifted case", []), expectation_kind: "must_find" }];
    renderTab();
    expect(screen.getByText("Stored as must_find, but expected output has 0 findings")).toBeInTheDocument();
  });

  it("shows no mismatch warning when the stored kind agrees with the expectations", () => {
    state.cases = [
      { ...makeCase("c1", "case one", [{ file: "a.ts" }]), expectation_kind: "must_find" },
    ];
    renderTab();
    expect(screen.queryByText(/^Stored as/)).not.toBeInTheDocument();
  });

  it("reads status off the dashboard's latest run per case, not off run.data", () => {
    state.cases = [makeCase("c1", "case one", [{ file: "a.ts" }])];
    state.dashboard = makeDashboard({ recent_runs: [makeRun("c1", { pass: true, recall: 1 })] });
    renderTab();
    expect(screen.getByText("passed")).toBeInTheDocument();
    expect(screen.getByText("1 / 1 traces passed")).toBeInTheDocument();
  });

  it("shows an errored case's reason instead of a recall reading", () => {
    state.cases = [makeCase("c1", "case one", [])];
    state.dashboard = makeDashboard({
      recent_runs: [
        makeRun("c1", {
          pass: null,
          recall: null,
          precision: null,
          citation_accuracy: null,
          error: { code: "timeout", message: "provider timed out" },
        }),
      ],
    });
    renderTab();
    expect(screen.getByText("errored")).toBeInTheDocument();
    expect(screen.getByText("Failed: provider timed out")).toBeInTheDocument();
  });

  it("disables Run and explains why after a 409 no_provider_key", () => {
    state.cases = [makeCase("c1", "case one", [{ file: "a.ts" }])];
    state.runError = new ApiError("no key", 409, "no_provider_key");
    renderTab();
    expect(screen.getByRole("alert")).toHaveTextContent("No LLM provider key is configured");
    expect(screen.getByText("Run").closest("button")).toBeDisabled();
  });

  it("disables Run and relabels it while a batch is in flight", () => {
    state.cases = [makeCase("c1", "case one", [{ file: "a.ts" }])];
    state.runPending = true;
    renderTab();
    expect(screen.getByText("Running…").closest("button")).toBeDisabled();
    expect(screen.queryByText("Run")).not.toBeInTheDocument();
  });

  it("runs the whole set on click", () => {
    state.cases = [makeCase("c1", "case one", [{ file: "a.ts" }])];
    renderTab();
    fireEvent.click(screen.getByText("Run"));
    expect(runMutate).toHaveBeenCalledWith(AGENT_ID);
  });

  it("never shows the metrics section or a zero reading when no batch has run yet (AC-29)", () => {
    state.cases = [makeCase("c1", "case one", [{ file: "a.ts" }])];
    state.dashboard = makeDashboard();
    renderTab();
    expect(screen.queryByText("Eval metrics")).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("shows the latest batch's metrics and a dashboard link once a batch exists", () => {
    state.cases = [makeCase("c1", "case one", [{ file: "a.ts" }])];
    state.dashboard = makeDashboard({ recent_batches: [makeBatch()] });
    renderTab();
    expect(screen.getByText("Eval metrics")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText("3 / 4 traces passed")).toBeInTheDocument();
    expect(screen.getByText("View in Eval Dashboard →").closest("a")).toHaveAttribute(
      "href",
      "/eval/ag1",
    );
  });

  it("asks for confirmation before deleting, and does nothing on cancel", () => {
    state.cases = [makeCase("c1", "case one", [{ file: "a.ts" }])];
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderTab();
    fireEvent.click(screen.getByLabelText("Delete"));
    expect(confirmSpy).toHaveBeenCalledWith('Delete the eval case "case one"? This cannot be undone.');
    expect(deleteMutate).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByLabelText("Delete"));
    expect(deleteMutate).toHaveBeenCalledWith({ agentId: AGENT_ID, id: "c1" });
    confirmSpy.mockRestore();
  });

  it("opens the create-case modal from New case", () => {
    renderTab();
    // The empty state's own CTA reuses the same label as the header button —
    // both are visible at once when the set is empty; either opens the modal.
    fireEvent.click(screen.getAllByText("New case")[0]!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens the edit modal from a case row", () => {
    state.cases = [makeCase("c1", "case one", [{ file: "a.ts" }])];
    renderTab();
    fireEvent.click(screen.getByLabelText("Edit"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders the case name as an escaped text node, never markup", () => {
    state.cases = [makeCase("c1", "<b>bold</b> name", [])];
    renderTab();
    expect(screen.getByText("<b>bold</b> name")).toBeInTheDocument();
    expect(document.querySelector("b")).not.toBeInTheDocument();
  });

  it("surfaces a case load failure with a retry", () => {
    state.casesError = true;
    renderTab();
    expect(screen.getByText("Could not load eval cases.")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });
});
