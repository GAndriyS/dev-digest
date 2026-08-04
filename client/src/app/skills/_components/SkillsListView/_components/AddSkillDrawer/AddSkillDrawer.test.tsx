import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";

const push = vi.fn();
const createMutateAsync = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

vi.mock("@/lib/hooks/skills", () => ({
  useCreateSkill: () => ({
    mutateAsync: createMutateAsync,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import { AddSkillDrawer } from "./AddSkillDrawer";

const CREATED: Skill = {
  id: "sk9",
  name: "PR quality rubric",
  description: "",
  type: "custom",
  source: "manual",
  body: "# PR quality rubric",
  enabled: true,
  version: 1,
};

function renderDrawer() {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <AddSkillDrawer onClose={onClose} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
  return { onClose };
}

const importButton = () => screen.getByText("Import skill").closest("button");
const bodyField = () => screen.getByPlaceholderText(/Describe the rule/);
const nameField = () => screen.getByPlaceholderText("pr-quality-rubric");

beforeEach(() => {
  push.mockReset();
  createMutateAsync.mockReset();
  createMutateAsync.mockResolvedValue(CREATED);
});
afterEach(cleanup);

describe("AddSkillDrawer", () => {
  it("cannot submit an empty form", () => {
    renderDrawer();
    expect(importButton()).toBeDisabled();
  });

  it("stays blocked when the body has no heading and no name was typed", () => {
    renderDrawer();
    fireEvent.change(bodyField(), { target: { value: "just prose" } });
    expect(importButton()).toBeDisabled();
  });

  it("derives the name from the body's first heading", async () => {
    const { onClose } = renderDrawer();
    fireEvent.change(bodyField(), { target: { value: "# PR quality rubric\n\nBe specific." } });
    expect(importButton()).not.toBeDisabled();
    fireEvent.click(importButton()!);
    await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
    expect(createMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ name: "PR quality rubric", source: "manual", enabled: true }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(push).toHaveBeenCalledWith("/skills/sk9?tab=config");
  });

  it("prefers an explicitly typed name over the heading", async () => {
    renderDrawer();
    fireEvent.change(bodyField(), { target: { value: "# Heading" } });
    fireEvent.change(nameField(), { target: { value: "typed-name" } });
    fireEvent.click(importButton()!);
    await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
    expect(createMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ name: "typed-name" }),
    );
  });

  it("warns that a pasted body is stored as data", () => {
    renderDrawer();
    expect(
      screen.getByText(
        "Pasted content is wrapped as untrusted data — never executed as instructions.",
      ),
    ).toBeInTheDocument();
  });
});
