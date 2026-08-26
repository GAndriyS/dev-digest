import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import { ApiError } from "@/lib/api";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("@/lib/toast", () => ({
  notify: { error: (...args: unknown[]) => toastError(...args), success: (...args: unknown[]) => toastSuccess(...args) },
}));

const mutateAsync = vi.fn();
let isPending = false;
vi.mock("@/lib/hooks/eval", () => ({
  useCreateEvalCaseFromFinding: () => ({ mutateAsync, get isPending() { return isPending; } }),
}));

import { FindingCard } from "./FindingCard";

afterEach(cleanup);

beforeEach(() => {
  push.mockClear();
  toastError.mockClear();
  toastSuccess.mockClear();
  mutateAsync.mockReset();
  isPending = false;
});

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, eval: evalMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

describe("FindingCard — Turn into eval case (L06 AC-1, AC-2, AC-5, AC-6)", () => {
  const DECIDED: FindingRecord = { ...FINDING, accepted_at: "2026-08-20T00:00:00Z" };

  it("is disabled with an accessible reason when the finding has no decision (AC-2)", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);
    const button = screen.getByRole("button", { name: "Turn into eval case" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Accept or dismiss the finding first");
    const describedBy = button.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      "Accept or dismiss the finding first",
    );
    fireEvent.click(button);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("is enabled once the finding has a decision", () => {
    renderWithIntl(<FindingCard f={DECIDED} defaultExpanded onAction={() => {}} />);
    const button = screen.getByRole("button", { name: "Turn into eval case" });
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute("title");
  });

  it("on 201 (created), toasts + navigates to the owning agent's Evals tab", async () => {
    mutateAsync.mockResolvedValue({
      case: { id: "ec1", owner_id: "agent-1" },
      created: true,
    });
    renderWithIntl(<FindingCard f={DECIDED} defaultExpanded onAction={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn into eval case" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith("f1"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/agents/agent-1?tab=evals"));
    expect(toastSuccess).toHaveBeenCalledWith("Eval case created");
  });

  it("on 200 (already existed), still opens the case with the 'already exists' toast", async () => {
    mutateAsync.mockResolvedValue({
      case: { id: "ec1", owner_id: "agent-1" },
      created: false,
    });
    renderWithIntl(<FindingCard f={DECIDED} defaultExpanded onAction={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn into eval case" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/agents/agent-1?tab=evals"));
    expect(toastSuccess).toHaveBeenCalledWith("Eval case already exists — opening it");
  });

  it("on a 422 no-diff failure, toasts the explanation and does not navigate (AC-5)", async () => {
    mutateAsync.mockRejectedValue(
      new ApiError("No diff text for this file.", 422, "eval_case_no_diff"),
    );
    renderWithIntl(<FindingCard f={DECIDED} defaultExpanded onAction={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn into eval case" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("No diff text for this file — can't create an eval case."),
    );
    expect(push).not.toHaveBeenCalled();
  });
});
