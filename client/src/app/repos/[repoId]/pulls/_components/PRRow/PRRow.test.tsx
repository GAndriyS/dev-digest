/**
 * PRRow — the COST cell and the FINDINGS cell. Cost is the last completed run's
 * spend; a PR that has never been reviewed (or whose model has no known price)
 * must render an em dash rather than "$NaN" or "$0.0000", so "not measured"
 * stays distinct from "measured, free". The findings cell shows a per-severity
 * breakdown that deep-links into the pre-filtered detail page.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrMeta } from "@/lib/types";
import messages from "../../../../../../../messages/en/prReview.json";
import { PRRow } from "./PRRow";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

beforeEach(() => push.mockClear());
afterEach(cleanup);

function pr(o: Partial<PrMeta>): PrMeta {
  return {
    id: "pr-1",
    number: 482,
    title: "Add rate limiting to public API endpoints",
    author: "marisa.koch",
    branch: "feat/rate-limit-public",
    base: "main",
    head_sha: "abc123",
    additions: 247,
    deletions: 38,
    files_count: 9,
    status: "needs_review",
    opened_at: "2026-06-11T18:00:00.000Z",
    updated_at: "2026-06-11T18:44:34.000Z",
    score: 61,
    cost_usd: null,
    finding_counts: { critical: 2, warning: 2, suggestion: 2 },
    ...o,
  };
}

function renderRow(overrides: Partial<PrMeta>) {
  return render(
    // The findings cell lazily queries the PR's reviews for its hover card, so
    // the row needs a query client even though nothing fetches until hover.
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <PRRow pr={pr(overrides)} repoId="repo-1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("PRRow cost cell", () => {
  it("renders the cost with four decimals", () => {
    renderRow({ cost_usd: 0.014 });
    expect(screen.getByText("$0.0140")).toBeInTheDocument();
  });

  it("keeps sub-cent runs visible instead of flattening them to $0.00", () => {
    renderRow({ cost_usd: 0.0013 });
    expect(screen.getByText("$0.0013")).toBeInTheDocument();
  });

  it("renders an em dash when the PR has no completed run", () => {
    renderRow({ cost_usd: null });
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});

describe("PRRow findings cell", () => {
  it("shows a counter per severity, omitting the ones with no findings", () => {
    renderRow({ finding_counts: { critical: 2, warning: 0, suggestion: 4 } });
    expect(screen.getByLabelText("2 critical")).toBeInTheDocument();
    expect(screen.getByLabelText("4 suggestion")).toBeInTheDocument();
    expect(screen.queryByLabelText(/warning/)).not.toBeInTheDocument();
  });

  it("renders an em dash when nothing was found (or the PR was never reviewed)", () => {
    renderRow({ finding_counts: { critical: 0, warning: 0, suggestion: 0 }, cost_usd: 0.014 });
    expect(screen.getByText("—")).toBeInTheDocument();
    cleanup();
    renderRow({ finding_counts: null, cost_usd: 0.014 });
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("deep-links into the detail page pre-filtered to the clicked severity", () => {
    renderRow({ finding_counts: { critical: 3, warning: 1, suggestion: 0 } });
    fireEvent.click(screen.getByLabelText("3 critical"));
    expect(push).toHaveBeenCalledWith("/repos/repo-1/pulls/482?tab=findings&severity=CRITICAL");
    // the row's own navigation must not fire alongside it
    expect(push).toHaveBeenCalledTimes(1);
  });
});
