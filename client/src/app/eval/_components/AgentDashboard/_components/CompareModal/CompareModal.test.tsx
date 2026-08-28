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

/** Both snapshots present and identical — the common setup for the tests that
    are about the cards rather than the diff. */
function bothPrompts(prompt: string) {
  for (const v of [1, 2, 3, 6, 7]) {
    versionState.set(v, { data: { config: { system_prompt: prompt } }, isLoading: false, isError: false });
  }
}

beforeEach(() => {
  versionState.clear();
  onClose.mockReset();
});

afterEach(() => cleanup());

describe("CompareModal", () => {
  it("names both versions in the title, older → newer, whatever order they were selected in (AC-33)", () => {
    bothPrompts("Be careful.");
    const earlier = makeBatch({ agent_version: 6, ran_at: "2026-08-20T00:00:00.000Z" });
    const later = makeBatch({ agent_version: 7, ran_at: "2026-08-21T00:00:00.000Z" });

    // Passed in reverse (later, earlier) — the component sorts by ran_at.
    renderModal([later, earlier]);

    expect(screen.getByText("Compare runs · v6 → v7")).toBeInTheDocument();
  });

  it("renders one card per metric: caption, before → after, and a delta badge (AC-33, AC-72)", () => {
    bothPrompts("Be careful.");
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

    renderModal([later, earlier]);

    for (const caption of ["RECALL", "PRECISION", "CITATION", "COST"]) {
      expect(screen.getByText(caption)).toBeInTheDocument();
    }
    // Before AND after, not just the delta — the whole point of the card.
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("$0.0100")).toBeInTheDocument();
    expect(screen.getByText("$0.0200")).toBeInTheDocument();
    // Magnitude is unsigned — the arrow carries the direction.
    expect(screen.getByText(/▲\s*10\.0 pt/)).toBeInTheDocument();
    expect(screen.getByText(/▲\s*15\.0 pt/)).toBeInTheDocument();
  });

  it("colours a delta by whether the metric IMPROVED — so a cost rise is red while a recall rise is green (AC-74)", () => {
    bothPrompts("x");
    const earlier = makeBatch({ agent_version: 1, ran_at: "2026-08-20T00:00:00.000Z", recall: 0.7, cost_usd: 0.01 });
    // Both go UP. Same sign, opposite meaning.
    const later = makeBatch({ agent_version: 2, ran_at: "2026-08-21T00:00:00.000Z", recall: 0.8, cost_usd: 0.02 });

    renderModal([earlier, later]);

    const recallBadge = screen.getByText(/▲\s*10\.0 pt/);
    // The badge carries the DELTA (0.02 - 0.01), not the after value.
    const costBadge = screen.getByText(/▲\s*\$0\.0100/);
    // Asserted on colour, never on border — `client/INSIGHTS.md`.
    expect(recallBadge).toHaveStyle({ color: "var(--ok)" });
    expect(costBadge).toHaveStyle({ color: "var(--crit)" });
  });

  it("shows an unmoved metric as a neutral badge with no arrow, never as an empty slot (AC-75)", () => {
    bothPrompts("x");
    const earlier = makeBatch({ agent_version: 1, ran_at: "2026-08-20T00:00:00.000Z" });
    const later = makeBatch({ agent_version: 2, ran_at: "2026-08-21T00:00:00.000Z" });

    renderModal([earlier, later]);

    // Identical batches: three "0.0 pt" badges and one "$0.0000".
    expect(screen.getAllByText("0.0 pt")).toHaveLength(3);
    const cost = screen.getByText("$0.0000");
    expect(cost).toHaveStyle({ color: "var(--text-muted)" });
    expect(screen.queryByText(/▲|▼/)).toBeNull();
  });

  it("omits the badge entirely when a side is null — not measured is not unchanged (AC-78)", () => {
    bothPrompts("x");
    const earlier = makeBatch({
      agent_version: 1,
      ran_at: "2026-08-20T00:00:00.000Z",
      citation_accuracy: null,
      cost_usd: 0.01,
    });
    const later = makeBatch({
      agent_version: 2,
      ran_at: "2026-08-21T00:00:00.000Z",
      citation_accuracy: 0.9,
      cost_usd: null,
    });

    renderModal([earlier, later]);

    // The value row still shows the em dash for the missing side…
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    // …and the two intact metrics still carry their badges, so the omission
    // is per-card rather than the section giving up.
    expect(screen.getAllByText("0.0 pt")).toHaveLength(2);
  });

  it("reads sensibly when both runs are on the same version: no legend, an explanation, no empty frame (AC-79)", () => {
    bothPrompts("x");
    const earlier = makeBatch({ agent_version: 3, ran_at: "2026-08-20T00:00:00.000Z" });
    const later = makeBatch({ agent_version: 3, ran_at: "2026-08-21T00:00:00.000Z" });

    renderModal([earlier, later]);

    expect(screen.getByText("Compare runs · v3")).toBeInTheDocument();
    expect(screen.getByText(/Both runs were made on v3/)).toBeInTheDocument();
    expect(screen.queryByText(/\(old\)/)).toBeNull();
    expect(screen.queryByText(/\(new\)/)).toBeNull();
  });

  it("labels the diff with a swatch legend naming each version (AC-76, AC-77)", () => {
    versionState.set(6, { data: { config: { system_prompt: "line one\nline two" } }, isLoading: false, isError: false });
    versionState.set(7, {
      data: { config: { system_prompt: "line one\nline three" } },
      isLoading: false,
      isError: false,
    });

    renderModal([
      makeBatch({ agent_version: 6, ran_at: "2026-08-20T00:00:00.000Z" }),
      makeBatch({ agent_version: 7, ran_at: "2026-08-21T00:00:00.000Z" }),
    ]);

    expect(screen.getByText("SYSTEM PROMPT DIFF")).toBeInTheDocument();
    expect(screen.getByText("v6 (old)")).toBeInTheDocument();
    expect(screen.getByText("v7 (new)")).toBeInTheDocument();
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
