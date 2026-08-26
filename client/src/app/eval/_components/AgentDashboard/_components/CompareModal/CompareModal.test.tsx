import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalBatchRecord } from "@devdigest/shared";
import evalMessages from "../../../../../../../messages/en/eval.json";

const AGENT_ID = "agent-1";

const versionState = new Map<
  number,
  { data?: { config: { system_prompt: string } }; isLoading: boolean; isError: boolean }
>();

const onClose = vi.fn();

vi.mock("@/lib/hooks/eval", () => ({
  useAgentVersionSnapshot: (_agentId: string | null | undefined, version: number | null | undefined) =>
    versionState.get(version ?? -1) ?? { data: undefined, isLoading: false, isError: true },
}));

import { CompareModal } from "./CompareModal";

function makeBatch(overrides: Partial<EvalBatchRecord> = {}): EvalBatchRecord {
  return {
    batch_id: "batch-1",
    agent_id: AGENT_ID,
    agent_name: "Security Reviewer",
    agent_version: 1,
    ran_at: "2026-08-20T00:00:00.000Z",
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 0.85,
    traces_passed: 4,
    traces_total: 5,
    cases_errored: 0,
    duration_ms: 4000,
    cost_usd: 0.01,
    ...overrides,
  };
}

function renderModal(batches: [EvalBatchRecord, EvalBatchRecord]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <CompareModal agentId={AGENT_ID} batches={batches} onClose={onClose} />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  versionState.clear();
  onClose.mockReset();
});

afterEach(() => cleanup());

describe("CompareModal", () => {
  it("shows signed metric and cost deltas, later-minus-earlier regardless of selection order (AC-33)", () => {
    versionState.set(1, { data: { config: { system_prompt: "Be careful." } }, isLoading: false, isError: false });
    versionState.set(2, { data: { config: { system_prompt: "Be careful." } }, isLoading: false, isError: false });

    const earlier = makeBatch({
      agent_version: 1,
      ran_at: "2026-08-20T00:00:00.000Z",
      recall: 0.7,
      precision: 0.9,
      citation_accuracy: 0.5,
      cost_usd: 0.01,
    });
    const later = makeBatch({
      agent_version: 2,
      ran_at: "2026-08-21T00:00:00.000Z",
      recall: 0.8,
      precision: 0.9,
      citation_accuracy: 0.65,
      cost_usd: 0.02,
    });

    // Pass them in reverse (later, earlier) — the component sorts by ran_at.
    renderModal([later, earlier]);

    expect(screen.getByText("+10.0 pt")).toBeInTheDocument(); // recall: 0.8 - 0.7
    expect(screen.getByText("0.0 pt")).toBeInTheDocument(); // precision: unchanged, still shown (AC-33's zero delta)
    expect(screen.getByText("+15.0 pt")).toBeInTheDocument(); // citation: 0.65 - 0.5
    expect(screen.getByText("+$0.0100")).toBeInTheDocument(); // cost: 0.02 - 0.01
  });

  it("shows an em dash for the citation delta when either batch's citation_accuracy is null (null-metric rule)", () => {
    versionState.set(1, { data: { config: { system_prompt: "x" } }, isLoading: false, isError: false });
    versionState.set(2, { data: { config: { system_prompt: "x" } }, isLoading: false, isError: false });

    const earlier = makeBatch({ agent_version: 1, ran_at: "2026-08-20T00:00:00.000Z", citation_accuracy: null });
    const later = makeBatch({ agent_version: 2, ran_at: "2026-08-21T00:00:00.000Z", citation_accuracy: 0.9 });

    renderModal([earlier, later]);

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders the prompt diff (add/remove lines) when both version snapshots load", () => {
    versionState.set(1, { data: { config: { system_prompt: "line one\nline two" } }, isLoading: false, isError: false });
    versionState.set(2, { data: { config: { system_prompt: "line one\nline three" } }, isLoading: false, isError: false });

    const earlier = makeBatch({ agent_version: 1, ran_at: "2026-08-20T00:00:00.000Z" });
    const later = makeBatch({ agent_version: 2, ran_at: "2026-08-21T00:00:00.000Z" });

    renderModal([earlier, later]);

    expect(screen.getByText("line one")).toBeInTheDocument();
    expect(screen.getByText("line two")).toBeInTheDocument();
    expect(screen.getByText("line three")).toBeInTheDocument();
  });

  it("shows promptDiffUnavailable, not an empty block, when a version snapshot 404s (AC-34)", () => {
    versionState.set(1, { data: { config: { system_prompt: "x" } }, isLoading: false, isError: false });
    versionState.set(2, {
      data: undefined,
      isLoading: false,
      isError: true,
    });

    const earlier = makeBatch({ agent_version: 1, ran_at: "2026-08-20T00:00:00.000Z" });
    const later = makeBatch({ agent_version: 2, ran_at: "2026-08-21T00:00:00.000Z" });

    renderModal([earlier, later]);

    expect(screen.getByText(evalMessages.compare.promptDiffUnavailable)).toBeInTheDocument();
    // Metric deltas still render even though the prompt diff is unavailable.
    expect(screen.getByText(evalMessages.compare.metricsHeading)).toBeInTheDocument();
  });

  it("calls onClose from the footer Close button", () => {
    versionState.set(1, { data: { config: { system_prompt: "x" } }, isLoading: false, isError: false });
    versionState.set(2, { data: { config: { system_prompt: "x" } }, isLoading: false, isError: false });

    renderModal([
      makeBatch({ agent_version: 1, ran_at: "2026-08-20T00:00:00.000Z" }),
      makeBatch({ agent_version: 2, ran_at: "2026-08-21T00:00:00.000Z" }),
    ]);

    // Two buttons share the accessible name "Close": the modal chrome's own X
    // (IconBtn label="Close") and the footer's explicit Close button — the
    // footer one is the one this component renders itself.
    const closeButtons = screen.getAllByRole("button", { name: evalMessages.compare.close });
    fireEvent.click(closeButtons[closeButtons.length - 1]!);
    expect(onClose).toHaveBeenCalled();
  });
});
