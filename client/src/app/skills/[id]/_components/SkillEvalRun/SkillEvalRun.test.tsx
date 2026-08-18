import type { ReactNode } from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase, EvalRun, Skill } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";
import { ApiError } from "@/lib/api";

const replace = vi.fn();
let searchParams = new URLSearchParams("tab=config");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

const runOneMutate = vi.fn();
const runAllMutate = vi.fn();

const state = {
  cases: [] as EvalCase[],
  runOnePending: false,
  runAllPending: false,
  runError: null as unknown,
};

vi.mock("@/lib/hooks/skills", () => ({
  useSkillEvalCases: () => ({
    data: state.cases,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useRunEvalCase: () => ({
    mutate: runOneMutate,
    isPending: state.runOnePending,
    error: state.runError,
  }),
  useRunAllEvals: () => ({
    mutate: runAllMutate,
    isPending: state.runAllPending,
    error: null,
  }),
}));

import { RunEvalsButton, SkillEvalRunProvider, useSkillEvalRun } from "./SkillEvalRun";

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
  expected_output: { findings: [{ severity: "CRITICAL", category: "security" }] },
  notes: null,
});

const run = (over: Partial<EvalRun> = {}): EvalRun => ({
  recall: 1,
  precision: 1,
  citation_accuracy: 1,
  traces_passed: 1,
  traces_total: 1,
  duration_ms: 10,
  cost_usd: null,
  per_trace: [],
  ...over,
});

function wrapper({ children }: { children: ReactNode }) {
  return <SkillEvalRunProvider skill={SKILL}>{children}</SkillEvalRunProvider>;
}

beforeEach(() => {
  state.cases = [];
  state.runOnePending = false;
  state.runAllPending = false;
  state.runError = null;
  runOneMutate.mockReset();
  runAllMutate.mockReset();
  replace.mockReset();
  searchParams = new URLSearchParams("tab=config");
});
afterEach(cleanup);

describe("useSkillEvalRun", () => {
  it("has no cases and is not running with an empty list", () => {
    const { result } = renderHook(() => useSkillEvalRun(), { wrapper });
    expect(result.current.hasCases).toBe(false);
    expect(result.current.running).toBe(false);
    expect(result.current.noProviderKey).toBe(false);
  });

  it("reports hasCases once the list loads", () => {
    state.cases = [evalCase("c1", "alpha")];
    const { result } = renderHook(() => useSkillEvalRun(), { wrapper });
    expect(result.current.hasCases).toBe(true);
  });

  it("records a run-one result against its case", () => {
    state.cases = [evalCase("c1", "alpha")];
    runOneMutate.mockImplementation((_vars, opts) =>
      opts?.onSuccess?.(run({ per_trace: [{ name: "alpha", pass: true, expected: 1, actual: 1 }] })),
    );
    const { result } = renderHook(() => useSkillEvalRun(), { wrapper });

    act(() => result.current.runOne("c1"));
    expect(result.current.results.c1).toBeDefined();
  });

  it("keeps a run-one result when a run-all lands after it — merge, not replace", () => {
    // Regression for the race the plan's Risks section calls out: running one
    // case while a run-all is (or was) in flight must not wipe the other
    // case's result out of the map. EvalsTab used to own this comment and
    // this exact merge inline; it moved here with the state, not away.
    state.cases = [evalCase("c1", "alpha"), evalCase("c2", "beta")];
    runOneMutate.mockImplementation((_vars, opts) =>
      opts?.onSuccess?.(run({ per_trace: [{ name: "alpha", pass: true, expected: 1, actual: 1 }] })),
    );
    runAllMutate.mockImplementation((_skillId, opts) =>
      opts?.onSuccess?.([run({ per_trace: [{ name: "beta", pass: false, expected: 1, actual: 0 }] })]),
    );
    const { result } = renderHook(() => useSkillEvalRun(), { wrapper });

    act(() => result.current.runOne("c1"));
    act(() => result.current.runAll());

    expect(result.current.results.c1).toBeDefined();
    expect(result.current.results.c2).toBeDefined();
  });
});

describe("RunEvalsButton", () => {
  function renderButton() {
    return render(
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <SkillEvalRunProvider skill={SKILL}>
          <RunEvalsButton skill={SKILL} />
        </SkillEvalRunProvider>
      </NextIntlClientProvider>,
    );
  }

  it("is disabled with no eval cases", () => {
    renderButton();
    expect(screen.getByText("Run on evals").closest("button")).toBeDisabled();
  });

  it("fires the same eval-run request as Run all and switches to the evals tab", () => {
    state.cases = [evalCase("c1", "alpha")];
    renderButton();
    fireEvent.click(screen.getByText("Run on evals"));
    expect(runAllMutate).toHaveBeenCalledTimes(1);
    expect(runAllMutate).toHaveBeenCalledWith("sk1", expect.anything());
    expect(replace).toHaveBeenCalledWith("/skills/sk1?tab=evals");
  });

  it("is disabled while a run is in flight and a click fires no second request", () => {
    state.cases = [evalCase("c1", "alpha")];
    state.runAllPending = true;
    renderButton();
    const button = screen.getByText("Run on evals").closest("button")!;
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(runAllMutate).not.toHaveBeenCalled();
  });

  it("is disabled and explains itself via the shared copy after a 409 no_provider_key", () => {
    state.cases = [evalCase("c1", "alpha")];
    state.runError = new ApiError("no key", 409, "no_provider_key");
    renderButton();
    const button = screen.getByText("Run on evals").closest("button")!;
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "title",
      "No LLM provider key is configured, so eval runs are disabled. Add a key in Settings → API Keys and try again.",
    );
  });
});
