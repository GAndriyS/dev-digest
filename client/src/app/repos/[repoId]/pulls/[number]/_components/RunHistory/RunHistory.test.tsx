/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: 0.0013,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    ...o,
  };
}

function renderRuns(runs: RunSummary[], props: Partial<React.ComponentProps<typeof RunHistory>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} onOpenTrace={() => {}} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

describe("RunHistory — severity counters", () => {
  const COUNTS = { "run-1": { critical: 2, warning: 1, suggestion: 0 } };

  it("shows a counter per severity found by that run, omitting empty ones", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 2, score: 38 })], {
      severityByRun: COUNTS,
      onSelectSeverity: () => {},
    });
    expect(screen.getByLabelText("2 critical")).toBeInTheDocument();
    expect(screen.getByLabelText("1 warning")).toBeInTheDocument();
    expect(screen.queryByLabelText(/suggestion/)).not.toBeInTheDocument();
  });

  it("reports the run and severity that were clicked", () => {
    const onSelectSeverity = vi.fn();
    renderRuns([run({ status: "done", findings_count: 3, blockers: 2, score: 38 })], {
      severityByRun: COUNTS,
      onSelectSeverity,
    });
    fireEvent.click(screen.getByLabelText("2 critical"));
    expect(onSelectSeverity).toHaveBeenCalledWith("run-1", "CRITICAL");
  });

  it("shows no counters for a run that never persisted a review", () => {
    renderRuns([run({ run_id: "run-2", status: "done", findings_count: 0, blockers: 0 })], {
      severityByRun: COUNTS,
      onSelectSeverity: () => {},
    });
    expect(screen.queryByLabelText(/critical/)).not.toBeInTheDocument();
  });

  it("previews that run's findings on hover, with no extra fetch", () => {
    vi.useFakeTimers();
    try {
      renderRuns([run({ status: "done", findings_count: 3, blockers: 2, score: 38 })], {
        severityByRun: COUNTS,
        findingsByRun: {
          "run-1": [
            {
              id: "f1",
              review_id: "rev-1",
              severity: "CRITICAL",
              category: "security",
              title: "Hardcoded Stripe secret key",
              file: "src/config.ts",
              start_line: 12,
              end_line: 12,
              rationale: "Line 12 contains a literal `sk_live_` string.",
              confidence: 0.98,
              accepted_at: null,
              dismissed_at: null,
            },
          ],
        } as never,
      });
      fireEvent.mouseEnter(screen.getByLabelText("2 critical").parentElement as HTMLElement);
      act(() => void vi.advanceTimersByTime(200));
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
