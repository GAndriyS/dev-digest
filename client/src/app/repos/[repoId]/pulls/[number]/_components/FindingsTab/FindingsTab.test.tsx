import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import evalMessages from "../../../../../../../../messages/en/eval.json";

// Mocked because ReviewRunAccordion (rendered inside FindingsTab, one per
// review) reaches for these directly; aliased path so it matches regardless
// of which nested source file does the importing.
vi.mock("@/lib/hooks/reviews", () => ({
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

// FindingCard (rendered inside FindingsPanel, rendered inside FindingsTab)
// now owns the "Turn into eval case" action (L06 step 12) — mocked for the
// same reason as hooks/reviews above (a real useMutation needs a
// QueryClientProvider this suite doesn't mount), plus next/navigation for
// the router it opens the case with.
vi.mock("@/lib/hooks/eval", () => ({
  useCreateEvalCaseFromFinding: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { FindingsTab } from "./FindingsTab";

afterEach(cleanup);

// jsdom has no scrollIntoView implementation; ReviewRunAccordion's
// timeline-jump effect and FindingsPanel's target-scroll effect both call it.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function finding(o: Partial<FindingRecord> & { id: string; review_id: string }): FindingRecord {
  return {
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function review(o: Partial<ReviewRecord> & { id: string; findings: FindingRecord[] }): ReviewRecord {
  return {
    pr_id: "pr1",
    agent_id: null,
    run_id: null,
    agent_name: "Reviewer",
    kind: "review",
    verdict: null,
    summary: null,
    score: null,
    model: null,
    grounding: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...o,
  };
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ prReview: prReviewMessages, shell: shellMessages, eval: evalMessages }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

// noop callback props FindingsTab requires but this suite doesn't exercise.
const noopProps = {
  onOpenTrace: vi.fn(),
  onDelete: vi.fn(),
  onRunDone: vi.fn(),
  // UseMutationResult carries many fields this suite never reads; the
  // component only calls `.mutate` (never triggered here) and reads
  // `.isPending`.
  cancelMutation: { mutate: vi.fn(), isPending: false } as unknown as never,
};

describe("FindingsTab target navigation (from Diff tab)", () => {
  it("opens the accordion owning the target finding while a sibling accordion stays closed", () => {
    // A `FindingRecord` carries `review_id` but no `run_id` — FindingsTab
    // must resolve the target to its owning review by scanning
    // `runs[].findings` for the id, not by any run-level field.
    const runs: ReviewRecord[] = [
      review({
        id: "r-decoy",
        agent_name: "Decoy agent",
        findings: [finding({ id: "f-decoy", review_id: "r-decoy", title: "Decoy finding" })],
      }),
      review({
        id: "r-sibling",
        agent_name: "Sibling agent",
        findings: [finding({ id: "f-sibling", review_id: "r-sibling", title: "Sibling finding" })],
      }),
      review({
        id: "r-target",
        agent_name: "Target agent",
        findings: [finding({ id: "f-target", review_id: "r-target", title: "Target finding" })],
      }),
    ];

    renderWithIntl(
      <FindingsTab
        prId="pr1"
        liveRunIds={[]}
        reviewRunning={false}
        lethalTrifecta={[]}
        runs={runs}
        prRuns={undefined}
        prCommits={[]}
        targetFindingId="f-target"
        {...noopProps}
      />,
    );

    // The target's own review (index 2 — not the trivially-first accordion)
    // opened and rendered its finding.
    expect(screen.getByText("Target finding")).toBeInTheDocument();
    // A sibling review, also not first, holds a different finding and was
    // never matched — its accordion stays collapsed and renders nothing.
    expect(screen.queryByText("Sibling finding")).not.toBeInTheDocument();
  });

  it("opens no accordion beyond the default when there is no target", () => {
    const runs: ReviewRecord[] = [
      review({
        id: "r-decoy",
        findings: [finding({ id: "f-decoy", review_id: "r-decoy", title: "Decoy finding" })],
      }),
      review({
        id: "r-other",
        findings: [finding({ id: "f-other", review_id: "r-other", title: "Other finding" })],
      }),
    ];

    renderWithIntl(
      <FindingsTab
        prId="pr1"
        liveRunIds={[]}
        reviewRunning={false}
        lethalTrifecta={[]}
        runs={runs}
        prRuns={undefined}
        prCommits={[]}
        targetFindingId={null}
        {...noopProps}
      />,
    );

    // Only the first review's accordion opens by its own default.
    expect(screen.getByText("Decoy finding")).toBeInTheDocument();
    expect(screen.queryByText("Other finding")).not.toBeInTheDocument();
  });
});
