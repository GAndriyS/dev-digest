import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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

    fireEvent.click(screen.getByRole("button", { name: "Original order" }));

    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /warning finding/i })).not.toBeInTheDocument();
    // Original order removes annotations and groups — not files.
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
  });

  it("shows the file count and the summed +/- across every file in the header", () => {
    renderTab({ filesCount: 3 });

    expect(screen.getByText("3 files")).toBeInTheDocument();
    expect(screen.getByText("+4")).toBeInTheDocument();
    expect(screen.getByText("−2")).toBeInTheDocument();
  });
});
