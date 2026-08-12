import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/intent.json";

// IntentCard sits above the description and pulls its own data; this suite is
// about the description, so the hooks are stubbed to the not-classified state.
vi.mock("@/lib/hooks/reviews", () => ({
  usePrIntent: () => ({ data: null, isLoading: false, isError: false, refetch: vi.fn() }),
  useDeriveIntent: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
}));

import { OverviewTab } from "./OverviewTab";

const BODY = [
  "Adds a limiter.",
  "",
  "## Insights",
  "",
  "- Pinned `pnpm` to 10 in **both** packages",
  "- Nothing else recorded",
].join("\n");

function renderTab(prBody: string | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ intent: messages }}>
      <OverviewTab prBody={prBody} prId="pr-1" headSha="abc123" />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("OverviewTab", () => {
  it("renders the PR body as Markdown rather than as its source text", () => {
    renderTab(BODY);

    // The repo's own convention ends every PR body with this section, so it is
    // the case that matters: a real heading, not a literal "## Insights".
    expect(screen.getByRole("heading", { name: "Insights" })).toBeInTheDocument();
    expect(screen.queryByText(/^## Insights$/)).not.toBeInTheDocument();

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("pnpm").tagName).toBe("CODE");
    expect(screen.getByText("both").tagName).toBe("STRONG");
  });

  it("escapes embedded HTML — a PR body is attacker-controlled input", () => {
    renderTab('Hello <img src=x onerror="alert(1)"> world');

    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText(/onerror/)).toBeInTheDocument();
  });

  it("omits the description section entirely when the PR has no body", () => {
    renderTab(null);

    expect(screen.queryByText("Description")).not.toBeInTheDocument();
    // The intent card above it still renders — an empty body is not an error.
    expect(screen.getByText("Not classified yet")).toBeInTheDocument();
  });
});
