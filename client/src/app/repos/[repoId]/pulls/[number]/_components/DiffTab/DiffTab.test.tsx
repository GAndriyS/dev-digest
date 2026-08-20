import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, SmartDiff, SmartDiffFile } from "@devdigest/shared";
// DiffTab and the SmartDiffViewer it renders read copy from two namespaces:
// `prReview` (smartDiff.* keys) and `shell` (diffViewer.* keys used inside the
// shared FileCard/CodeLine).
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";

const state = {
  smartDiff: null as SmartDiff | null | undefined,
  comments: [] as unknown[],
};

// Same technique IntentCard.test.tsx uses: mock the data hooks directly so
// this suite stays free of a QueryClientProvider. DiffTab itself calls
// usePrComments/useCreatePrComment; the SmartDiffViewer it renders for the
// "smart" view calls usePrSmartDiff — all three live in the same module.
vi.mock("@/lib/hooks/reviews", () => ({
  usePrSmartDiff: () => ({ data: state.smartDiff, isLoading: false, isError: false }),
  usePrComments: () => ({ data: state.comments }),
  useCreatePrComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { DiffTab } from "./DiffTab";

beforeEach(() => {
  state.smartDiff = null;
  state.comments = [];
});
afterEach(cleanup);

function prFile(over: Partial<PrFile> = {}): PrFile {
  return {
    path: "src/file.ts",
    additions: 1,
    deletions: 0,
    patch: '@@ -1,1 +1,1 @@\n-old\n+new',
    ...over,
  };
}

function smartDiffFile(over: Partial<SmartDiffFile> = {}): SmartDiffFile {
  return {
    path: "src/file.ts",
    pseudocode_summary: null,
    additions: 1,
    deletions: 0,
    finding_lines: [],
    ...over,
  };
}

function findingRecord(over: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    review_id: "r1",
    severity: "WARNING",
    category: "bug",
    title: "finding",
    file: "src/middleware/ratelimit.ts",
    start_line: 3,
    end_line: 3,
    rationale: "A finding.",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

const CORE_PATCH = `@@ -1,2 +1,3 @@
 const limiter = createLimiter();
+app.use(limiter);
+export default limiter;`;

const WIRING_PATCH = `@@ -1,1 +1,2 @@
 import { router } from "./router";
+router.use("/api", apiRouter);`;

const LOCK_PATCH = `@@ -1,1 +1,1 @@
-lockfileVersion: 5.4
+lockfileVersion: 6.0`;

// Additions sum to 4, deletions sum to 2 — asserted against the header's
// `+Σ −Σ`.
const FILES: PrFile[] = [
  prFile({ path: "src/middleware/ratelimit.ts", additions: 2, deletions: 0, patch: CORE_PATCH }),
  prFile({ path: "src/routes/index.ts", additions: 1, deletions: 1, patch: WIRING_PATCH }),
  prFile({ path: "pnpm-lock.yaml", additions: 1, deletions: 1, patch: LOCK_PATCH }),
];

function renderTab(
  props: {
    files?: PrFile[];
    filesCount?: number;
    findings?: FindingRecord[];
    onOpenFinding?: (findingId: string) => void;
    targetPath?: string | null;
  } = {},
) {
  const files = props.files ?? FILES;
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, shell: shellMessages }}>
      <DiffTab
        prId="pr-1"
        filesCount={props.filesCount ?? files.length}
        files={files}
        findings={props.findings ?? []}
        onOpenFinding={props.onOpenFinding ?? vi.fn()}
        targetPath={props.targetPath}
      />
    </NextIntlClientProvider>,
  );
}

describe("DiffTab", () => {
  it("defaults to Smart order (annotations + group headers visible), and Original order strips both without dropping the file", () => {
    state.smartDiff = {
      groups: [
        { role: "core", files: [smartDiffFile({ path: "src/middleware/ratelimit.ts", additions: 2, deletions: 0 })] },
        { role: "wiring", files: [smartDiffFile({ path: "src/routes/index.ts", additions: 1, deletions: 1 })] },
        { role: "boilerplate", files: [smartDiffFile({ path: "pnpm-lock.yaml", additions: 1, deletions: 1 })] },
      ],
      split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
    };
    const findings = [
      findingRecord({ id: "f1", file: "src/middleware/ratelimit.ts", start_line: 3, severity: "WARNING" }),
    ];
    renderTab({ findings });

    // Smart order is the default — no click needed to see grouping + annotations.
    expect(screen.getByText("Core logic")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /warning finding/i })).toBeInTheDocument();

    // One control for both orders: picking the other segment flips the view.
    expect(screen.getByRole("radio", { name: "Smart order" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Original order" }));
    expect(screen.getByRole("radio", { name: "Original order" })).toBeChecked();

    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /warning finding/i })).not.toBeInTheDocument();
    // Original order removes annotations and groups — not files.
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
  });

  // Both order names stay readable, but neither is a control of its own: they
  // are the two segments of one radiogroup, which is what the pill draws.
  it("offers the two orders as one segmented control rather than two buttons", () => {
    renderTab();

    const group = screen.getByRole("radiogroup", { name: "Diff order" });
    const segments = within(group).getAllByRole("radio");

    expect(segments.map((el) => el.textContent)).toEqual(["Smart order", "Original order"]);
    expect(segments.filter((el) => el.getAttribute("aria-checked") === "true")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Smart order" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Original order" })).not.toBeInTheDocument();
    // One tab stop for the pair — the unselected segment is reached by arrow.
    expect(segments.map((el) => el.tabIndex)).toEqual([0, -1]);
  });

  it("moves between segments with the arrow keys, keeping focus on the selected one", () => {
    renderTab();
    const group = screen.getByRole("radiogroup", { name: "Diff order" });

    fireEvent.keyDown(group, { key: "ArrowRight" });

    const original = screen.getByRole("radio", { name: "Original order" });
    expect(original).toBeChecked();
    expect(original).toHaveFocus();
    expect(original.tabIndex).toBe(0);
  });

  it("shows the file count and the summed +/- across every file in the header", () => {
    renderTab({ filesCount: 3 });

    expect(screen.getByText("3 files")).toBeInTheDocument();
    expect(screen.getByText("+4")).toBeInTheDocument();
    expect(screen.getByText("−2")).toBeInTheDocument();
  });
});

// SPEC-04 AC-34/AC-35: a `targetPath` (the page's `?file=`, from a PrBriefCard
// Review Focus click) opens the file expanded and scrolled into view, without
// going through SmartDiffViewer's own grouped `fileMeta` (R3/Amendment A3 —
// `targetFileMeta` in `SmartDiffViewer/helpers.ts` is the single assembly
// point, DiffTab renders the flat DiffViewer directly instead of reaching
// into SmartDiffViewer's).
describe("DiffTab target file navigation (?file=)", () => {
  // jsdom has no scrollIntoView implementation; the scroll-to-target effect
  // calls it whenever `targetPath` resolves to a rendered file.
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  // Large enough that FileCard's own size heuristic would leave it collapsed
  // absent `defaultOpen` — the only way `firstFindingId`-free content proves
  // the override actually fired, not the heuristic coincidentally agreeing.
  const LARGE_FILE = prFile({
    path: "src/big.ts",
    additions: 250,
    deletions: 0,
    patch: "@@ -1,1 +1,1 @@\n-old\n+new",
  });

  it("forces Original order and expands the target file via defaultOpen, bypassing Smart order's own fileMeta", () => {
    state.smartDiff = {
      groups: [{ role: "core", files: [smartDiffFile({ path: "src/big.ts", additions: 250, deletions: 0 })] }],
      split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
    };
    renderTab({ files: [LARGE_FILE], filesCount: 1, targetPath: "src/big.ts" });

    // Original order, not Smart order — SmartDiffViewer's "Core logic" group
    // header never renders, confirming the direct-DiffViewer path was taken.
    expect(screen.getByRole("radio", { name: "Original order" })).toBeChecked();
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
    // FileCard's own heuristic (>200 changed lines) would leave this card
    // COLLAPSED absent an override — its patch lines rendering at all is the
    // observable proof `defaultOpen: true` (not the heuristic) opened it.
    expect(screen.getByText("old")).toBeInTheDocument();
    expect(screen.getByText("new")).toBeInTheDocument();
  });

  it("drives scrollIntoView off the requestAnimationFrame loop for the target file", async () => {
    renderTab({ targetPath: "src/middleware/ratelimit.ts" });

    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });
    const calls = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]?.[0]).toEqual({ block: "center" });
  });

  it("does not call scrollIntoView, and keeps the Smart order default, when there is no target", () => {
    renderTab();

    expect(screen.getByRole("radio", { name: "Smart order" })).toBeChecked();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("stays inert (no crash, no scroll) when the target path names a file outside this render's list", async () => {
    renderTab({ targetPath: "src/does-not-exist.ts" });

    // Original order is still forced (the page already filtered `?file=`
    // against `pr.files` before this point — DiffTab has no opinion of its
    // own on whether the path is real) — but nothing ever matches, so the
    // scroll loop runs out its frame budget without ever finding a target.
    expect(screen.getByRole("radio", { name: "Original order" })).toBeChecked();
    await new Promise((r) => setTimeout(r, 50));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
