import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";
import { SeverityCounters } from "./SeverityCounters";
import { sortForPopover, stripMarkdownInline, placePopover } from "./popoverHelpers";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

let seq = 0;
function finding(over: Partial<FindingRecord> = {}): FindingRecord {
  seq += 1;
  return {
    id: `f${seq}`,
    review_id: "r1",
    severity: "CRITICAL",
    category: "security",
    title: `Finding ${seq}`,
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "Something is wrong here.",
    confidence: 0.9,
    accepted_at: null,
    dismissed_at: null,
    ...over,
  } as FindingRecord;
}

/** Hover the chips and let the open delay elapse. */
function hoverOpen(el: HTMLElement) {
  fireEvent.mouseEnter(el);
  act(() => void vi.advanceTimersByTime(200));
}

describe("FindingsPopover via SeverityCounters", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const counts = { critical: 1, warning: 1, suggestion: 0 };
  const two = [
    finding({ severity: "CRITICAL", title: "Hardcoded Stripe secret key" }),
    finding({
      severity: "WARNING",
      title: "N+1 query in user list",
      file: "src/api/users.ts",
      confidence: 0.86,
    }),
  ];

  function wrapOf(container: HTMLElement) {
    return container.querySelector("span") as HTMLElement;
  }

  it("opens only after the hover delay", () => {
    const { container } = renderWithIntl(
      <SeverityCounters counts={counts} findings={two} />,
    );
    fireEvent.mouseEnter(wrapOf(container));
    act(() => void vi.advanceTimersByTime(100));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(100));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("does not open when the cursor only passes through", () => {
    const { container } = renderWithIntl(
      <SeverityCounters counts={counts} findings={two} />,
    );
    const wrap = wrapOf(container);
    fireEvent.mouseEnter(wrap);
    act(() => void vi.advanceTimersByTime(80));
    fireEvent.mouseLeave(wrap);
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("signals hover start immediately, before the popover opens", () => {
    const onFindingsHoverStart = vi.fn();
    const { container } = renderWithIntl(
      <SeverityCounters counts={counts} onFindingsHoverStart={onFindingsHoverStart} />,
    );
    fireEvent.mouseEnter(wrapOf(container));
    expect(onFindingsHoverStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows a header matching the chip counts, and the findings", () => {
    const { container } = renderWithIntl(
      <SeverityCounters counts={counts} findings={two} />,
    );
    hoverOpen(wrapOf(container));
    expect(screen.getByText("2 findings")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
    expect(screen.getByText("90% conf")).toBeInTheDocument();
  });

  it("shows placeholders while the findings are still loading", () => {
    const { container } = renderWithIntl(
      <SeverityCounters counts={counts} findingsLoading onFindingsHoverStart={() => {}} />,
    );
    hoverOpen(wrapOf(container));
    expect(screen.getByRole("tooltip").querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();
  });

  it("caps the list at three and counts the remainder", () => {
    const many = [
      finding({ severity: "SUGGESTION", title: "Sugg" }),
      finding({ severity: "WARNING", title: "Warn A", confidence: 0.5 }),
      finding({ severity: "WARNING", title: "Warn B", confidence: 0.95 }),
      finding({ severity: "CRITICAL", title: "Crit A" }),
      finding({ severity: "CRITICAL", title: "Crit B" }),
    ];
    const { container } = renderWithIntl(
      <SeverityCounters counts={{ critical: 2, warning: 2, suggestion: 1 }} findings={many} />,
    );
    hoverOpen(wrapOf(container));
    expect(screen.getByText("Crit A")).toBeInTheDocument();
    expect(screen.getByText("Crit B")).toBeInTheDocument();
    // Worst-first: both criticals, then the more confident warning.
    expect(screen.getByText("Warn B")).toBeInTheDocument();
    expect(screen.queryByText("Warn A")).not.toBeInTheDocument();
    expect(screen.getByText("and 2 more")).toBeInTheDocument();
  });

  it("stays open while the cursor is inside it, and closes after leaving", () => {
    const { container } = renderWithIntl(
      <SeverityCounters counts={counts} findings={two} />,
    );
    const wrap = wrapOf(container);
    hoverOpen(wrap);

    fireEvent.mouseLeave(wrap);
    fireEvent.mouseEnter(screen.getByRole("tooltip"));
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByRole("tooltip"));
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("closes on Escape and on scroll", () => {
    const { container } = renderWithIntl(
      <SeverityCounters counts={counts} findings={two} />,
    );
    hoverOpen(wrapOf(container));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    hoverOpen(wrapOf(container));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    act(() => void fireEvent.scroll(window));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("marks a dismissed finding without dropping it from the count", () => {
    const dismissed = [finding({ title: "Old news", dismissed_at: "2026-01-01T00:00:00Z" })];
    const { container } = renderWithIntl(
      <SeverityCounters counts={{ critical: 1, warning: 0, suggestion: 0 }} findings={dismissed} />,
    );
    hoverOpen(wrapOf(container));
    expect(screen.getByText("1 findings")).toBeInTheDocument();
    expect(screen.getByText("Old news").style.textDecoration).toBe("line-through");
  });

  it("wraps a long path in full rather than cutting it", () => {
    const path =
      "client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx";
    const long = [finding({ file: path, start_line: 88, end_line: 96 })];
    const { container } = renderWithIntl(
      <SeverityCounters counts={{ critical: 1, warning: 0, suggestion: 0 }} findings={long} />,
    );
    hoverOpen(wrapOf(container));

    // Whole path present, and free to break mid-segment so it cannot overrun
    // the panel (it has no spaces to wrap at on its own).
    const el = screen.getByText(`${path}:88-96`);
    expect(el.style.overflowWrap).toBe("anywhere");
    expect(el.style.minWidth).toBe("0");
    expect(el.style.textOverflow).toBe("");
  });

  it("drops the native chip tooltip that would cover the card", () => {
    const { container } = renderWithIntl(
      <SeverityCounters counts={counts} findings={two} />,
    );
    expect(screen.getByLabelText("1 critical")).not.toHaveAttribute("title");
    expect(wrapOf(container).querySelectorAll("[title]")).toHaveLength(0);
  });

  it("keeps the native tooltip when there is no card to cover", () => {
    renderWithIntl(<SeverityCounters counts={counts} />);
    expect(screen.getByLabelText("1 critical")).toHaveAttribute("title", "1 critical");
  });

  it("stays inert when no findings props are given", () => {
    const { container } = renderWithIntl(
      <SeverityCounters counts={counts} onSelect={() => {}} />,
    );
    hoverOpen(wrapOf(container));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

describe("popoverHelpers", () => {
  it("orders by severity, then by confidence", () => {
    const input = [
      finding({ severity: "WARNING", title: "w-low", confidence: 0.4 }),
      finding({ severity: "CRITICAL", title: "c", confidence: 0.1 }),
      finding({ severity: "WARNING", title: "w-high", confidence: 0.99 }),
    ];
    expect(sortForPopover(input).map((f) => f.title)).toEqual(["c", "w-high", "w-low"]);
  });

  it("does not mutate its input", () => {
    const input = [finding({ severity: "SUGGESTION" }), finding({ severity: "CRITICAL" })];
    const before = input.map((f) => f.id);
    sortForPopover(input);
    expect(input.map((f) => f.id)).toEqual(before);
  });

  it("flattens inline markdown to plain text", () => {
    expect(stripMarkdownInline("Line 12 has a `sk_live_` key — **exposed**")).toBe(
      "Line 12 has a sk_live_ key — exposed",
    );
    expect(stripMarkdownInline("See [the docs](https://x.dev/a) for _details_")).toBe(
      "See the docs for details",
    );
  });

  it("leaves snake_case identifiers intact", () => {
    expect(stripMarkdownInline("head_sha and __init__ and a_b_c stay whole")).toBe(
      "head_sha and __init__ and a_b_c stay whole",
    );
  });

  it("places the card below the trigger, clamped to the viewport", () => {
    const style = placePopover(
      { top: 100, bottom: 120, left: 900 },
      { width: 1000, height: 800 },
    );
    expect(style.position).toBe("fixed");
    expect(style.top).toBe(126);
    expect(style.left).toBe(1000 - 380 - 8);
  });

  it("flips above when the trigger sits near the bottom", () => {
    const style = placePopover(
      { top: 700, bottom: 720, left: 20 },
      { width: 1000, height: 800 },
    );
    expect(style.top).toBeUndefined();
    expect(style.bottom).toBe(800 - 700 + 6);
  });
});
