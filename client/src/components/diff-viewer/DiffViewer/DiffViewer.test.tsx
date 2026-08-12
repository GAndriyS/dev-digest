import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@/lib/types";
import shellMessages from "../../../../messages/en/shell.json";
import { DiffViewer, type DiffFileMeta } from "./DiffViewer";

// jsdom has no scrollIntoView implementation; FileCard's finding-jump effect
// calls it once a card opens (irrelevant here, but shared setup with sibling
// suites keeps this from throwing if a future test opens a card).
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

function prFile(over: Partial<PrFile> = {}): PrFile {
  return {
    path: "src/a.ts",
    additions: 1,
    deletions: 0,
    patch: "@@ -1,1 +1,1 @@\n-old\n+new",
    ...over,
  };
}

function renderDiff(files: PrFile[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>
      <DiffViewer files={files} />
    </NextIntlClientProvider>,
  );
}

describe("DiffViewer", () => {
  it("keeps a file's open/closed state attached to its path, not its position, when the list reorders", () => {
    // Both files are large enough that FileCard's size heuristic starts them
    // closed — the only way to see "b.ts" open is via the toggle below.
    const bFileClosed = prFile({
      path: "b.ts",
      additions: 500,
      deletions: 0,
      patch: "@@ -1,1 +1,1 @@\n-old\n+new-b",
    });
    const aFileClosed = prFile({
      path: "a.ts",
      additions: 500,
      deletions: 0,
      patch: "@@ -1,1 +1,1 @@\n-old\n+new-a",
    });

    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>
        <DiffViewer files={[bFileClosed, aFileClosed]} />
      </NextIntlClientProvider>,
    );

    // Open the SECOND card (a.ts) by clicking its header.
    fireEvent.click(screen.getByText("a.ts"));
    expect(screen.getByText("new-a")).toBeInTheDocument();
    expect(screen.queryByText("new-b")).not.toBeInTheDocument();

    // Reorder the list so a.ts is now FIRST — with an index key, React would
    // reuse the instance mounted at index 0 (previously b.ts, closed) for
    // a.ts, silently re-closing it. With a path key, a.ts's own instance
    // (and its open state) follows it to its new position.
    rerender(
      <NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>
        <DiffViewer files={[aFileClosed, bFileClosed]} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("new-a")).toBeInTheDocument();
    expect(screen.queryByText("new-b")).not.toBeInTheDocument();
  });

  it("renders every file's path and falls back to the empty state with no files", () => {
    renderDiff([prFile({ path: "src/x.ts" }), prFile({ path: "src/y.ts" })]);
    expect(screen.getByText("src/x.ts")).toBeInTheDocument();
    expect(screen.getByText("src/y.ts")).toBeInTheDocument();
    cleanup();

    renderDiff([]);
    expect(screen.getByText("No changed files.")).toBeInTheDocument();
  });

  it("routes fileMeta annotations to the FileCard whose path matches, and none to the others", () => {
    const onFindingClick = vi.fn();
    const files = [prFile({ path: "src/a.ts" }), prFile({ path: "src/b.ts" })];
    const fileMeta: Record<string, DiffFileMeta> = {
      "src/b.ts": { annotations: [{ findingId: "finding-b", line: 1, severity: "CRITICAL" }] },
    };

    render(
      <NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>
        <DiffViewer files={files} fileMeta={fileMeta} onFindingClick={onFindingClick} />
      </NextIntlClientProvider>,
    );

    // a.ts has no fileMeta entry — its header shows no finding badge at all.
    const aHeader = screen.getByText("src/a.ts").closest("div")!;
    expect(within(aHeader).queryByRole("button", { name: /finding/i })).not.toBeInTheDocument();

    // b.ts's badge carries exactly the annotation routed to its own path.
    const badge = screen.getByRole("button", { name: /1 finding\(s\)/i });
    fireEvent.click(badge);
    expect(onFindingClick).toHaveBeenCalledWith("finding-b");
  });
});
