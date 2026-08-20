import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrWhyBrief, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";
import { ApiError } from "@/lib/api";

const generateMutate = vi.fn();
const refetchMock = vi.fn();

const state = {
  brief: null as PrWhyBrief | null | undefined,
  isLoading: false,
  isError: false,
  generatePending: false,
  generateError: false,
  generateErrorObj: null as unknown,
  reviews: [] as ReviewRecord[] | undefined,
};

// Same technique IntentCard.test.tsx uses: mock the data hooks directly so
// this suite stays free of a QueryClientProvider.
vi.mock("@/lib/hooks/brief", () => ({
  useBrief: () => ({
    data: state.brief,
    isLoading: state.isLoading,
    isError: state.isError,
    refetch: refetchMock,
  }),
  useGenerateBrief: () => ({
    mutate: generateMutate,
    isPending: state.generatePending,
    isError: state.generateError,
    error: state.generateErrorObj,
  }),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: state.reviews, isLoading: false, isError: false }),
}));

import { PrBriefCard } from "./PrBriefCard";

function brief(over: Partial<PrWhyBrief> = {}): PrWhyBrief {
  return {
    what: "Adds rate limiting to the public API.",
    why: "Prevent a single client from exhausting shared capacity.",
    risk_level: "medium",
    risks: [
      {
        kind: "reliability",
        title: "New Redis dependency",
        explanation: "The limiter fails open if Redis is unreachable.",
        severity: "medium",
        file_refs: ["src/middleware/ratelimit.ts"],
      },
    ],
    review_focus: [
      { path: "src/middleware/ratelimit.ts", reason: "New limiter logic.", line: null },
    ],
    inputs: [],
    head_sha: "abc123",
    generated_at: "2026-08-20T00:00:00.000Z",
    model: "deepseek/deepseek-v4-flash",
    stale: false,
    ...over,
  };
}

function review(over: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: "rev-1",
    pr_id: "pr-1",
    agent_id: "agent-1",
    run_id: "run-1",
    agent_name: "Reviewer",
    kind: "review",
    verdict: "approve",
    summary: "Looks good.",
    score: 61,
    model: "deepseek/deepseek-v4-flash",
    grounding: null,
    created_at: "2026-08-20T00:00:00.000Z",
    findings: [],
    ...over,
  };
}

function renderCard(props: { prId?: string | null; onOpenFile?: (path: string) => void } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <PrBriefCard prId={props.prId ?? "pr-1"} onOpenFile={props.onOpenFile} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.brief = null;
  state.isLoading = false;
  state.isError = false;
  state.generatePending = false;
  state.generateError = false;
  state.generateErrorObj = null;
  state.reviews = [];
  generateMutate.mockReset();
  refetchMock.mockReset();
});
afterEach(cleanup);

describe("PrBriefCard", () => {
  it("shows a loading skeleton while the brief is being fetched", () => {
    state.isLoading = true;
    const { container } = renderCard();
    expect(container.querySelector(".skeleton")).toBeInTheDocument();
  });

  it("shows a load-failed state with a retry action when the initial fetch errors", () => {
    state.isError = true;
    renderCard();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not load this PR's brief.");
    expect(screen.queryByText("No brief yet")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Retry"));
    expect(refetchMock).toHaveBeenCalledOnce();
  });

  it("offers to generate when nothing has been generated yet (AC-37), and generates on click", () => {
    renderCard();
    expect(screen.getByText("No brief yet")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Generate brief"));
    expect(generateMutate).toHaveBeenCalledOnce();
  });

  it("renders what/why as separate labeled blocks, and the risk level as both text and colour (AC-31, AC-32)", () => {
    state.brief = brief({ risk_level: "high" });
    renderCard();

    expect(screen.getByText("Adds rate limiting to the public API.")).toBeInTheDocument();
    expect(screen.getByText("Prevent a single client from exhausting shared capacity.")).toBeInTheDocument();
    // Text label — never colour alone.
    expect(screen.getByText("High risk")).toBeInTheDocument();
  });

  it("renders Review Focus rows as keyboard-operable buttons that call onOpenFile with the item's path (AC-33, AC-34)", () => {
    state.brief = brief();
    const onOpenFile = vi.fn();
    renderCard({ onOpenFile });

    const row = screen.getByRole("button", { name: /ratelimit\.ts.*New limiter logic\./ });
    fireEvent.click(row);
    expect(onOpenFile).toHaveBeenCalledWith("src/middleware/ratelimit.ts");
  });

  it("renders Review Focus rows as non-interactive text when onOpenFile is not supplied", () => {
    state.brief = brief();
    renderCard();

    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ratelimit\.ts/ })).not.toBeInTheDocument();
  });

  it("shows an honest empty message when review_focus is empty — not an error, not a fabricated path (AC-21)", () => {
    state.brief = brief({ review_focus: [] });
    renderCard();

    expect(screen.getByText("No files flagged for priority review.")).toBeInTheDocument();
  });

  it("shows the stale badge when the brief is marked stale, and nothing otherwise (AC-26, AC-40)", () => {
    state.brief = brief({ stale: true });
    renderCard();
    expect(screen.getByText("PR has new commits since this was generated")).toBeInTheDocument();

    cleanup();
    state.brief = brief({ stale: false });
    renderCard();
    expect(screen.queryByText("PR has new commits since this was generated")).not.toBeInTheDocument();
  });

  it("escapes HTML embedded in model text — never rendered as markup (AC-44)", () => {
    state.brief = brief({ what: 'Adds <img src=x onerror="alert(1)"> a limiter.' });
    renderCard();

    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText(/onerror/)).toBeInTheDocument();
  });

  it("shows the reviewer agent's score, subtitled separately from the brief content (AC-47, AC-55)", () => {
    state.brief = brief();
    state.reviews = [review({ score: 61 })];
    renderCard();

    expect(screen.getByText("61")).toBeInTheDocument();
    expect(screen.getByText("Agent review score")).toBeInTheDocument();
  });

  it("shows 'not yet reviewed' instead of a zero or blank when there is no review, or the latest score is null (AC-48)", () => {
    state.brief = brief();
    state.reviews = [];
    renderCard();
    expect(screen.getByText("Not yet reviewed by an agent")).toBeInTheDocument();

    cleanup();
    state.reviews = [review({ score: null })];
    renderCard();
    expect(screen.getByText("Not yet reviewed by an agent")).toBeInTheDocument();
  });

  it("skips a kind:'summary' row and picks the first kind:'review' row's score (AC-47, EC-18)", () => {
    state.brief = brief();
    state.reviews = [
      review({ id: "rev-summary", kind: "summary", score: null }),
      review({ id: "rev-review", kind: "review", score: 61 }),
    ];
    renderCard();
    expect(screen.getByText("61")).toBeInTheDocument();
  });

  it("shows the disabled, relabelled regenerate button while a generation is in flight, and keeps the previous brief on screen (AC-29, AC-38)", () => {
    state.brief = brief();
    state.generatePending = true;
    renderCard();

    const button = screen.getByRole("button", { name: "Regenerating…" });
    expect(button).toBeDisabled();
    expect(screen.getByText("Adds rate limiting to the public API.")).toBeInTheDocument();
  });

  it("surfaces a generation failure without losing the already-loaded brief (AC-39)", () => {
    state.brief = brief();
    state.generateError = true;
    state.generateErrorObj = new ApiError("No API key configured", 409, "config_error");
    renderCard();

    expect(screen.getByText("Generation failed — No API key configured")).toBeInTheDocument();
    expect(screen.getByText("Adds rate limiting to the public API.")).toBeInTheDocument();
  });
});
