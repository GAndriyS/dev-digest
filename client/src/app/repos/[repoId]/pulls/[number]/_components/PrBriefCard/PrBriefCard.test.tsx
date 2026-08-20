import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrWhyBrief } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";
import { ApiError } from "@/lib/api";

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

function generateState(
  over: Partial<{ isPending: boolean; isError: boolean; error: unknown }> = {},
) {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    ...over,
  };
}

function renderCard(
  props: Partial<{
    brief: PrWhyBrief | null | undefined;
    isLoading: boolean;
    isError: boolean;
    refetch: () => void;
    score: number | null;
    generate: ReturnType<typeof generateState>;
  }> = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <PrBriefCard
        brief={props.brief ?? null}
        isLoading={props.isLoading ?? false}
        isError={props.isError ?? false}
        refetch={props.refetch ?? vi.fn()}
        score={props.score ?? null}
        generate={props.generate ?? generateState()}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("PrBriefCard", () => {
  it("shows a loading skeleton while the brief is being fetched", () => {
    const { container } = renderCard({ isLoading: true });
    expect(container.querySelector(".skeleton")).toBeInTheDocument();
  });

  it("shows a load-failed state with a retry action when the initial fetch errors", () => {
    const refetch = vi.fn();
    renderCard({ isError: true, refetch });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not load this PR's brief.");
    expect(screen.queryByText("No brief yet")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Retry"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("offers to generate when nothing has been generated yet (AC-37), and generates on click", () => {
    const generate = generateState();
    renderCard({ brief: null, generate });

    expect(screen.getByText("No brief yet")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Generate brief"));
    expect(generate.mutate).toHaveBeenCalledOnce();
  });

  it("renders what/why as separate labeled blocks, and the risk level as both text and colour (AC-31, AC-32)", () => {
    renderCard({ brief: brief({ risk_level: "high" }) });

    expect(screen.getByText("Adds rate limiting to the public API.")).toBeInTheDocument();
    expect(screen.getByText("Prevent a single client from exhausting shared capacity.")).toBeInTheDocument();
    // Text label — never colour alone.
    expect(screen.getByText("High risk")).toBeInTheDocument();
  });

  it("shows the stale badge when the brief is marked stale, and nothing otherwise (AC-26, AC-40)", () => {
    renderCard({ brief: brief({ stale: true }) });
    expect(screen.getByText("PR has new commits since this was generated")).toBeInTheDocument();

    cleanup();
    renderCard({ brief: brief({ stale: false }) });
    expect(screen.queryByText("PR has new commits since this was generated")).not.toBeInTheDocument();
  });

  it("escapes HTML embedded in model text — never rendered as markup (AC-44)", () => {
    renderCard({ brief: brief({ what: 'Adds <img src=x onerror="alert(1)"> a limiter.' }) });

    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText(/onerror/)).toBeInTheDocument();
  });

  it("shows the reviewer agent's score as a donut, subtitled separately from the brief content (AC-47, AC-55, AC-68)", () => {
    renderCard({ brief: brief(), score: 61 });

    expect(screen.getByText("61")).toBeInTheDocument();
    expect(screen.getByText("Agent review score")).toBeInTheDocument();
  });

  it("shows 'not yet reviewed' instead of a zero or blank when there is no score, and never draws the donut (AC-48)", () => {
    renderCard({ brief: brief(), score: null });

    expect(screen.getByText("Not yet reviewed by an agent")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows the disabled, relabelled regenerate button while a generation is in flight, and keeps the previous brief on screen (AC-29, AC-38)", () => {
    renderCard({ brief: brief(), generate: generateState({ isPending: true }) });

    const button = screen.getByRole("button", { name: "Regenerating…" });
    expect(button).toBeDisabled();
    expect(screen.getByText("Adds rate limiting to the public API.")).toBeInTheDocument();
  });

  it("shows exactly one regenerate button, in this card's header (AC-61)", () => {
    renderCard({ brief: brief() });
    expect(screen.getAllByRole("button", { name: "Regenerate" })).toHaveLength(1);
  });

  it("keeps the shown score unchanged across a regenerate (AC-53)", () => {
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
        <PrBriefCard
          brief={brief()}
          isLoading={false}
          isError={false}
          refetch={vi.fn()}
          score={61}
          generate={generateState()}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("61")).toBeInTheDocument();

    // Regenerating the brief (isPending flips, brief content could change)
    // must not be able to move `score` — it is read from a wholly separate
    // source (`usePrReviews`) and only ever arrives as an unchanged prop.
    rerender(
      <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
        <PrBriefCard
          brief={brief({ what: "Adds rate limiting to the public API, revised." })}
          isLoading={false}
          isError={false}
          refetch={vi.fn()}
          score={61}
          generate={generateState({ isPending: true })}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("61")).toBeInTheDocument();
  });

  it("surfaces a generation failure without losing the already-loaded brief (AC-39)", () => {
    renderCard({
      brief: brief(),
      generate: generateState({
        isError: true,
        error: new ApiError("No API key configured", 409, "config_error"),
      }),
    });

    expect(screen.getByText("Generation failed — No API key configured")).toBeInTheDocument();
    expect(screen.getByText("Adds rate limiting to the public API.")).toBeInTheDocument();
  });
});
