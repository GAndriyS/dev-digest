import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrIntentRecord } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/intent.json";
import { ApiError } from "@/lib/api";

const deriveMutate = vi.fn();
const refetchMock = vi.fn();

const state = {
  data: null as PrIntentRecord | null | undefined,
  isLoading: false,
  isError: false,
  derivePending: false,
  deriveError: false,
  deriveErrorObj: null as unknown,
};

// Same technique `ConventionsView.test.tsx` uses: mock the data hooks directly
// so this suite stays free of a QueryClientProvider.
vi.mock("@/lib/hooks/reviews", () => ({
  usePrIntent: () => ({
    data: state.data,
    isLoading: state.isLoading,
    isError: state.isError,
    refetch: refetchMock,
  }),
  useDeriveIntent: () => ({
    mutate: deriveMutate,
    isPending: state.derivePending,
    isError: state.deriveError,
    error: state.deriveErrorObj,
  }),
}));

import { IntentCard } from "./IntentCard";

function intent(over: Partial<PrIntentRecord> = {}): PrIntentRecord {
  return {
    pr_id: "pr-1",
    intent: "Adds rate limiting to public API endpoints.",
    in_scope: ["src/middleware/ratelimit.ts"],
    out_of_scope: ["docs/formatting"],
    risk_areas: ["auth"],
    confidence: 0.7,
    sources: [
      { type: "description", status: "used" },
      { type: "linked_issue", ref: "#471", status: "unavailable" },
    ],
    model: "deepseek/deepseek-v4-flash",
    head_sha: "abc123",
    created_at: "2026-06-01T00:00:00.000Z",
    tokens_in: 500,
    tokens_out: 120,
    cost_usd: 0.001,
    ...over,
  };
}

function renderCard(props: { prId?: string | null; headSha?: string } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ intent: messages }}>
      <IntentCard prId={props.prId ?? "pr-1"} headSha={props.headSha ?? "abc123"} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.data = null;
  state.isLoading = false;
  state.isError = false;
  state.derivePending = false;
  state.deriveError = false;
  state.deriveErrorObj = null;
  deriveMutate.mockReset();
  refetchMock.mockReset();
});
afterEach(cleanup);

describe("IntentCard", () => {
  it("offers to classify when nothing has been derived yet, and classifies on click", () => {
    renderCard();
    expect(screen.getByText("Not classified yet")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Classify now"));
    expect(deriveMutate).toHaveBeenCalledOnce();
  });

  it("renders a derived intent with scope, risk areas, confidence, sources — and flags it stale", () => {
    state.data = intent({ head_sha: "old-sha" });
    renderCard({ headSha: "new-sha" });

    expect(screen.getByText("Adds rate limiting to public API endpoints.")).toBeInTheDocument();
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
    expect(screen.getByText("docs/formatting")).toBeInTheDocument();
    expect(screen.getByText("auth")).toBeInTheDocument();
    expect(screen.getByText("70% conf")).toBeInTheDocument();
    expect(screen.getByText("PR description")).toBeInTheDocument();
    expect(screen.getByText(/Linked issue #471 — unavailable/)).toBeInTheDocument();
    expect(screen.getByText("PR has new commits since this was derived")).toBeInTheDocument();

    // The re-classify button also works once something is already loaded.
    fireEvent.click(screen.getByText("Re-classify"));
    expect(deriveMutate).toHaveBeenCalledOnce();
  });

  it("renders the Markdown the model writes into scope items and risk areas", () => {
    // Real output is almost entirely inline code spans around paths — rendered
    // raw, every one of them reads as literal backticks.
    state.data = intent({
      intent: "Adds a limiter to `/api/public/*`.",
      in_scope: ["`src/middleware/ratelimit.ts` — the **limiter** itself"],
      out_of_scope: ["`docs/` formatting"],
      risk_areas: ["`ioredis` added as a dependency"],
    });
    renderCard();

    // One <code> per backticked span, in all three places, and no stray ticks.
    const code = document.querySelectorAll("code");
    expect(Array.from(code).map((c) => c.textContent)).toEqual([
      "/api/public/*",
      "src/middleware/ratelimit.ts",
      "docs/",
      "ioredis",
    ]);
    expect(screen.getByText("limiter").tagName).toBe("STRONG");
    expect(document.body.textContent).not.toContain("`");
  });

  it("escapes HTML embedded in intent text — the model's output is not trusted markup", () => {
    state.data = intent({ intent: 'Adds <img src=x onerror="alert(1)"> a limiter.' });
    renderCard();

    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText(/onerror/)).toBeInTheDocument();
  });

  it("surfaces a derive failure without losing the already-loaded intent", () => {
    state.data = intent();
    state.deriveError = true;
    state.deriveErrorObj = new ApiError("No API key configured", 409, "config_error");
    renderCard();

    expect(screen.getByText("Classification failed — No API key configured")).toBeInTheDocument();
    // The card itself is still rendered from the last successful derive.
    expect(screen.getByText("Adds rate limiting to public API endpoints.")).toBeInTheDocument();
  });

  it("shows a load-failed state with a retry action when the initial fetch itself errors", () => {
    state.isError = true;
    renderCard();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not load this PR's intent.");
    // Neither the empty-state nor a rendered intent should appear underneath —
    // the error branch is exclusive of the other three.
    expect(screen.queryByText("Not classified yet")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Retry"));
    expect(refetchMock).toHaveBeenCalledOnce();
  });

  it("shows the deriving state — the button is disabled and relabelled while a classification is in flight", () => {
    state.data = intent();
    state.derivePending = true;
    renderCard();

    const button = screen.getByRole("button", { name: "Classifying…" });
    expect(button).toBeDisabled();
    // The already-loaded intent stays visible while the re-derive is pending —
    // deriving never blanks the card.
    expect(screen.getByText("Adds rate limiting to public API endpoints.")).toBeInTheDocument();
  });

  it("shows the deriving state on the empty-state CTA when classifying for the first time", () => {
    state.derivePending = true;
    renderCard();

    const cta = screen.getByRole("button", { name: "Classify now" });
    expect(cta).toBeDisabled();
  });
});
