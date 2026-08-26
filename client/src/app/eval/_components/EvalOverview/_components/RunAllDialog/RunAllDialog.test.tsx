import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import evalMessages from "../../../../../../../messages/en/eval.json";
import { RunAllDialog } from "./RunAllDialog";

function renderDialog(props: {
  agentsCount: number;
  casesTotal: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <RunAllDialog {...props} />
    </NextIntlClientProvider>
  );
}

afterEach(() => cleanup());

describe("RunAllDialog", () => {
  it("names the agent count and total case count from props before anything runs, and Confirm starts the run (AC-46)", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderDialog({ agentsCount: 3, casesTotal: 42, onConfirm, onCancel });

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(evalMessages.runAllAgents.dialogTitle);
    // ICU plural resolved from props, not a literal template — both counts
    // must land before the run can be confirmed.
    expect(dialog).toHaveTextContent("3 agents");
    expect(dialog).toHaveTextContent("42 eval cases");

    fireEvent.click(screen.getByRole("button", { name: evalMessages.runAllAgents.confirm }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("closes on Cancel, overlay click and Escape, and never calls onConfirm on any of them (AC-48)", () => {
    // Cancel button.
    const onConfirmCancel = vi.fn();
    const onCancelCancel = vi.fn();
    renderDialog({ agentsCount: 1, casesTotal: 1, onConfirm: onConfirmCancel, onCancel: onCancelCancel });
    fireEvent.click(screen.getByRole("button", { name: evalMessages.runAllAgents.cancel }));
    expect(onCancelCancel).toHaveBeenCalledTimes(1);
    expect(onConfirmCancel).not.toHaveBeenCalled();
    cleanup();

    // Overlay click — the vendored Modal's own `onClose` wiring.
    const onConfirmOverlay = vi.fn();
    const onCancelOverlay = vi.fn();
    renderDialog({ agentsCount: 1, casesTotal: 1, onConfirm: onConfirmOverlay, onCancel: onCancelOverlay });
    const overlay = screen.getByRole("dialog").previousElementSibling as HTMLElement;
    fireEvent.click(overlay);
    expect(onCancelOverlay).toHaveBeenCalledTimes(1);
    expect(onConfirmOverlay).not.toHaveBeenCalled();
    cleanup();

    // Escape — the vendored Modal has no handler of its own; this dialog's
    // own `keydown` listener is what must fire here.
    const onConfirmEscape = vi.fn();
    const onCancelEscape = vi.fn();
    renderDialog({ agentsCount: 1, casesTotal: 1, onConfirm: onConfirmEscape, onCancel: onCancelEscape });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancelEscape).toHaveBeenCalledTimes(1);
    expect(onConfirmEscape).not.toHaveBeenCalled();
  });
});
