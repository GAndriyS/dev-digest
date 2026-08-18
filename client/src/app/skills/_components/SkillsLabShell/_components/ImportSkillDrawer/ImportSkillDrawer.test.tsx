import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";
import { ApiError } from "@/lib/api";

const push = vi.fn();
const previewMutate = vi.fn();
const createMutate = vi.fn();

const state = {
  previewError: null as unknown,
  createError: null as unknown,
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

vi.mock("@/lib/hooks/skills", () => ({
  useImportSkillPreview: () => ({
    mutate: previewMutate,
    isPending: false,
    isError: state.previewError != null,
    error: state.previewError,
  }),
  useCreateSkill: () => ({
    mutate: createMutate,
    isPending: false,
    isError: state.createError != null,
    error: state.createError,
  }),
}));

import { ImportSkillDrawer } from "./ImportSkillDrawer";

const PREVIEW = {
  name: "secret-leak-rule",
  description: "Use when reviewing config changes",
  type: "security" as const,
  body: "# Secret leak\n\nBe **specific**.",
  source_files: ["SKILL.md"],
  skipped_files: ["install.sh", "assets/logo.png"],
};

const CREATED: Skill = {
  id: "sk9",
  name: PREVIEW.name,
  description: PREVIEW.description,
  type: "security",
  source: "imported_url",
  body: PREVIEW.body,
  enabled: false,
  version: 1,
};

function renderDrawer() {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <ImportSkillDrawer onClose={onClose} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
  return { onClose };
}

const filePicker = () => screen.getByLabelText("Skill file");
const saveButton = () => screen.getByText("Save skill").closest("button");

/** Pick a file and let the FileReader round-trip settle. */
async function pick(name: string, contents = "# Secret leak") {
  fireEvent.change(filePicker(), {
    target: { files: [new File([contents], name, { type: "text/markdown" })] },
  });
  await waitFor(() => expect(previewMutate).toHaveBeenCalled());
}

/** Resolve the pending preview call with a server response. */
function resolvePreview(data = PREVIEW) {
  const [, opts] = previewMutate.mock.calls.at(-1)!;
  act(() => opts.onSuccess(data));
}

beforeEach(() => {
  state.previewError = null;
  state.createError = null;
  push.mockReset();
  previewMutate.mockReset();
  createMutate.mockReset();
});
afterEach(cleanup);

describe("ImportSkillDrawer", () => {
  it("cannot save before a file has been previewed", () => {
    renderDrawer();
    expect(saveButton()).toBeDisabled();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("previews the picked file as base64 without saving anything", async () => {
    renderDrawer();
    await pick("skill.md");

    expect(previewMutate).toHaveBeenCalledWith(
      { filename: "skill.md", content_base64: btoa("# Secret leak") },
      expect.anything(),
    );
    // A preview is a dry run: nothing has been written.
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("refuses a file type the import flow does not read", async () => {
    renderDrawer();
    fireEvent.change(filePicker(), {
      target: { files: [new File(["#!/bin/sh"], "payload.sh", { type: "text/plain" })] },
    });
    await screen.findByText("Unsupported file — pick a .md, .markdown or .zip file.");
    expect(previewMutate).not.toHaveBeenCalled();
  });

  it("ignores a preview that lands after a later pick failed before starting", async () => {
    // The asymmetric path: picking a valid file after a valid one is safe,
    // because React Query drops the superseded mutation's callbacks. A pick that
    // fails on the extension never calls `mutate`, so it never supersedes
    // anything and the earlier request's onSuccess is still armed.
    renderDrawer();
    await pick("bundle.zip");
    fireEvent.change(filePicker(), {
      target: { files: [new File(["#!/bin/sh"], "payload.sh", { type: "text/plain" })] },
    });
    await screen.findByText("Unsupported file — pick a .md, .markdown or .zip file.");

    resolvePreview(); // the zip's response arrives now

    // Without the pick token this fills the form with the zip's skill while the
    // drawer shows the .sh error, and Save writes that body under this label.
    expect(screen.queryByText("Extracted skill")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("secret-leak-rule")).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("shows the extracted skill rendered, and still saves nothing", async () => {
    renderDrawer();
    await pick("bundle.zip");
    resolvePreview();

    expect(await screen.findByText("Extracted skill")).toBeInTheDocument();
    expect(screen.getByDisplayValue("secret-leak-rule")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Use when reviewing config changes")).toBeInTheDocument();
    // The body is rendered Markdown, not echoed source.
    expect(screen.getByText("specific").tagName).toBe("STRONG");
    expect(
      screen.getByText("Nothing has been saved yet. Check what was extracted, then confirm."),
    ).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("names the skipped entries and says they were never read", async () => {
    renderDrawer();
    await pick("bundle.zip");
    resolvePreview();

    expect(await screen.findByText("Skipped, never read (2)")).toBeInTheDocument();
    expect(screen.getByText("install.sh")).toBeInTheDocument();
    expect(screen.getByText("assets/logo.png")).toBeInTheDocument();
    expect(
      screen.getByText(
        "These entries are not Markdown, so the product neither read nor executed them — nothing in them can reach the skill body.",
      ),
    ).toBeInTheDocument();
  });

  it("writes the skill only once Save is pressed", async () => {
    const { onClose } = renderDrawer();
    await pick("bundle.zip");
    resolvePreview();
    await screen.findByText("Extracted skill");

    expect(createMutate).not.toHaveBeenCalled();
    fireEvent.click(saveButton()!);

    expect(createMutate).toHaveBeenCalledWith(
      {
        name: PREVIEW.name,
        description: PREVIEW.description,
        type: PREVIEW.type,
        // Imported text is not workspace-authored: the provenance must survive
        // the confirmation, or the card loses its "needs vetting" badge.
        source: "imported_url",
        body: PREVIEW.body,
        // Unvetted text must not reach a review prompt on import alone.
        enabled: false,
      },
      expect.anything(),
    );

    const [, opts] = createMutate.mock.calls.at(-1)!;
    act(() => opts.onSuccess(CREATED));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(push).toHaveBeenCalledWith("/skills/sk9?tab=config");
  });

  it("saves the corrected metadata, not the extracted metadata", async () => {
    renderDrawer();
    await pick("skill.md");
    resolvePreview();
    await screen.findByText("Extracted skill");

    fireEvent.change(screen.getByDisplayValue("secret-leak-rule"), {
      target: { value: "renamed-rule" },
    });
    fireEvent.click(saveButton()!);
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "renamed-rule" }),
      expect.anything(),
    );
  });

  it("discards everything on Cancel", async () => {
    const { onClose } = renderDrawer();
    await pick("skill.md");
    resolvePreview();
    await screen.findByText("Extracted skill");

    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("degrades to the error state when the endpoint is not there yet", async () => {
    state.previewError = new ApiError("Not Found", 404);
    renderDrawer();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not extract a skill from that file. — Not Found",
    );
    expect(saveButton()).toBeDisabled();
  });

  it("explains that the description is the skill's interface", async () => {
    renderDrawer();
    await pick("skill.md");
    resolvePreview();
    expect(await screen.findByText(/only thing an agent reads/)).toBeInTheDocument();
  });
});
