import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import evalMessages from "../../../../../../../../messages/en/eval.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

// FindingCard (rendered by FindingsPanel) now owns "Turn into eval case"
// (L06 step 12) — a real useMutation needs a QueryClientProvider this suite
// doesn't mount, and next/navigation needs a router this suite doesn't provide.
vi.mock("@/lib/hooks/eval", () => ({
  useCreateEvalCaseFromFinding: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { FindingsPanel } from "./FindingsPanel";
import { visibleFindings } from "./helpers";

afterEach(cleanup);

// jsdom has no scrollIntoView implementation; the scroll-to-target effect
// calls it whenever `targetFindingId` is set.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

const FINDINGS: FindingRecord[] = [finding({ id: "f1" })];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, eval: evalMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

describe("FindingsPanel severity filter", () => {
  const MIXED = [
    finding({ id: "f1", severity: "CRITICAL", title: "Hardcoded secret" }),
    finding({ id: "f2", severity: "WARNING", title: "Missing Retry-After header" }),
  ];

  it("shows only the filtered severity", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" severityFilter="WARNING" />);
    expect(screen.getByText("Missing Retry-After header")).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
  });

  it("shows every severity when the filter is null", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" severityFilter={null} />);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("Missing Retry-After header")).toBeInTheDocument();
  });

  it("falls back to the empty state when the filter matches nothing", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" severityFilter="SUGGESTION" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

// A finding navigated to from the Diff tab (`targetFindingId`, aka `keepId`
// in the helper) must survive both client-side cuts — a click that lands on
// a finding the viewer's own filter would have hidden must not look like the
// click did nothing.
describe("visibleFindings bypasses filters for a target (keepId)", () => {
  const WITH_TARGET: FindingRecord[] = [
    finding({ id: "f1", severity: "CRITICAL", confidence: 0.95 }),
    finding({ id: "f2", severity: "WARNING", confidence: 0.3 }),
    finding({ id: "target", severity: "SUGGESTION", confidence: 0.3 }),
  ];

  it("keeps the target past a severity filter that would otherwise exclude it", () => {
    const shown = visibleFindings(WITH_TARGET, false, "WARNING", "target");
    expect(shown.map((f) => f.id)).toEqual(["f2", "target"]);
  });

  it("keeps the target past hide-low-confidence while a non-target low-confidence finding is dropped", () => {
    const shown = visibleFindings(WITH_TARGET, true, null, "target");
    // f2 is below the confidence threshold and is not the target — dropped.
    expect(shown.map((f) => f.id)).toEqual(["f1", "target"]);
  });
});

describe("FindingsPanel target navigation (from Diff tab)", () => {
  const WITH_TARGET: FindingRecord[] = [
    finding({ id: "f1", severity: "CRITICAL", title: "Hardcoded secret", confidence: 0.95 }),
    finding({
      id: "target",
      severity: "SUGGESTION",
      title: "Consider renaming",
      confidence: 0.3,
      rationale: "Rename for clarity.",
    }),
  ];

  it("renders the target past an active severity filter, focused and expanded, not first", () => {
    const { container } = renderWithIntl(
      <FindingsPanel findings={WITH_TARGET} prId="pr1" severityFilter="WARNING" targetFindingId="target" />,
    );

    // The WARNING filter would normally hide both findings (neither is
    // WARNING) — the target survives anyway, the non-target does not.
    expect(screen.getByText("Consider renaming")).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();

    const card = container.querySelector('[data-finding-id="target"]') as HTMLElement;
    expect(card).not.toBeNull();
    // Focused: FindingCard only sets a boxShadow ring when `focused` is true
    // (jsdom's cssstyle silently drops the `border-color` longhand for a
    // `var()` value, so boxShadow is the genuinely observable signal here).
    expect(card.style.boxShadow).toBe("0 0 0 1px var(--sugg)");
    // Expanded: the rationale (only rendered once a card is expanded) is visible.
    expect(within(card).getByText("Rename for clarity.")).toBeInTheDocument();
  });

  it("keeps the target focused+expanded once hide-low-confidence is turned on, and not at index 0", () => {
    const { container } = renderWithIntl(
      <FindingsPanel findings={WITH_TARGET} prId="pr1" targetFindingId="target" />,
    );

    // Turn on hide-low-confidence — the target (confidence 0.3) would
    // normally be hidden by it.
    fireEvent.click(screen.getByRole("switch"));

    const cards = container.querySelectorAll("[data-finding-id]");
    expect(cards).toHaveLength(2);
    // Sorted by severity: CRITICAL first, so the target is not index 0.
    expect(cards[0]).toHaveAttribute("data-finding-id", "f1");
    expect(cards[1]).toHaveAttribute("data-finding-id", "target");

    const targetCard = cards[1] as HTMLElement;
    expect(targetCard.style.boxShadow).toBe("0 0 0 1px var(--sugg)");
    expect(within(targetCard).getByText("Rename for clarity.")).toBeInTheDocument();
  });
});

describe("FindingsPanel scroll-to-target effect", () => {
  // jsdom reports every `offsetTop` as 0 and performs no real layout, so the
  // "does the document offset stop moving" geometry this effect chases is
  // not reproducible here. What jsdom *can* genuinely observe: the effect
  // fires, finds the target card by its `data-finding-id` anchor, and drives
  // `scrollIntoView` off `requestAnimationFrame` (a real jsdom timer, not
  // stubbed) until the frame cap or the (here: immediate) stability check.
  it("calls scrollIntoView on the target card via the requestAnimationFrame loop", async () => {
    renderWithIntl(
      <FindingsPanel
        findings={[finding({ id: "f1" }), finding({ id: "target", title: "Consider renaming" })]}
        prId="pr1"
        targetFindingId="target"
      />,
    );

    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });
    const calls = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]?.[0]).toEqual({ block: "center" });
  });

  it("does not call scrollIntoView when there is no target", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
