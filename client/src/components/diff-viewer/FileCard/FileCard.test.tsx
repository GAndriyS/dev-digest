import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@/lib/types";
import type { DiffLineAnnotation } from "../DiffViewer";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import shellMessages from "../../../../messages/en/shell.json";
import { FileCard } from "./FileCard";

// A finding's `line` can fall on a deleted line or a gap between hunks that
// the stored patch never rendered — `CodeLine` only emits `data-line` for a
// line with a `newNo`. Two hunks with a gap (new-side lines 2-4 never
// rendered) exercise exactly that: rendered new-side lines are 1, 5, 6.
const GAPPY_PATCH = `@@ -1,1 +1,1 @@
 unchanged
@@ -5,0 +5,2 @@
+added-five
+added-six`;

function file(over: Partial<PrFile> = {}): PrFile {
  return { path: "src/service.ts", additions: 2, deletions: 0, patch: GAPPY_PATCH, ...over };
}

function annotation(over: Partial<DiffLineAnnotation> = {}): DiffLineAnnotation {
  return { findingId: "f-1", line: 1, severity: "WARNING", ...over };
}

let onFindingClick: ReturnType<typeof vi.fn>;

beforeEach(() => {
  onFindingClick = vi.fn();
});
afterEach(cleanup);

function renderCard(props: { annotations?: DiffLineAnnotation[]; file?: PrFile } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>
      <FileCard file={props.file ?? file()} annotations={props.annotations} onFindingClick={onFindingClick} />
    </NextIntlClientProvider>,
  );
}

describe("FileCard — finding badge and annotations", () => {
  it("badge calls onFindingClick with the first finding — lowest line wins, severity only tie-breaks within a line", () => {
    // sugg-1 and crit-1 share line 1 (rendered as-is); warn-6 sits on line 6 with
    // higher severity than sugg-1 alone but a later line — line still wins.
    renderCard({
      annotations: [
        annotation({ findingId: "sugg-1", line: 1, severity: "SUGGESTION" }),
        annotation({ findingId: "crit-1", line: 1, severity: "CRITICAL" }),
        annotation({ findingId: "warn-6", line: 6, severity: "WARNING" }),
      ],
    });

    const badge = screen.getByRole("button", { name: /3 finding\(s\)/i });
    fireEvent.click(badge);
    expect(onFindingClick).toHaveBeenCalledWith("crit-1");
    expect(onFindingClick).toHaveBeenCalledOnce();
  });

  it("clicking a line's own annotation chip calls onFindingClick with that annotation's id, not the badge's first finding", () => {
    renderCard({
      annotations: [
        annotation({ findingId: "crit-1", line: 1, severity: "CRITICAL" }),
        annotation({ findingId: "warn-6", line: 6, severity: "WARNING" }),
      ],
    });

    // The badge's first finding would be crit-1 (lowest line) — clicking the
    // line-6 chip must report warn-6 instead.
    fireEvent.click(screen.getByRole("button", { name: /warning finding/i }));
    expect(onFindingClick).toHaveBeenCalledWith("warn-6");
    expect(onFindingClick).not.toHaveBeenCalledWith("crit-1");
  });

  it("snaps an annotation targeting an unrendered line onto the nearest rendered line at or after it", () => {
    // Target line 3 falls in the 2-4 gap the stored patch never renders —
    // nearest rendered new-side line at or after it is 5, not 1.
    renderCard({ annotations: [annotation({ findingId: "gap-id", line: 3, severity: "WARNING" })] });

    const chip = screen.getByRole("button", { name: /warning finding/i });
    expect(chip.closest("[data-line]")).toHaveAttribute("data-line", "5");
    expect(screen.queryByText("added-five")).toBeInTheDocument();
  });

  it("shows the 'large' chip once changed lines exceed the auto-expand threshold, not at the threshold itself", () => {
    renderCard({ file: file({ additions: AUTO_EXPAND_MAX_LINES, deletions: 0 }) });
    expect(screen.queryByText(new RegExp(`large.*${AUTO_EXPAND_MAX_LINES}`, "i"))).not.toBeInTheDocument();
    cleanup();

    renderCard({ file: file({ additions: AUTO_EXPAND_MAX_LINES + 1, deletions: 0 }) });
    expect(screen.getByText(new RegExp(`large.*${AUTO_EXPAND_MAX_LINES + 1}`, "i"))).toBeInTheDocument();
  });

  it("tints a line and its left bar by that line's own annotation severity, not a fixed colour", () => {
    renderCard({
      annotations: [
        annotation({ findingId: "crit-1", line: 1, severity: "CRITICAL" }),
        annotation({ findingId: "warn-6", line: 6, severity: "WARNING" }),
      ],
    });

    const criticalRow = document.querySelector('[data-line="1"]')!.firstElementChild as HTMLElement;
    const warningRow = document.querySelector('[data-line="6"]')!.firstElementChild as HTMLElement;
    expect(criticalRow.style.boxShadow).toContain("var(--crit)");
    expect(warningRow.style.boxShadow).toContain("var(--warn)");
    expect(criticalRow.style.boxShadow).not.toContain("var(--warn)");
  });
});
