import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadius } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/blast.json";

const summarizeMutate = vi.fn();
const refetchMock = vi.fn();

const state = {
  data: undefined as BlastRadius | undefined,
  isLoading: false,
  isError: false,
  summaryPending: false,
  summaryData: undefined as { summary: string } | undefined,
};

// Same technique `IntentCard.test.tsx` uses: mock the data hooks directly so
// this suite stays free of a QueryClientProvider.
vi.mock("@/lib/hooks/blast", () => ({
  usePrBlast: () => ({
    data: state.data,
    isLoading: state.isLoading,
    isError: state.isError,
    refetch: refetchMock,
  }),
  useBlastSummary: () => ({
    mutate: summarizeMutate,
    isPending: state.summaryPending,
    isError: false,
    error: null,
    data: state.summaryData,
  }),
}));

import { BlastTab } from "./BlastTab";

function blast(over: Partial<BlastRadius> = {}): BlastRadius {
  return {
    changed_symbols: [{ name: "rateLimit", file: "src/lib/rate-limit.ts", kind: "function" }],
    downstream: [
      {
        symbol: "rateLimit",
        callers: [
          { name: "publicRouter", file: "src/api/public/index.ts", line: 23, rank: 0.6 },
          { name: "buildServer", file: "src/server.ts", line: 88, rank: 0.3 },
        ],
        endpoints_affected: ["GET /api/public/items"],
        crons_affected: ["reset-rate-buckets (hourly)"],
      },
    ],
    summary: "1 changed symbol(s); 2 caller(s) across 2 file(s); 1 endpoint(s), 1 cron(s) affected.",
    status: "full",
    indexed_sha: "abc123",
    ...over,
  };
}

/** `??` would swallow an explicit `null`, which is exactly the case under test. */
function renderTab(props: { repoFullName?: string | null; headSha?: string | null } = {}) {
  const repoFullName = "repoFullName" in props ? props.repoFullName : "acme/payments-api";
  const headSha = "headSha" in props ? props.headSha : "abc123";
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <BlastTab prId="pr-1" repoFullName={repoFullName} headSha={headSha} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.data = blast();
  state.isLoading = false;
  state.isError = false;
  state.summaryPending = false;
  state.summaryData = undefined;
  summarizeMutate.mockClear();
});
afterEach(cleanup);

describe("BlastTab — the tree", () => {
  it("renders each caller as a file:line link to the right GitHub line", () => {
    renderTab();

    const link = screen.getByText("src/api/public/index.ts:23").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/abc123/src/api/public/index.ts#L23",
    );
    expect(screen.getByText("src/server.ts:88")).toBeInTheDocument();
  });

  it("links lines to the INDEXED commit, not the PR head, and says so", () => {
    // The index lags the PR head here — linking to head would open whatever
    // line happens to sit there in a file that moved since.
    state.data = blast({ indexed_sha: "b4a4f6e" });
    renderTab({ headSha: "cf683a0" });

    expect(screen.getByText("src/api/public/index.ts:23").closest("a")).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/b4a4f6e/src/api/public/index.ts#L23",
    );
    expect(screen.getByText(/indexed commit b4a4f6e/)).toBeInTheDocument();
  });

  it("stays quiet about the commit when the index is level with the PR head", () => {
    state.data = blast({ indexed_sha: "abc123" });
    renderTab({ headSha: "abc123" });

    expect(screen.queryByText(/indexed commit/)).not.toBeInTheDocument();
  });

  it("shows the endpoints and crons the callers reach", () => {
    renderTab();

    expect(screen.getByText("GET /api/public/items")).toBeInTheDocument();
    expect(screen.getByText("reset-rate-buckets (hourly)")).toBeInTheDocument();
  });

  it("renders file:line as plain text when there is no repo/sha to link to", () => {
    renderTab({ repoFullName: null, headSha: null });

    expect(screen.getByText("src/api/public/index.ts:23").closest("a")).toBeNull();
  });

  it("collapses a symbol's callers when its row is toggled", () => {
    renderTab();
    expect(screen.getByText("src/server.ts:88")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { expanded: true }));

    expect(screen.queryByText("src/server.ts:88")).not.toBeInTheDocument();
  });
});

describe("BlastTab — index status is visible, never swallowed", () => {
  it("a degraded index explains itself instead of claiming nothing depends on the code", () => {
    state.data = blast({ status: "degraded", reason: "no_data", changed_symbols: [], downstream: [] });
    renderTab();

    expect(screen.getByText(messages.degraded.title)).toBeInTheDocument();
    expect(screen.getByText(messages.degraded.reason.no_data)).toBeInTheDocument();
    // NOT the genuine "nothing downstream" state.
    expect(screen.queryByText(messages.empty.title)).not.toBeInTheDocument();
  });

  it("an un-imported file list points at the PR, not at re-indexing", () => {
    state.data = blast({
      status: "degraded",
      reason: "no_changed_files",
      changed_symbols: [],
      downstream: [],
    });
    renderTab();

    expect(screen.getByText(messages.degraded.reason.no_changed_files)).toBeInTheDocument();
    expect(screen.queryByText(messages.degraded.reason.no_data)).not.toBeInTheDocument();
  });

  it("an unknown degraded reason still renders copy, not a raw enum", () => {
    state.data = blast({ status: "degraded", reason: "something_new", changed_symbols: [], downstream: [] });
    renderTab();

    expect(screen.getByText(messages.degraded.reason.no_data)).toBeInTheDocument();
    expect(screen.queryByText("something_new")).not.toBeInTheDocument();
  });

  it("a partial index warns above the data it still renders", () => {
    state.data = blast({ status: "partial" });
    renderTab();

    expect(screen.getByText(messages.status.partial)).toBeInTheDocument();
    expect(screen.getByText("src/api/public/index.ts:23")).toBeInTheDocument();
  });

  it("an empty map on a healthy index is the empty state, with no degraded copy", () => {
    state.data = blast({ changed_symbols: [], downstream: [] });
    renderTab();

    expect(screen.getByText(messages.empty.title)).toBeInTheDocument();
    expect(screen.queryByText(messages.degraded.title)).not.toBeInTheDocument();
  });

  it("shows a retry affordance when the request failed", () => {
    state.isError = true;
    renderTab();

    expect(screen.getByText(messages.loadError)).toBeInTheDocument();
  });
});

describe("BlastTab — the explanation is opt-in", () => {
  it("does not spend a model call on render", () => {
    renderTab();
    expect(summarizeMutate).not.toHaveBeenCalled();
  });

  it("spends exactly one call when the reader asks for it", () => {
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: messages.summary.cta }));

    expect(summarizeMutate).toHaveBeenCalledTimes(1);
  });

  it("renders the generated paragraph once it arrives", () => {
    state.summaryData = { summary: "Touching rateLimit reaches the public items endpoint." };
    renderTab();

    expect(
      screen.getByText("Touching rateLimit reaches the public items endpoint."),
    ).toBeInTheDocument();
  });

  it("cannot be asked for when there is nothing to explain", () => {
    state.data = blast({ changed_symbols: [], downstream: [] });
    renderTab();

    expect(screen.getByRole("button", { name: messages.summary.cta })).toBeDisabled();
  });
});
