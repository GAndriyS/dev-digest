import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Onboarding } from "@devdigest/shared";

// `useGenerateOnboardingTour` reads the active UI locale — only field this
// hook needs from next-intl, so a minimal mock is cheaper than wrapping every
// test in a real `NextIntlClientProvider`.
vi.mock("next-intl", () => ({ useLocale: () => "en" }));

import { useGenerateOnboardingTour } from "./onboarding";

function readyTour(over: Partial<Onboarding> = {}): Onboarding {
  return {
    status: "ready",
    reason: null,
    generated_at: null,
    index: { files_indexed: 0, total_candidates: 0, bounded: false, status: "full" },
    sections: [],
    ...over,
  };
}

function skeletonTour(): Onboarding {
  return {
    status: "skeleton",
    reason: "not_indexed",
    generated_at: null,
    index: { files_indexed: 0, total_candidates: 0, bounded: false, status: "degraded" },
    sections: [],
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useGenerateOnboardingTour — cache write on success (finding #3)", () => {
  it("writes a skeleton response straight into the query cache, so the reason renders without an extra fetch", async () => {
    const repoId = "r1";
    const skeleton = skeletonTour();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => skeleton }),
    );

    const client = makeClient();
    // Seed the cache with the pre-generation empty state, so a later
    // `invalidateQueries` (which triggers a refetch this mock doesn't serve a
    // second response for) can't be mistaken for what actually populated it.
    client.setQueryData(["onboarding", repoId], readyTour());

    const { result } = renderHook(() => useGenerateOnboardingTour(repoId), {
      wrapper: wrapperFor(client),
    });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryData(["onboarding", repoId])).toEqual(skeleton);
  });

  it("writes a ready response straight into the query cache too", async () => {
    const repoId = "r1";
    const ready = readyTour({ generated_at: "2026-08-19T00:00:00.000Z" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ready }),
    );

    const client = makeClient();
    const { result } = renderHook(() => useGenerateOnboardingTour(repoId), {
      wrapper: wrapperFor(client),
    });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryData(["onboarding", repoId])).toEqual(ready);
  });
});

describe("useGenerateOnboardingTour — invalidate only follows a 'ready' result (AC-26)", () => {
  it("invalidates the onboarding query on a 'ready' response, so a refetch can pick up what the server actually persisted", async () => {
    const repoId = "r1";
    const ready = readyTour({ generated_at: "2026-08-19T00:00:00.000Z" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ready }),
    );

    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useGenerateOnboardingTour(repoId), {
      wrapper: wrapperFor(client),
    });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["onboarding", repoId] });
  });

  it("does NOT invalidate on a 'skeleton' response, so this call's own reason is not immediately overwritten by a refetch of the prior stored tour", async () => {
    const repoId = "r1";
    const skeleton = skeletonTour();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => skeleton }),
    );

    const client = makeClient();
    client.setQueryData(["onboarding", repoId], readyTour());
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useGenerateOnboardingTour(repoId), {
      wrapper: wrapperFor(client),
    });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).not.toHaveBeenCalled();
    // The written cache still carries this call's own skeleton + reason —
    // an uninvalidated cache is only meaningful if the write itself held.
    expect(client.getQueryData(["onboarding", repoId])).toEqual(skeleton);
  });
});
