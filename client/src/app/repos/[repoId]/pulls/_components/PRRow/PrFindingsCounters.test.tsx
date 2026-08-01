import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/prReview.json";

const usePrReviews = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: (prId: string | null | undefined, opts?: { enabled?: boolean }) =>
    usePrReviews(prId, opts),
}));

import { PrFindingsCounters } from "./PrFindingsCounters";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("PrFindingsCounters", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePrReviews.mockClear();
    usePrReviews.mockReturnValue({ data: undefined, isPending: true });
  });
  afterEach(() => vi.useRealTimers());

  const counts = { critical: 1, warning: 1, suggestion: 0 };

  it("keeps the reviews query disabled until the row is hovered", () => {
    const { container } = renderWithIntl(<PrFindingsCounters prId="pr-1" counts={counts} />);
    expect(usePrReviews).toHaveBeenLastCalledWith("pr-1", { enabled: false });

    fireEvent.mouseEnter(container.querySelector("span") as HTMLElement);
    act(() => void vi.advanceTimersByTime(200));
    expect(usePrReviews).toHaveBeenLastCalledWith("pr-1", { enabled: true });
  });

  it("flattens findings across every review of the PR", () => {
    usePrReviews.mockReturnValue({
      isPending: false,
      data: [
        { findings: [{ id: "a", severity: "CRITICAL", category: "security", title: "From review one", file: "a.ts", start_line: 1, end_line: 1, rationale: "", confidence: 0.9, dismissed_at: null }] },
        { findings: [{ id: "b", severity: "WARNING", category: "bug", title: "From review two", file: "b.ts", start_line: 2, end_line: 2, rationale: "", confidence: 0.8, dismissed_at: null }] },
      ],
    } as never);

    const { container } = renderWithIntl(<PrFindingsCounters prId="pr-1" counts={counts} />);
    fireEvent.mouseEnter(container.querySelector("span") as HTMLElement);
    act(() => void vi.advanceTimersByTime(200));

    expect(screen.getByText("From review one")).toBeInTheDocument();
    expect(screen.getByText("From review two")).toBeInTheDocument();
  });
});
