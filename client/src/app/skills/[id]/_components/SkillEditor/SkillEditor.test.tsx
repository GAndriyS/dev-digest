import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";

const replace = vi.fn();
let searchParams = new URLSearchParams("tab=config");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => searchParams,
  useParams: () => ({ id: "sk1" }),
}));

const idle = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null };

vi.mock("@/lib/hooks/skills", () => ({
  useSkill: () => idle,
  useSkills: () => ({ ...idle, data: [] }),
  useUpdateSkill: () => mutation,
  useDeleteSkill: () => mutation,
  useSkillVersions: () => ({ ...idle, data: [] }),
  useSkillVersion: () => idle,
  useRestoreSkillVersion: () => mutation,
  useSkillStats: () => idle,
  useSkillAgents: () => idle,
  useSkillEvalCases: () => ({ ...idle, data: [] }),
  useCreateEvalCase: () => mutation,
  useUpdateEvalCase: () => mutation,
  useDeleteEvalCase: () => mutation,
  useRunEvalCase: () => mutation,
  useRunAllEvals: () => mutation,
}));

import { SkillEditor } from "./SkillEditor";

afterEach(() => {
  cleanup();
  searchParams = new URLSearchParams("tab=config");
});

const SKILL: Skill = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "Overall PR quality rubric",
  type: "rubric",
  source: "manual",
  body: "# Rubric\n\nBe **specific**.",
  enabled: true,
  version: 3,
};

function renderEditor() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <SkillEditor skill={SKILL} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("SkillEditor (tab shell)", () => {
  it("renders all five tabs and opens Config by default", () => {
    renderEditor();
    for (const label of ["Config", "Preview", "Evals", "Stats", "Versions"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByDisplayValue("pr-quality-rubric")).toBeInTheDocument();
  });

  it("writes the chosen tab into ?tab=", () => {
    renderEditor();
    fireEvent.click(screen.getByText("Versions"));
    expect(replace).toHaveBeenCalledWith("/skills/sk1?tab=versions");
  });

  it("falls back to Config when ?tab= is not a real tab", () => {
    searchParams = new URLSearchParams("tab=bogus");
    renderEditor();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
  });

  it("renders the body as Markdown on the Preview tab", () => {
    searchParams = new URLSearchParams("tab=preview");
    renderEditor();
    expect(screen.getByText("Rendered body")).toBeInTheDocument();
    // Rendered, not echoed: the bold run is an element, not literal asterisks.
    expect(screen.getByText("specific").tagName).toBe("STRONG");
  });
});

describe("SkillEditor › ConfigTab", () => {
  it("keeps Save disabled until something actually changed", () => {
    renderEditor();
    const save = screen.getByText("Save").closest("button");
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByDisplayValue("pr-quality-rubric"), {
      target: { value: "renamed" },
    });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByText("Save").closest("button")).not.toBeDisabled();
  });

  it("captions the description as the skill's interface", () => {
    renderEditor();
    expect(screen.getByText(/only thing an agent reads/)).toBeInTheDocument();
  });

  it("says a body edit mints a new version", () => {
    renderEditor();
    expect(
      screen.getByText("Saving a changed body creates a new immutable version."),
    ).toBeInTheDocument();
  });
});
