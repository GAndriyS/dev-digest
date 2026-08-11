import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@/lib/types";
import shellMessages from "../../../../messages/en/shell.json";
import { FileCard } from "./FileCard";

// A finding's `start_line` can fall on a deleted line or a gap between hunks
// that the stored patch never rendered — `CodeLine` only emits `data-line`
// for a line with a `newNo`. Two hunks with a gap (new-side lines 2-4 never
// rendered) exercise exactly that: rendered new-side lines are 1, 5, 6.
const GAPPY_PATCH = `@@ -1,1 +1,1 @@
 unchanged
@@ -5,0 +5,2 @@
+added-five
+added-six`;

let scrolledEl: Element | null = null;

beforeEach(() => {
  scrolledEl = null;
  // Capture which element scrollIntoView was called on (its `this`), so the
  // test can assert exactly which rendered line the jump landed on.
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolledEl = this;
  });
});
afterEach(cleanup);

function renderCard(findingLines: number[]) {
  const file: PrFile = { path: "src/service.ts", additions: 2, deletions: 0, patch: GAPPY_PATCH };
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>
      <FileCard file={file} findingLines={findingLines} />
    </NextIntlClientProvider>,
  );
}

describe("FileCard — finding badge jump fallback", () => {
  it("lands on the nearest rendered line at or after the target when the exact line has no anchor, and falls back to the last rendered line once the cycle passes the end of the file", () => {
    renderCard([3, 10]);

    const badge = screen.getByRole("button", { name: /2 finding-line\(s\)/i });

    // Target 3 has no `data-line="3"` anchor (it falls in the 2-4 gap) — the
    // nearest rendered line at or after it is 5.
    fireEvent.click(badge);
    expect(scrolledEl).not.toBeNull();
    expect(scrolledEl).toHaveAttribute("data-line", "5");

    // Cycles to target 10, past every rendered line — falls back to the last
    // rendered line (6) rather than doing nothing.
    fireEvent.click(badge);
    expect(scrolledEl).toHaveAttribute("data-line", "6");
  });
});
