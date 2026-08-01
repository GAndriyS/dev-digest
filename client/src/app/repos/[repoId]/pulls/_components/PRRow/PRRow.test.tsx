/**
 * PRRow — the COST cell. Cost is the last completed run's spend; a PR that has
 * never been reviewed (or whose model has no known price) must render an em
 * dash rather than "$NaN" or "$0.0000", so "not measured" stays distinct from
 * "measured, free".
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@/lib/types";
import messages from "../../../../../../../messages/en/prReview.json";
import { PRRow } from "./PRRow";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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
    ...o,
  };
}

function renderRow(overrides: Partial<PrMeta>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={pr(overrides)} repoId="repo-1" />
    </NextIntlClientProvider>,
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
