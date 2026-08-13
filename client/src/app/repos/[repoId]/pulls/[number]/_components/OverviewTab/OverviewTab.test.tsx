import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import intentMessages from "../../../../../../../../messages/en/intent.json";
import blastMessages from "../../../../../../../../messages/en/blast.json";

// Both cards pull their own data; this suite is about the two-column
// composition, so every hook is stubbed to its quiet baseline state.
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

import { OverviewTab } from "./OverviewTab";

function renderTab() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ intent: intentMessages, blast: blastMessages }}
    >
      <OverviewTab prId="pr-1" headSha="abc123" repoFullName="acme/payments-api" />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("OverviewTab — Intent and Blast side by side", () => {
  it("renders both cards and no Description block", () => {
    renderTab();

    // Left column: the intent card in its not-classified state.
    expect(screen.getByText("Not classified yet")).toBeInTheDocument();
    // Right column: the blast tree with its symbol row (collapsed by default).
    expect(screen.getByText("rateLimit()")).toBeInTheDocument();
    // The raw PR body block is gone for good.
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
  });

  it("lays the cards out as a start-aligned grid", () => {
    const { container } = renderTab();
    const grid = container.firstElementChild as HTMLElement;

    expect(grid.style.display).toBe("grid");
    expect(grid.style.alignItems).toBe("start");
    expect(grid.children).toHaveLength(2);
  });
});
