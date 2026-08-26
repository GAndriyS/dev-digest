/**
 * AgentRow — the full-width agent row on `/eval` (AC-26, AC-37…AC-42).
 *
 * Three seams this suite asserts explicitly, not just inspects:
 *
 *   1. Exactly ONE focusable target per row (AC-37, NFR Доступність): the
 *      whole row is one `next/link` `<Link>`; the chevron is decorative and
 *      must never become a second link/button.
 *   2. `last_batch === null` is the ONLY "never run" discriminant — never
 *      `trend.length === 0` (Contract & migration impact). An agent can have
 *      a real `last_batch` and an empty `trend` (every batch it ran measured
 *      nothing) — that must still show real numbers and the meta line, not
 *      the "never run" badge.
 *   3. No hardcoded timestamp literal: the meta-line assertion is built
 *      through the SAME `formatBatchDate` helper the component uses, and
 *      separately shape-checked against `/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/` —
 *      a literal would be green in CI (UTC) and red on a developer's machine.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalAgentSummary, EvalBatchRecord, EvalTrendPoint } from "@devdigest/shared";
import evalMessages from "../../../../../../../messages/en/eval.json";
import { formatBatchDate } from "../../helpers";
import { AgentRow } from "./AgentRow";

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

function makeTrendPoint(overrides: Partial<EvalTrendPoint> = {}): EvalTrendPoint {
  return {
    ran_at: "2026-08-01T00:00:00.000Z",
    recall: 0.7,
    precision: 0.8,
    citation_accuracy: 0.75,
    pass_rate: 0.9,
    cost_usd: 0.01,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<EvalAgentSummary> = {}): EvalAgentSummary {
  return {
    agent_id: "agent-1",
    name: "Security Reviewer",
    model: "gpt-4.1",
    cases_total: 5,
    last_batch: null,
    trend: [],
    ...overrides,
  };
}

function renderRow(agent: EvalAgentSummary) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <AgentRow agent={agent} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => cleanup());

describe("AgentRow — one focusable target (AC-37)", () => {
  it("renders exactly one link, no buttons, and no second interactive element inside it", () => {
    renderRow(makeAgent({ last_batch: makeBatch() }));

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/eval/agent-1");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(links[0]!.querySelectorAll("a, button")).toHaveLength(0);
  });
});

describe("AgentRow — never-run vs empty-trend (Contract & migration impact, AC-42)", () => {
  it("last_batch === null: shows the never-run badge, an em dash for all three stats, and no sparkline", () => {
    renderRow(makeAgent({ last_batch: null, trend: [] }));

    expect(screen.getByText(evalMessages.evalsTab.neverRun)).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.queryByTestId("agent-row-sparkline")).not.toBeInTheDocument();
    expect(screen.queryByText(/pass$/)).not.toBeInTheDocument();
  });

  it("a real last_batch with an empty trend is NOT never-run: real numbers and the meta line render, no sparkline", () => {
    const batch = makeBatch({ recall: 0.8, precision: 0.9, citation_accuracy: 0.85 });
    renderRow(makeAgent({ last_batch: batch, trend: [] }));

    expect(screen.queryByText(evalMessages.evalsTab.neverRun)).not.toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-row-sparkline")).not.toBeInTheDocument();
  });

  it("a real last_batch with exactly one trend point still draws no sparkline (AC-40)", () => {
    const batch = makeBatch();
    renderRow(makeAgent({ last_batch: batch, trend: [makeTrendPoint()] }));

    expect(screen.queryByText(evalMessages.evalsTab.neverRun)).not.toBeInTheDocument();
    expect(screen.queryByTestId("agent-row-sparkline")).not.toBeInTheDocument();
  });

  it("draws the sparkline once there are at least two trend points (AC-40)", () => {
    const batch = makeBatch();
    renderRow(
      makeAgent({
        last_batch: batch,
        trend: [makeTrendPoint({ recall: 0.6 }), makeTrendPoint({ recall: 0.8 })],
      }),
    );

    expect(screen.getByTestId("agent-row-sparkline")).toBeInTheDocument();
  });

  it("places the sparkline before the stat blocks and marks it decorative, matching the mock layout", () => {
    const batch = makeBatch();
    renderRow(
      makeAgent({
        last_batch: batch,
        trend: [makeTrendPoint({ recall: 0.6 }), makeTrendPoint({ recall: 0.8 })],
      }),
    );

    const link = screen.getAllByRole("link")[0]!;
    const sparkline = screen.getByTestId("agent-row-sparkline");
    const firstStatLabel = screen.getByText(evalMessages.dashboard.metricsShort.recall);

    // DOM order, not visual order: the sparkline node comes before the stats
    // block that holds the first stat label (mock reads identity, trend,
    // then stats).
    const position = sparkline.compareDocumentPosition(firstStatLabel);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The row is a single link (AC-37); every graphic inside it that is not
    // named feeds the link's accessible name. The stats already print the
    // numbers (AC-39), so the sparkline is decorative — same treatment as
    // the icon tile and chevron, which are already aria-hidden.
    expect(sparkline).toHaveAttribute("aria-hidden", "true");
  });
});

describe("AgentRow — meta line and stats (AC-38, AC-39)", () => {
  it("renders 'Last run v<N> · <ts> · X/Y pass' with the timestamp derived through formatBatchDate, never a literal", () => {
    const batch = makeBatch({ agent_version: 7, traces_passed: 4, traces_total: 5, ran_at: "2026-06-01T10:15:00.000Z" });
    renderRow(makeAgent({ last_batch: batch }));

    const expectedTimestamp = formatBatchDate(batch.ran_at);
    expect(expectedTimestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(screen.getByText(`Last run v7 · ${expectedTimestamp} · 4/5 pass`)).toBeInTheDocument();
  });

  it("always prints a number for recall/precision and an em dash for a genuinely null citation_accuracy, never 0%", () => {
    const batch = makeBatch({ citation_accuracy: null });
    renderRow(makeAgent({ last_batch: batch }));

    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });
});

describe("AgentRow — untrusted inputs", () => {
  it("renders the agent name and model as escaped text nodes, never as markup", () => {
    const hostileName = "<script>evil()</script>".repeat(3);
    renderRow(makeAgent({ name: hostileName, model: "a-very-long-model-name-that-should-truncate-1234567890" }));

    expect(screen.getByText(hostileName)).toBeInTheDocument();
    expect(screen.getByText("a-very-long-model-name-that-should-truncate-1234567890")).toBeInTheDocument();
    expect(document.querySelector("script")).not.toBeInTheDocument();
  });
});
