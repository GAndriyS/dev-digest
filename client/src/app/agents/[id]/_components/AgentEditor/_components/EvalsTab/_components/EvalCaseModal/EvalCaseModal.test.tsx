import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase } from "@devdigest/shared";
import evalMessages from "../../../../../../../../../../messages/en/eval.json";

const AGENT_ID = "ag1";

const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();

const state = {
  createPending: false,
  createError: false,
  updatePending: false,
  updateError: false,
};

vi.mock("@/lib/hooks/eval", () => ({
  useCreateAgentEvalCase: () => ({
    mutateAsync: createMutateAsync,
    isPending: state.createPending,
    isError: state.createError,
    error: null,
  }),
  useUpdateAgentEvalCase: () => ({
    mutateAsync: updateMutateAsync,
    isPending: state.updatePending,
    isError: state.updateError,
    error: null,
  }),
  // Step 7 stub: added in the same change as the export
  // (`client/INSIGHTS.md` 2026-08-20) — this modal will consume it in step 9.
  useRunAgentEvalCase: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import { EvalCaseModal } from "./EvalCaseModal";

const EXISTING: EvalCase = {
  id: "c1",
  owner_kind: "agent",
  owner_id: AGENT_ID,
  name: "block eval() of user input",
  input_diff: "@@ -1 +1 @@\n-eval(x)\n+safeEval(x)",
  input_files: null,
  input_meta: null,
  expected_output: { findings: [{ file: "a.ts", start_line: 1, end_line: 2 }] },
  notes: null,
  source_finding_id: null,
};

function renderModal(evalCase: EvalCase | null, onClose = vi.fn()) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ eval: evalMessages, common: { actions: { cancel: "Cancel" }, states: { error: "Something went wrong" } } }}
    >
      <EvalCaseModal agentId={AGENT_ID} evalCase={evalCase} onClose={onClose} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.createPending = false;
  state.createError = false;
  state.updatePending = false;
  state.updateError = false;
  createMutateAsync.mockReset();
  updateMutateAsync.mockReset();
});
afterEach(cleanup);

describe("EvalCaseModal", () => {
  it("starts a new case with an empty must_not_flag shape, valid by default, blocked by empty name/diff", () => {
    renderModal(null);
    expect(screen.getByText("valid JSON")).toBeInTheDocument();
    expect(screen.getByText("Save").closest("button")).toBeDisabled();
  });

  it("blocks save on invalid JSON and shows the invalid indicator (AC-10)", () => {
    renderModal(EXISTING);
    const jsonBox = screen.getByDisplayValue(/"file": "a.ts"/);
    fireEvent.change(jsonBox, { target: { value: "{ not json" } });
    expect(screen.getAllByText("invalid JSON").length).toBeGreaterThan(0);
    expect(screen.getByText("Save").closest("button")).toBeDisabled();
  });

  it("re-enables save once the JSON is fixed", () => {
    renderModal(EXISTING);
    const jsonBox = screen.getByDisplayValue(/"file": "a.ts"/);
    fireEvent.change(jsonBox, { target: { value: "{ not json" } });
    expect(screen.getByText("Save").closest("button")).toBeDisabled();
    fireEvent.change(jsonBox, { target: { value: "[]" } });
    expect(screen.getByText("valid JSON")).toBeInTheDocument();
    expect(screen.getByText("Save").closest("button")).not.toBeDisabled();
  });

  it("creates a case with the parsed expected_output on save", async () => {
    createMutateAsync.mockResolvedValue(EXISTING);
    const onClose = vi.fn();
    renderModal(null, onClose);

    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), {
      target: { value: "new case" },
    });
    fireEvent.change(screen.getByPlaceholderText(/--- a\/src\/config.ts/), {
      target: { value: "@@ -1 +1 @@" },
    });

    fireEvent.click(screen.getByText("Save"));
    await Promise.resolve();
    await Promise.resolve();

    expect(createMutateAsync).toHaveBeenCalledWith({
      owner_id: AGENT_ID,
      name: "new case",
      input_diff: "@@ -1 +1 @@",
      expected_output: { findings: [] },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("updates the existing case by id, not by creating a new one", async () => {
    updateMutateAsync.mockResolvedValue(EXISTING);
    const onClose = vi.fn();
    renderModal(EXISTING, onClose);

    fireEvent.click(screen.getByText("Save"));
    await Promise.resolve();
    await Promise.resolve();

    expect(updateMutateAsync).toHaveBeenCalledWith({
      agentId: AGENT_ID,
      id: "c1",
      patch: {
        name: EXISTING.name,
        input_diff: EXISTING.input_diff,
        expected_output: EXISTING.expected_output,
      },
    });
    expect(createMutateAsync).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the modal open and shows the failure on a rejected save", async () => {
    createMutateAsync.mockRejectedValue(new Error("boom"));
    state.createError = true;
    const onClose = vi.fn();
    renderModal(null, onClose);

    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), {
      target: { value: "new case" },
    });
    fireEvent.change(screen.getByPlaceholderText(/--- a\/src\/config.ts/), {
      target: { value: "@@ -1 +1 @@" },
    });
    fireEvent.click(screen.getByText("Save"));
    await Promise.resolve();
    await Promise.resolve();

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("closes without saving on Cancel", () => {
    const onClose = vi.fn();
    renderModal(null, onClose);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(createMutateAsync).not.toHaveBeenCalled();
  });
});
