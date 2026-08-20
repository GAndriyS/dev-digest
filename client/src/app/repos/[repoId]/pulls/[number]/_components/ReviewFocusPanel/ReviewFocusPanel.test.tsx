import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReviewFocusItem } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";

import { ReviewFocusPanel } from "./ReviewFocusPanel";

function renderPanel(
  props: {
    reviewFocus?: ReviewFocusItem[];
    onOpenFile?: (path: string) => void;
    navigablePaths?: ReadonlySet<string>;
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <ReviewFocusPanel
        reviewFocus={props.reviewFocus ?? []}
        onOpenFile={props.onOpenFile}
        navigablePaths={props.navigablePaths}
      />
    </NextIntlClientProvider>,
  );
}

const singleItem: ReviewFocusItem[] = [
  { path: "src/middleware/ratelimit.ts", reason: "New limiter logic.", line: null },
];

afterEach(cleanup);

describe("ReviewFocusPanel", () => {
  it("shows the heading and a count of the shown items (AC-60)", () => {
    renderPanel({ reviewFocus: singleItem });
    expect(screen.getByText("Review focus — read these first")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders rows as keyboard-operable buttons that call onOpenFile with the item's path when the path is in navigablePaths (AC-33, AC-34, AC-36)", () => {
    const onOpenFile = vi.fn();
    renderPanel({
      reviewFocus: singleItem,
      onOpenFile,
      navigablePaths: new Set(["src/middleware/ratelimit.ts"]),
    });

    const row = screen.getByRole("button", { name: /ratelimit\.ts.*New limiter logic\./ });
    fireEvent.click(row);
    expect(onOpenFile).toHaveBeenCalledWith("src/middleware/ratelimit.ts");
  });

  it("renders rows as non-interactive text when onOpenFile is not supplied", () => {
    renderPanel({ reviewFocus: singleItem });

    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ratelimit\.ts/ })).not.toBeInTheDocument();
  });

  it("renders a row as a real button and calls back with the raw path when navigablePaths is omitted (every row with onOpenFile is navigable)", () => {
    const onOpenFile = vi.fn();
    renderPanel({ reviewFocus: singleItem, onOpenFile });

    const row = screen.getByRole("button", { name: /ratelimit\.ts.*New limiter logic\./ });
    fireEvent.click(row);
    expect(onOpenFile).toHaveBeenCalledWith("src/middleware/ratelimit.ts");
  });

  it("renders a row as static, non-interactive text — never a disabled button — when its path is outside navigablePaths, even though onOpenFile is supplied (AC-36)", () => {
    const onOpenFile = vi.fn();
    renderPanel({
      reviewFocus: singleItem,
      onOpenFile,
      navigablePaths: new Set(["some/other/file.ts"]),
    });

    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
    expect(screen.getByText("New limiter logic.")).toBeInTheDocument();
    const row = screen.queryByRole("button", { name: /ratelimit\.ts/ });
    expect(row).not.toBeInTheDocument();

    // Not merely unclickable via role query — there is no button element at
    // all to click, so onOpenFile can never fire for this path.
    fireEvent.click(screen.getByText("src/middleware/ratelimit.ts"));
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("shows a count of 0 and an honest empty message when review_focus is empty — not an error, not a fabricated path (AC-21, AC-64)", () => {
    renderPanel({ reviewFocus: [] });

    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("No files flagged for priority review.")).toBeInTheDocument();
  });

  it("escapes HTML embedded in the model's explanation text — never rendered as markup (AC-44)", () => {
    renderPanel({
      reviewFocus: [
        {
          path: "src/middleware/ratelimit.ts",
          reason: 'Fails open <img src=x onerror="alert(1)"> when Redis drops.',
          line: null,
        },
      ],
    });

    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText(/onerror/)).toBeInTheDocument();
  });
});
