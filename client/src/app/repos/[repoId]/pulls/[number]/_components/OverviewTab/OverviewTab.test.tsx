import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrWhyBrief } from "@devdigest/shared";
import intentMessages from "../../../../../../../../messages/en/intent.json";
import blastMessages from "../../../../../../../../messages/en/blast.json";
import briefMessages from "../../../../../../../../messages/en/brief.json";

const briefState = {
  brief: null as PrWhyBrief | null | undefined,
  isLoading: false,
  isError: false,
  score: null as number | null,
  generatePending: false,
};
const refetchMock = vi.fn();
const generateMutate = vi.fn();

// IntentCard and BlastTab pull their own data; this suite is about the
// region composition, so both are stubbed to their quiet baseline state.
vi.mock("@/lib/hooks/reviews", () => ({
  usePrIntent: () => ({ data: null, isLoading: false, isError: false, refetch: vi.fn() }),
  useDeriveIntent: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
}));
vi.mock("@/lib/hooks/blast", () => ({
  usePrBlast: () => ({
    data: {
      changed_symbols: [{ name: "rateLimit", file: "src/lib/rate-limit.ts", kind: "function" }],
      downstream: [
        {
          symbol: "rateLimit",
          callers: [{ name: "publicRouter", file: "src/api/public/index.ts", line: 23, rank: 0.6 }],
          endpoints_affected: ["GET /api/public/items"],
          crons_affected: [],
        },
      ],
      summary: "1 changed symbol(s); 1 caller(s) across 1 file(s); 1 endpoint(s), 0 cron(s) affected.",
      status: "full",
      indexed_sha: "abc123",
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useBlastSummary: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    data: undefined,
  }),
}));
// The one call site OverviewTab reads the brief section through (SPEC-04
// AC-62) — mocked directly so this suite controls loading/error/brief/score
// without a QueryClientProvider, same technique the other Overview cards use.
vi.mock("@/lib/hooks/brief", () => ({
  usePrBriefSection: () => ({
    brief: briefState.brief,
    isLoading: briefState.isLoading,
    isError: briefState.isError,
    refetch: refetchMock,
    score: briefState.score,
    generate: {
      mutate: generateMutate,
      isPending: briefState.generatePending,
      isError: false,
      error: null,
    },
  }),
}));

import { OverviewTab } from "./OverviewTab";

function brief(over: Partial<PrWhyBrief> = {}): PrWhyBrief {
  return {
    what: "Adds rate limiting to the public API.",
    why: "Prevent a single client from exhausting shared capacity.",
    risk_level: "medium",
    risks: [],
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

function renderTab(onOpenFile?: (path: string) => void) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ intent: intentMessages, blast: blastMessages, brief: briefMessages }}
    >
      <OverviewTab
        prId="pr-1"
        headSha="abc123"
        repoFullName="acme/payments-api"
        onOpenFile={onOpenFile}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  briefState.brief = null;
  briefState.isLoading = false;
  briefState.isError = false;
  briefState.score = null;
  briefState.generatePending = false;
  refetchMock.mockReset();
  generateMutate.mockReset();
  cleanup();
});

describe("OverviewTab — three regions, Why + Risk Brief on top", () => {
  it("renders the brief's empty state and no Description block when nothing has been generated yet", () => {
    renderTab();

    expect(screen.getByText("No brief yet")).toBeInTheDocument();
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
  });

  it("lays out three siblings in DOM order — region 1 (brief) → region 2 (Intent | Blast) → region 3 (Review Focus) — with the outer container a single column and only the middle region a two-track grid (AC-56, AC-57, AC-58, AC-69)", () => {
    briefState.brief = brief();
    briefState.score = 61;
    const { container } = renderTab();

    const outer = container.firstElementChild as HTMLElement;
    expect(outer.children).toHaveLength(3);
    expect(outer.style.display).toBe("flex");
    // Not a three-track grid: the outer container declares no grid columns at all.
    expect(outer.style.gridTemplateColumns).toBe("");

    const children = Array.from(outer.children) as HTMLElement[];
    const region1 = children[0]!;
    const region2 = children[1]!;
    const region3 = children[2]!;

    // Region 1: the brief, full width, its own <section>.
    expect(region1.tagName).toBe("SECTION");
    expect(within(region1).getByText("Why + Risk Brief")).toBeInTheDocument();

    // Region 2: the only grid on the tab — auto-fit, 420px floor (AC-57, AC-58).
    expect(region2.tagName).toBe("DIV");
    expect(region2.style.display).toBe("grid");
    expect(region2.style.gridTemplateColumns).toContain("auto-fit");
    expect(region2.style.gridTemplateColumns).toContain("420px");
    expect(within(region2).getByText("Not classified yet")).toBeInTheDocument();
    expect(within(region2).getByText("rateLimit()")).toBeInTheDocument();

    // Region 3: Review Focus, full width, its own <section>, after region 2.
    expect(region3.tagName).toBe("SECTION");
    expect(within(region3).getByText("Review focus — read these first")).toBeInTheDocument();
  });

  it("shows exactly one Regenerate button, in region 1's header (AC-61)", () => {
    briefState.brief = brief();
    renderTab();
    expect(screen.getAllByRole("button", { name: "Regenerate" })).toHaveLength(1);
  });

  it("omits region 3 while the brief is loading, on a load error, and before the first generation — each state stays region 1 only, at full width (AC-63)", () => {
    briefState.isLoading = true;
    const { container: loadingContainer } = renderTab();
    expect((loadingContainer.firstElementChild as HTMLElement).children).toHaveLength(2);
    expect(screen.queryByText("Review focus — read these first")).not.toBeInTheDocument();
    cleanup();

    briefState.isLoading = false;
    briefState.isError = true;
    const { container: errorContainer } = renderTab();
    expect((errorContainer.firstElementChild as HTMLElement).children).toHaveLength(2);
    expect(screen.queryByText("Review focus — read these first")).not.toBeInTheDocument();
    cleanup();

    briefState.isError = false;
    briefState.brief = null; // not yet generated
    const { container: emptyContainer } = renderTab();
    expect((emptyContainer.firstElementChild as HTMLElement).children).toHaveLength(2);
    expect(screen.queryByText("Review focus — read these first")).not.toBeInTheDocument();
  });

  it("renders the reviewer agent's score as a donut, not a bare number (AC-68)", () => {
    briefState.brief = brief();
    briefState.score = 61;
    const { container } = renderTab();

    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(screen.getByText("61")).toBeInTheDocument();
  });
});
