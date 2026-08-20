import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ReviewRecord } from "@devdigest/shared";

import { usePrBriefSection } from "./brief";

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

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** Stubs `fetch` to answer `GET /pulls/:id/brief` with `null` (no brief yet —
    irrelevant to score selection) and `GET /pulls/:id/reviews` with the given
    rows, matching by URL suffix the way the two hooks that compose
    `usePrBriefSection` actually call `api.get`. */
function stubFetch(reviews: ReviewRecord[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/reviews")) {
        return { ok: true, status: 200, json: async () => reviews };
      }
      if (url.endsWith("/brief")) {
        return { ok: true, status: 200, json: async () => null };
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("usePrBriefSection — score selection (AC-47, EC-18)", () => {
  it("skips a kind:'summary' row and picks the first kind:'review' row's score", async () => {
    stubFetch([
      review({ id: "rev-summary", kind: "summary", score: null }),
      review({ id: "rev-review", kind: "review", score: 61 }),
    ]);

    const client = makeClient();
    const { result } = renderHook(() => usePrBriefSection("pr-1"), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.score).toBe(61);
  });

  it("returns null when there is no review row at all", async () => {
    stubFetch([]);

    const client = makeClient();
    const { result } = renderHook(() => usePrBriefSection("pr-1"), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.score).toBeNull();
  });

  it("returns null when the only review row's score is null", async () => {
    stubFetch([review({ score: null })]);

    const client = makeClient();
    const { result } = renderHook(() => usePrBriefSection("pr-1"), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.score).toBeNull();
  });
});
