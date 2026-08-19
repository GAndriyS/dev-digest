import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase, EvalRun, Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";
import { ApiError } from "@/lib/api";

const runOneMutate = vi.fn();
const runAllMutate = vi.fn();

const state = {
  cases: [] as EvalCase[],
  runError: null as unknown,
  runOnePending: false,
  runAllPending: false,
};

vi.mock("@/lib/hooks/skills", () => ({
  useSkillEvalCases: () => ({
    data: state.cases,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useRunEvalCase: () => ({
    mutate: runOneMutate,
    isPending: state.runOnePending,
    error: state.runError,
  }),
  useRunAllEvals: () => ({ mutate: runAllMutate, isPending: state.runAllPending, error: null }),
}));

import { EvalsTab } from "./EvalsTab";
import { SkillEvalRunProvider } from "../../../SkillEvalRun";

const SKILL: Skill = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "",
  type: "rubric",
  source: "manual",
  body: "# Rubric",
  enabled: true,
  version: 1,
};

const evalCase = (id: string, name: string): EvalCase => ({
  id,
  owner_kind: "skill",
  owner_id: "sk1",
  name,
  input_diff: "@@ -1 +1 @@",
  input_files: null,
  input_meta: null,
  expected_output: {
    findings: [
      { severity: "CRITICAL", category: "security" },
      { severity: "CRITICAL", category: "security" },
    ],
  },
  notes: null,
});

const RUN: EvalRun = {
  recall: 1,
  precision: 1,
  citation_accuracy: 1,
  traces_passed: 1,
  traces_total: 1,
  duration_ms: 12,
  cost_usd: null,
  per_trace: [{ name: "secret in config", pass: true, expected: 2, actual: 2 }],
};

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillEvalRunProvider skill={SKILL}>
        <EvalsTab skill={SKILL} />
      </SkillEvalRunProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.cases = [];
  state.runError = null;
  state.runOnePending = false;
  state.runAllPending = false;
  runOneMutate.mockReset();
  runAllMutate.mockReset();
});
afterEach(cleanup);

describe("EvalsTab", () => {
  it("invites the first case when there are none", () => {
    renderTab();
    expect(screen.getByText("No eval cases yet")).toBeInTheDocument();
  });

  it("shows a never-run case with its expectation and severity·category chip", () => {
    state.cases = [evalCase("c1", "secret in config")];
    renderTab();
    expect(screen.getByText("secret in config")).toBeInTheDocument();
    expect(screen.getByText("never run")).toBeInTheDocument();
    expect(screen.getByText("expected 2 findings")).toBeInTheDocument();
    expect(screen.getByText("CRITICAL · security")).toBeInTheDocument();
  });

  it("counts passing cases in the header badge", () => {
    state.cases = [evalCase("c1", "secret in config"), evalCase("c2", "clean diff")];
    renderTab();
    expect(screen.getByText("0 / 2 passing")).toBeInTheDocument();
  });

  it("records a run result against its case", () => {
    state.cases = [evalCase("c1", "secret in config")];
    runOneMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.(RUN));
    renderTab();
    fireEvent.click(screen.getByText("Run"));
    expect(runOneMutate).toHaveBeenCalledWith(
      { skillId: "sk1", id: "c1" },
      expect.anything(),
    );
    expect(screen.getByText("pass")).toBeInTheDocument();
    expect(screen.getByText("expected 2 findings, got 2")).toBeInTheDocument();
    expect(screen.getByText("1 / 1 passing")).toBeInTheDocument();
  });

  it("disables both Run buttons and explains why after a 409 no_provider_key", () => {
    state.cases = [evalCase("c1", "secret in config")];
    state.runError = new ApiError("no key", 409, "no_provider_key");
    renderTab();
    expect(screen.getByRole("alert")).toHaveTextContent("No LLM provider key is configured");
    expect(screen.getByText("Run").closest("button")).toBeDisabled();
    expect(screen.getByText("Run all").closest("button")).toBeDisabled();
  });

  it("disables Run all during a single-case run without relabeling it as running", () => {
    // Seam regression (L05 step 10): `running` (shared across runOne/runAll,
    // used to disable every Run button) and the Run-all button's own label
    // are not the same flag. A single case running must not make the Run all
    // button claim it is the one running.
    state.cases = [evalCase("c1", "secret in config")];
    state.runOnePending = true;
    renderTab();
    const runAllButton = screen.getByText("Run all").closest("button")!;
    expect(runAllButton).toBeDisabled();
    expect(runAllButton).toHaveTextContent("Run all");
    expect(screen.queryByText("Running…")).not.toBeInTheDocument();
  });

  it("opens the case modal from Add case", () => {
    renderTab();
    fireEvent.click(screen.getByText("Add case"));
    expect(screen.getByText("New eval case")).toBeInTheDocument();
  });
});
