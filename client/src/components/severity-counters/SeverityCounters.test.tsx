import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/prReview.json";
import { SeverityCounters } from "./SeverityCounters";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SeverityCounters", () => {
  it("hides severities with no findings", () => {
    renderWithIntl(
      <SeverityCounters counts={{ critical: 2, warning: 0, suggestion: 3 }} onSelect={() => {}} />,
    );
    expect(screen.getByLabelText("2 critical")).toBeInTheDocument();
    expect(screen.getByLabelText("3 suggestion")).toBeInTheDocument();
    expect(screen.queryByLabelText(/warning/)).not.toBeInTheDocument();
  });

  it("renders nothing when every count is zero", () => {
    const { container } = renderWithIntl(
      <SeverityCounters counts={{ critical: 0, warning: 0, suggestion: 0 }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("selects a severity without bubbling to the surrounding row", () => {
    const onSelect = vi.fn();
    const onRowClick = vi.fn();
    renderWithIntl(
      <div onClick={onRowClick}>
        <SeverityCounters counts={{ critical: 1, warning: 1, suggestion: 0 }} onSelect={onSelect} />
      </div>,
    );
    fireEvent.click(screen.getByLabelText("1 warning"));
    expect(onSelect).toHaveBeenCalledWith("WARNING");
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("marks the active severity pressed and dims the others", () => {
    renderWithIntl(
      <SeverityCounters
        counts={{ critical: 1, warning: 2, suggestion: 0 }}
        active="CRITICAL"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByLabelText("1 critical")).toHaveAttribute("aria-pressed", "true");
    const warning = screen.getByLabelText("2 warning");
    expect(warning).toHaveAttribute("aria-pressed", "false");
    expect(warning.style.opacity).toBe("0.4");
  });

  it("is inert (no aria-pressed, disabled) without onSelect", () => {
    renderWithIntl(<SeverityCounters counts={{ critical: 1, warning: 0, suggestion: 0 }} />);
    const chip = screen.getByLabelText("1 critical");
    expect(chip).toBeDisabled();
    expect(chip).not.toHaveAttribute("aria-pressed");
  });
});
