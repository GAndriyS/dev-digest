import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, SmartDiff, SmartDiffFile } from "@devdigest/shared";
// The component reads copy from two namespaces: `prReview` (smartDiff.* keys)
// and `shell` (diffViewer.* keys used inside the shared FileCard/CodeLine).
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";

const state = {
  data: null as SmartDiff | null | undefined,
  isLoading: false,
  isError: false,
};

// Same technique IntentCard.test.tsx uses: mock the data hook directly so this
// suite stays free of a QueryClientProvider.
vi.mock("@/lib/hooks/reviews", () => ({
  usePrSmartDiff: () => ({
    data: state.data,
    isLoading: state.isLoading,
    isError: state.isError,
  }),
}));

import { SmartDiffViewer } from "./SmartDiffViewer";

beforeEach(() => {
  state.data = null;
  state.isLoading = false;
  state.isError = false;
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
    // Dead field since v2 (client join replaced it) — kept only because the
    // contract still requires it; no test relies on its contents.
    finding_lines: [],
    ...over,
  };
}

function smartDiff(over: Partial<SmartDiff> = {}): SmartDiff {
  return {
    groups: [],
    split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
    ...over,
  };
}

function findingRecord(over: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    review_id: "r1",
    severity: "CRITICAL",
    category: "security",
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

// Real patch text so a finding's `start_line` (new-side numbers) lands on an
// actual rendered line: ctx line -> newNo 1, then two `+` lines -> newNo 2 and 3.
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

const baseFiles: PrFile[] = [
  prFile({ path: "src/middleware/ratelimit.ts", additions: 2, deletions: 0, patch: CORE_PATCH }),
  prFile({ path: "src/routes/index.ts", additions: 1, deletions: 0, patch: WIRING_PATCH }),
  prFile({ path: "pnpm-lock.yaml", additions: 1, deletions: 1, patch: LOCK_PATCH }),
];

const baseSmartDiff = smartDiff({
  groups: [
    { role: "core", files: [smartDiffFile({ path: "src/middleware/ratelimit.ts", additions: 2, deletions: 0 })] },
    { role: "wiring", files: [smartDiffFile({ path: "src/routes/index.ts", additions: 1, deletions: 0 })] },
    { role: "boilerplate", files: [smartDiffFile({ path: "pnpm-lock.yaml", additions: 1, deletions: 1 })] },
  ],
});

function renderViewer(
  props: {
    prId?: string | null;
    files?: PrFile[];
    findings?: FindingRecord[];
    onOpenFinding?: (findingId: string) => void;
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, shell: shellMessages }}>
      <SmartDiffViewer
        prId={props.prId ?? "pr-1"}
        files={props.files ?? baseFiles}
        findings={props.findings ?? []}
        onOpenFinding={props.onOpenFinding ?? (() => {})}
      />
    </NextIntlClientProvider>,
  );
}

/** The role-group header is a `role="button"` div, found via its label span
    then walked up — avoids relying on the accessible-name computation, which
    also folds in the icon, the description and the file count. */
function groupHeader(label: string): HTMLElement {
  const el = screen.getByText(label, { selector: "span" }).closest('[role="button"]');
  if (!el) throw new Error(`no role="button" ancestor for group header "${label}"`);
  return el as HTMLElement;
}

describe("SmartDiffViewer", () => {
  it("renders role groups in the server's order — core, then wiring, then boilerplate", () => {
    state.data = baseSmartDiff;
    renderViewer();

    const core = screen.getByText("Core logic", { selector: "span" });
    const wiring = screen.getByText("Wiring", { selector: "span" });
    const boilerplate = screen.getByText("Boilerplate", { selector: "span" });

    expect(core.compareDocumentPosition(wiring) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(wiring.compareDocumentPosition(boilerplate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the boilerplate group starts collapsed on mount and reveals its file only once the header is activated", () => {
    state.data = baseSmartDiff;
    renderViewer();

    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();

    fireEvent.click(groupHeader("Boilerplate"));

    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
  });

  it("a group header toggles its files open and closed via click, Enter, and Space", () => {
    state.data = smartDiff({
      groups: [{ role: "core", files: [smartDiffFile({ path: "src/app.ts", additions: 1, deletions: 0 })] }],
    });
    renderViewer({
      files: [prFile({ path: "src/app.ts", additions: 1, deletions: 0, patch: '@@ -1,1 +1,1 @@\n-old\n+new' })],
    });

    // Non-boilerplate groups start open.
    expect(screen.getByText("src/app.ts")).toBeInTheDocument();

    const header = groupHeader("Core logic");
    fireEvent.click(header);
    expect(screen.queryByText("src/app.ts")).not.toBeInTheDocument();

    fireEvent.keyDown(header, { key: "Enter" });
    expect(screen.getByText("src/app.ts")).toBeInTheDocument();

    fireEvent.keyDown(header, { key: " " });
    expect(screen.queryByText("src/app.ts")).not.toBeInTheDocument();
  });

  it("a file's finding badge calls onOpenFinding with the first finding's id, instead of opening the file or revealing a line", () => {
    // additions pushed past AUTO_EXPAND_MAX_LINES (200) so the file starts
    // closed by FileCard's own size heuristic — proves the badge click no
    // longer reveals the flagged line the way the pre-v2 scroll cycle did.
    const bigCoreFile = prFile({
      path: "src/middleware/ratelimit.ts",
      additions: 500,
      deletions: 0,
      patch: CORE_PATCH,
    });
    state.data = smartDiff({
      groups: [
        { role: "core", files: [smartDiffFile({ path: "src/middleware/ratelimit.ts", additions: 500, deletions: 0 })] },
      ],
    });
    const onOpenFinding = vi.fn();
    const findings = [
      findingRecord({ id: "f-badge", file: "src/middleware/ratelimit.ts", start_line: 3, severity: "WARNING" }),
    ];
    renderViewer({ files: [bigCoreFile], findings, onOpenFinding });

    expect(screen.queryByText("export default limiter;")).not.toBeInTheDocument();

    const badge = screen.getByRole("button", { name: /1 finding\(s\)/i });
    fireEvent.click(badge);

    expect(onOpenFinding).toHaveBeenCalledWith("f-badge");
    // No row reveal, no open — the badge only navigates now.
    expect(screen.queryByText("export default limiter;")).not.toBeInTheDocument();
  });

  it("renders an annotation chip on the flagged line with the right severity label, and clicking it opens the finding", () => {
    state.data = smartDiff({
      groups: [{ role: "core", files: [smartDiffFile({ path: "src/middleware/ratelimit.ts", additions: 2, deletions: 0 })] }],
    });
    const onOpenFinding = vi.fn();
    const findings = [
      findingRecord({ id: "f-line", file: "src/middleware/ratelimit.ts", start_line: 3, severity: "SUGGESTION" }),
    ];
    renderViewer({ findings, onOpenFinding });

    const chip = screen.getByRole("button", { name: /suggestion finding/i });
    expect(chip).toHaveTextContent("suggestion");

    fireEvent.click(chip);
    expect(onOpenFinding).toHaveBeenCalledWith("f-line");
  });

  it("a dismissed finding produces no annotation and no badge", () => {
    state.data = smartDiff({
      groups: [{ role: "core", files: [smartDiffFile({ path: "src/middleware/ratelimit.ts", additions: 2, deletions: 0 })] }],
    });
    const findings = [
      findingRecord({
        id: "f-dismissed",
        file: "src/middleware/ratelimit.ts",
        start_line: 3,
        severity: "CRITICAL",
        dismissed_at: "2026-01-01T00:00:00Z",
      }),
    ];
    renderViewer({ findings });

    expect(screen.queryByRole("button", { name: /blocker finding/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /finding\(s\)/i })).not.toBeInTheDocument();
  });

  it("a small file in the boilerplate group stays closed on mount even though it is well under the auto-expand size threshold", () => {
    state.data = baseSmartDiff;
    renderViewer();

    // pnpm-lock.yaml's total changed lines (1+1=2) is far under
    // AUTO_EXPAND_MAX_LINES (200), so the size heuristic alone would open it —
    // DEFAULT_OPEN_BY_ROLE.boilerplate=false must be what keeps its diff body
    // shut, regardless of whether the surrounding group itself is open.
    expect(screen.queryByText("lockfileVersion: 6.0")).not.toBeInTheDocument();
  });

  it("falls back to the plain diff and still renders every file path when the smart-diff query errors", () => {
    state.isError = true;
    renderViewer();

    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
    expect(screen.getByText("src/routes/index.ts")).toBeInTheDocument();
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
    // No role-grouping UI in the fallback.
    expect(screen.queryByText("Core logic", { selector: "span" })).not.toBeInTheDocument();
  });

  it("shows the too_big banner only when split_suggestion.too_big is set", () => {
    state.data = baseSmartDiff; // too_big: false
    renderViewer();
    expect(screen.queryByText(/This PR is large/)).not.toBeInTheDocument();
    cleanup();

    state.data = smartDiff({
      groups: baseSmartDiff.groups,
      split_suggestion: {
        too_big: true,
        total_lines: 900,
        proposed_splits: [{ name: "rate-limiting", files: ["src/middleware/ratelimit.ts"] }],
      },
    });
    renderViewer();

    expect(screen.getByText("This PR is large (900 changed lines)")).toBeInTheDocument();
    expect(screen.getByText("rate-limiting")).toBeInTheDocument();
  });
});
