import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase, EvalRunRecord } from "@devdigest/shared";
import evalMessages from "../../../../../../../../../../messages/en/eval.json";

const AGENT_ID = "ag1";

const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();
const runMutateAsync = vi.fn();
const runMutate = vi.fn();

const state = {
  createPending: false,
  createError: false,
  updatePending: false,
  updateError: false,
  runPending: false,
  runError: null as unknown,
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
  // The real predicate (`src/lib/hooks/eval.ts`) is `error instanceof ApiError
  // && error.status === 409 && error.code === "no_provider_key"`. Mocked here
  // against a plain `{ code }` shape so a test never has to construct a real
  // `ApiError` just to simulate the 409.
  isNoProviderKeyError: (error: unknown) =>
    Boolean(error) && typeof error === "object" && (error as { code?: string }).code === "no_provider_key",
  // Step 7 stub (wave 2), wired up for real by step 9 (this test file).
  useRunAgentEvalCase: () => ({
    mutate: runMutate,
    mutateAsync: runMutateAsync,
    isPending: state.runPending,
    isError: state.runError != null,
    error: state.runError,
  }),
}));

import { EvalCaseModal } from "./EvalCaseModal";

function makeCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
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
    expectation_kind: "must_find",
    ...overrides,
  };
}

function makeRun(overrides: Partial<EvalRunRecord> = {}): EvalRunRecord {
  return {
    id: "r1",
    case_id: "c1",
    case_name: "block eval() of user input",
    batch_id: null,
    agent_version: 1,
    ran_at: "2026-08-27T00:00:00.000Z",
    actual_output: { findings: [] },
    error: null,
    pass: true,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    duration_ms: 1200,
    cost_usd: 0.001,
    ...overrides,
  };
}

const EXISTING = makeCase();

function renderModal(evalCase: EvalCase | null, onClose = vi.fn(), lastRun?: EvalRunRecord) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ eval: evalMessages, common: { actions: { cancel: "Cancel" }, states: { error: "Something went wrong" } } }}
    >
      <EvalCaseModal agentId={AGENT_ID} evalCase={evalCase} lastRun={lastRun} onClose={onClose} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.createPending = false;
  state.createError = false;
  state.updatePending = false;
  state.updateError = false;
  state.runPending = false;
  state.runError = null;
  createMutateAsync.mockReset();
  updateMutateAsync.mockReset();
  runMutateAsync.mockReset();
  runMutate.mockReset();
});
afterEach(cleanup);

describe("EvalCaseModal — form (AC-10)", () => {
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

    await waitFor(() =>
      expect(createMutateAsync).toHaveBeenCalledWith({
        owner_id: AGENT_ID,
        name: "new case",
        input_diff: "@@ -1 +1 @@",
        expected_output: { findings: [] },
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // Run on save is off by default (AC-67) — a plain save never runs anything.
    expect(runMutateAsync).not.toHaveBeenCalled();
  });

  it("updates the existing case by id, not by creating a new one", async () => {
    updateMutateAsync.mockResolvedValue(EXISTING);
    const onClose = vi.fn();
    renderModal(EXISTING, onClose);

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(updateMutateAsync).toHaveBeenCalledWith({
        agentId: AGENT_ID,
        id: "c1",
        patch: {
          name: EXISTING.name,
          input_diff: EXISTING.input_diff,
          expected_output: EXISTING.expected_output,
        },
      }),
    );
    expect(createMutateAsync).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
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

    await waitFor(() => expect(screen.getByText("Something went wrong")).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes without saving on Cancel", () => {
    const onClose = vi.fn();
    renderModal(null, onClose);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(createMutateAsync).not.toHaveBeenCalled();
  });
});

describe("EvalCaseModal — title and subtitle (AC-59)", () => {
  it("titles a new case 'New eval case' and subtitles it as hand-made", () => {
    renderModal(null);
    expect(screen.getByText("New eval case")).toBeInTheDocument();
    expect(screen.getByText("Created by hand · assert the expected output")).toBeInTheDocument();
  });

  it("subtitles a case seeded from an accepted finding", () => {
    const accepted = makeCase({ source_finding_id: "f1", expectation_kind: "must_find" });
    renderModal(accepted);
    expect(screen.getByText("Seeded from an accepted finding · assert the expected output")).toBeInTheDocument();
  });

  it("subtitles a case seeded from a dismissed finding", () => {
    const dismissed = makeCase({
      source_finding_id: "f2",
      expectation_kind: "must_not_flag",
      expected_output: { findings: [] },
    });
    renderModal(dismissed);
    expect(screen.getByText("Seeded from a dismissed finding · assert the expected output")).toBeInTheDocument();
  });

  it("subtitles a hand-made existing case (no source finding) as manual", () => {
    renderModal(EXISTING);
    expect(screen.getByText("Created by hand · assert the expected output")).toBeInTheDocument();
  });
});

describe("EvalCaseModal — kind banner (AC-60/61/62)", () => {
  it("shows a POSITIVE CASE banner with one MUST find line per expectation, falling back to the case name", () => {
    const positive = makeCase({
      expectation_kind: "must_find",
      expected_output: {
        findings: [
          { file: "a.ts", start_line: 1, title: "block eval() of user input" },
          { file: "b.ts", start_line: 9 },
        ],
      },
    });
    renderModal(positive);
    expect(screen.getByText("POSITIVE CASE")).toBeInTheDocument();
    expect(screen.getByText('MUST find "block eval() of user input" at a.ts:1')).toBeInTheDocument();
    // No title on the second expectation -> falls back to the case's own name.
    expect(screen.getByText(`MUST find "${positive.name}" at b.ts:9`)).toBeInTheDocument();
  });

  it("shows a NEGATIVE CASE banner with MUST NOT flag and lists no findings", () => {
    const negative = makeCase({ expectation_kind: "must_not_flag", expected_output: { findings: [] } });
    renderModal(negative);
    expect(screen.getByText("NEGATIVE CASE")).toBeInTheDocument();
    expect(screen.getByText("MUST NOT flag")).toBeInTheDocument();
    expect(screen.queryByText(/MUST find/)).not.toBeInTheDocument();
  });

  it("renders a finding title containing markup as plain escaped text, never as an element (untrusted input)", () => {
    const withMarkup = makeCase({
      expectation_kind: "must_find",
      expected_output: { findings: [{ file: "a.ts", start_line: 1, title: "<b>bold</b>" }] },
    });
    const { container } = renderModal(withMarkup);
    expect(screen.getByText('MUST find "<b>bold</b>" at a.ts:1')).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
  });
});

describe("EvalCaseModal — stored-kind mismatch warning (AC-58)", () => {
  it("warns when a must_find case has zero expectations", () => {
    const mismatched = makeCase({ expectation_kind: "must_find", expected_output: { findings: [] } });
    renderModal(mismatched);
    expect(screen.getByText("Stored as must_find, but expected output has 0 findings")).toBeInTheDocument();
  });

  it("warns when a must_not_flag case has some expectations (mirrored direction)", () => {
    const mismatched = makeCase({
      expectation_kind: "must_not_flag",
      expected_output: { findings: [{ file: "a.ts", start_line: 1, end_line: 2 }] },
    });
    renderModal(mismatched);
    expect(screen.getByText("Stored as must_not_flag, but expected output has 1 finding")).toBeInTheDocument();
  });

  it("shows no mismatch warning when the stored kind agrees with the expectations", () => {
    renderModal(EXISTING); // must_find with one expectation
    expect(screen.queryByText(/^Stored as/)).not.toBeInTheDocument();
  });
});

describe("EvalCaseModal — Actual output panel (AC-65/66/69)", () => {
  it("shows 'Never run yet' with no metrics when the case has never run", () => {
    renderModal(EXISTING);
    expect(screen.getByText("Never run yet")).toBeInTheDocument();
    expect(screen.queryByText(/recall/)).not.toBeInTheDocument();
  });

  it("shows pass, the three metrics, duration and the model's findings as text on a scored run", () => {
    const run = makeRun({
      pass: true,
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      duration_ms: 1200,
      actual_output: { findings: [{ title: "X", file: "a.ts", start_line: 3, severity: "high" }] },
    });
    renderModal(EXISTING, vi.fn(), run);
    expect(screen.getByText("Last run passed")).toBeInTheDocument();
    expect(screen.getByText("recall 100% · precision 100% · citation 100% · 1.2s")).toBeInTheDocument();
    expect(screen.getByText("[HIGH] X — a.ts:3")).toBeInTheDocument();
  });

  it("shows the failure reason, never the diff, on an errored run", () => {
    const run = makeRun({
      pass: null,
      recall: null,
      precision: null,
      citation_accuracy: null,
      error: { code: "provider_error", message: "The provider timed out" },
      actual_output: null,
    });
    renderModal(EXISTING, vi.fn(), run);
    expect(screen.getByText("Run failed: The provider timed out")).toBeInTheDocument();
    // The authored diff stays intact in its own field, untouched by the failure
    // (a regex, not an exact string: the default normalizer collapses the
    // diff's newlines when matching the DOM value but never touches the
    // matcher string, so an exact multi-line string never matches here).
    expect(screen.getByDisplayValue(/eval\(x\)/)).toBeInTheDocument();
  });
});

describe("EvalCaseModal — Run case (AC-63/64)", () => {
  it("runs exactly this case and displays the mutation's own returned record, not a stale prop", async () => {
    const staleRun = makeRun({ id: "old", pass: false, recall: 0, precision: 0, citation_accuracy: 0 });
    const freshRun = makeRun({ id: "new", pass: true });
    runMutateAsync.mockResolvedValue(freshRun);
    renderModal(EXISTING, vi.fn(), staleRun);

    expect(screen.getByText("Last run failed")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Run case"));

    expect(runMutateAsync).toHaveBeenCalledWith({ agentId: AGENT_ID, caseId: EXISTING.id });
    await waitFor(() => expect(screen.getByText("Last run passed")).toBeInTheDocument());
  });

  it("shows Running… and disables Run case while a run is pending", () => {
    state.runPending = true;
    renderModal(EXISTING);
    expect(screen.getByText("Running…").closest("button")).toBeDisabled();
  });

  it("disables Run case with a visible reason on an unsaved new case", () => {
    renderModal(null);
    expect(screen.getByText("Run case").closest("button")).toBeDisabled();
    expect(screen.getByText("Save the case before running it")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Run case"));
    expect(runMutateAsync).not.toHaveBeenCalled();
  });
});

describe("EvalCaseModal — Run on save (AC-67)", () => {
  it("does not run on save while Run on save is off (default at every opening)", async () => {
    createMutateAsync.mockResolvedValue(EXISTING);
    const onClose = vi.fn();
    renderModal(null, onClose);
    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), { target: { value: "new case" } });
    fireEvent.change(screen.getByPlaceholderText(/--- a\/src\/config.ts/), { target: { value: "@@ -1 +1 @@" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(runMutateAsync).not.toHaveBeenCalled();
  });

  it("runs the just-saved case after a successful save when Run on save is on, and keeps the modal open", async () => {
    const created = makeCase({ id: "brand-new" });
    createMutateAsync.mockResolvedValue(created);
    runMutateAsync.mockResolvedValue(makeRun({ case_id: created.id, pass: true }));
    const onClose = vi.fn();
    renderModal(null, onClose);

    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), { target: { value: "new case" } });
    fireEvent.change(screen.getByPlaceholderText(/--- a\/src\/config.ts/), { target: { value: "@@ -1 +1 @@" } });
    fireEvent.click(screen.getByRole("switch")); // turn Run on save on
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(runMutateAsync).toHaveBeenCalledWith({ agentId: AGENT_ID, caseId: "brand-new" }),
    );
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Last run passed")).toBeInTheDocument());
  });

  it("presents the newly created case as saved: banner shown, Run case enabled, no runNeedsSave reason", async () => {
    const created = makeCase({ id: "brand-new", expectation_kind: "must_find" });
    createMutateAsync.mockResolvedValue(created);
    runMutateAsync.mockResolvedValue(makeRun({ case_id: created.id, pass: true }));
    renderModal(null, vi.fn());

    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), { target: { value: "new case" } });
    fireEvent.change(screen.getByPlaceholderText(/--- a\/src\/config.ts/), { target: { value: "@@ -1 +1 @@" } });
    fireEvent.click(screen.getByRole("switch")); // turn Run on save on
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(screen.getByText("Last run passed")).toBeInTheDocument());

    // The case now exists (and has a stored kind), so it no longer presents
    // as unsaved: the POSITIVE/NEGATIVE banner appears and "Run case" is
    // enabled with no "Save the case before running it" reason.
    expect(screen.getByText("POSITIVE CASE")).toBeInTheDocument();
    expect(screen.getByText("Run case").closest("button")).not.toBeDisabled();
    expect(screen.queryByText("Save the case before running it")).not.toBeInTheDocument();

    // Re-running from here works without closing and reopening the modal.
    fireEvent.click(screen.getByText("Run case"));
    expect(runMutateAsync).toHaveBeenCalledWith({ agentId: AGENT_ID, caseId: "brand-new" });
  });

  it("updates, not creates, on a second Save after Run on save created the case", async () => {
    const created = makeCase({ id: "brand-new" });
    createMutateAsync.mockResolvedValue(created);
    updateMutateAsync.mockResolvedValue(created);
    runMutateAsync.mockResolvedValue(makeRun({ case_id: created.id, pass: true }));
    renderModal(null, vi.fn());

    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), { target: { value: "new case" } });
    fireEvent.change(screen.getByPlaceholderText(/--- a\/src\/config.ts/), { target: { value: "@@ -1 +1 @@" } });
    fireEvent.click(screen.getByRole("switch")); // turn Run on save on
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Last run passed")).toBeInTheDocument());

    // Turn Run on save back off, tweak the expected-output JSON and save
    // again — this must UPDATE the row the first Save just created, never
    // mint a second case via `create` (the regression: the branch used to key
    // off the never-changing `evalCase` prop instead of the just-saved case).
    fireEvent.click(screen.getByRole("switch"));
    const jsonBox = screen.getByDisplayValue(/"findings": \[\]/);
    fireEvent.change(jsonBox, {
      target: { value: '{ "findings": [{ "file": "a.ts", "start_line": 1 }] }' },
    });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(updateMutateAsync).toHaveBeenCalledWith({
        agentId: AGENT_ID,
        id: "brand-new",
        patch: {
          name: "new case",
          input_diff: "@@ -1 +1 @@",
          expected_output: { findings: [{ file: "a.ts", start_line: 1 }] },
        },
      }),
    );
    expect(createMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("does not run when Run on save is on but the save itself fails", async () => {
    createMutateAsync.mockRejectedValue(new Error("boom"));
    state.createError = true;
    const onClose = vi.fn();
    renderModal(null, onClose);

    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), { target: { value: "new case" } });
    fireEvent.change(screen.getByPlaceholderText(/--- a\/src\/config.ts/), { target: { value: "@@ -1 +1 @@" } });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(screen.getByText("Something went wrong")).toBeInTheDocument());
    expect(runMutateAsync).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("EvalCaseModal — no provider key (AC-68)", () => {
  it("disables Run case and Run on save, with a visible reason", () => {
    state.runError = { code: "no_provider_key", message: "no key" };
    renderModal(EXISTING);

    expect(screen.getByText("Run case").closest("button")).toBeDisabled();
    expect(screen.getByRole("switch").parentElement).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText(
        "No LLM provider key is configured, so eval runs are disabled. Add a key in Settings → API Keys and try again.",
      ),
    ).toBeInTheDocument();

    // The guarded onChange never flips state while disabled.
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");

    fireEvent.click(screen.getByText("Run case"));
    expect(runMutateAsync).not.toHaveBeenCalled();
  });
});
