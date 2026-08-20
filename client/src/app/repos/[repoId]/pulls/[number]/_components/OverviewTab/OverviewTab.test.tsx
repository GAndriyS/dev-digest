import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import intentMessages from "../../../../../../../../messages/en/intent.json";
import blastMessages from "../../../../../../../../messages/en/blast.json";
import briefMessages from "../../../../../../../../messages/en/brief.json";

// All three cards pull their own data; this suite is about the column
// composition, so every hook is stubbed to its quiet baseline state.
vi.mock("@/lib/hooks/reviews", () => ({
  usePrIntent: () => ({ data: null, isLoading: false, isError: false, refetch: vi.fn() }),
  useDeriveIntent: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  usePrReviews: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/lib/hooks/brief", () => ({
  useBrief: () => ({ data: null, isLoading: false, isError: false, refetch: vi.fn() }),
  useGenerateBrief: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
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

import { OverviewTab } from "./OverviewTab";

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

afterEach(cleanup);

describe("OverviewTab — Intent, Blast, and the Why + Risk Brief side by side", () => {
  it("renders all three cards and no Description block", () => {
    renderTab();

    // First column: the intent card in its not-classified state.
    expect(screen.getByText("Not classified yet")).toBeInTheDocument();
    // Second column: the blast tree with its symbol row (collapsed by default).
    expect(screen.getByText("rateLimit()")).toBeInTheDocument();
    // Third column: the brief card in its not-generated-yet empty state.
    expect(screen.getByText("No brief yet")).toBeInTheDocument();
    // The raw PR body block is gone for good.
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
  });

  it("lays the cards out as a start-aligned grid", () => {
    const { container } = renderTab();
    const grid = container.firstElementChild as HTMLElement;

    expect(grid.style.display).toBe("grid");
    expect(grid.style.alignItems).toBe("start");
    expect(grid.children).toHaveLength(3);
  });
});
