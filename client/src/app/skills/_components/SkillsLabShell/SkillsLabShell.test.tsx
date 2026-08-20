import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";
import { SkillSelectPrompt } from "../SkillSelectPrompt";
import { useRegisterSkillDirty } from "../SkillDirtyGate";

let pathname = "/skills";
let searchParams = new URLSearchParams();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
  useRouter: () => ({ push, replace: vi.fn() }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children, crumb }: { children: React.ReactNode; crumb?: { label: string }[] }) => (
    <div>
      <nav aria-label="crumb">{crumb?.map((c) => c.label).join(" / ")}</nav>
      {children}
    </div>
  ),
}));

const state = {
  skills: [] as Skill[],
  isLoading: false,
  isError: false,
};
const updateMutate = vi.fn();
const refetch = vi.fn();

vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({
    data: state.skills,
    isLoading: state.isLoading,
    isError: state.isError,
    refetch,
  }),
  useUpdateSkill: () => ({ mutate: updateMutate, isPending: false }),
  useSkillStats: () => ({ data: undefined }),
  useCreateSkill: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  useImportSkillPreview: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
}));

import { SkillsLabShell } from "./SkillsLabShell";

const skill = (id: string, name: string, over: Partial<Skill> = {}): Skill => ({
  id,
  name,
  description: `${name} description`,
  type: "rubric",
  source: "manual",
  body: `# ${name}`,
  enabled: true,
  version: 1,
  ...over,
});

// Stands in for ConfigTab (AC-7): registers `dirty` through the same seam,
// several route segments closer than the real tree, without pulling in the
// whole SkillEditor and its own mocks.
function DirtyStub({ dirty }: { dirty: boolean }) {
  useRegisterSkillDirty(dirty);
  return <div>DETAIL</div>;
}

function tree(children: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <SkillsLabShell>{children}</SkillsLabShell>
      </ToastProvider>
    </NextIntlClientProvider>
  );
}

function renderShell(children: React.ReactNode = <div>CHILD</div>) {
  return render(tree(children));
}

function stubNarrow(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  );
}

beforeEach(() => {
  pathname = "/skills";
  searchParams = new URLSearchParams();
  state.skills = [];
  state.isLoading = false;
  state.isError = false;
  push.mockReset();
  updateMutate.mockReset();
  refetch.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SkillsLabShell", () => {
  it("renders the list beside whatever the route hands it as children", () => {
    state.skills = [skill("s1", "alpha")];
    renderShell();
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("CHILD")).toBeInTheDocument();
  });

  it("prompts for a selection until a card is picked", () => {
    state.skills = [skill("s1", "alpha")];
    renderShell(<SkillSelectPrompt />);
    expect(screen.getByText("Select a skill")).toBeInTheDocument();
  });

  it("offers an import CTA when the workspace has no skills", () => {
    renderShell();
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
  });

  it("surfaces a load failure with a retry", () => {
    state.isError = true;
    renderShell();
    expect(screen.getByText("Could not load skills.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Retry"));
    expect(refetch).toHaveBeenCalled();
  });

  it("selects with a single navigation to /skills/:id?tab=<default tab>", () => {
    state.skills = [skill("s1", "alpha")];
    renderShell();
    fireEvent.click(screen.getByText("alpha"));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/skills/s1?tab=config");
  });

  it("carries the current tab — including one this build does not render yet — to the next skill", () => {
    pathname = "/skills/s1";
    searchParams = new URLSearchParams("tab=context");
    state.skills = [skill("s1", "alpha"), skill("s2", "beta")];
    renderShell();
    fireEvent.click(screen.getByText("beta"));
    expect(push).toHaveBeenCalledWith("/skills/s2?tab=context");
  });

  it("puts the selected skill's name in the breadcrumb, from the already-loaded list", () => {
    pathname = "/skills/s1";
    state.skills = [skill("s1", "pr-quality-rubric")];
    renderShell();
    expect(screen.getByText("Skills Lab / Skills / pr-quality-rubric")).toBeInTheDocument();
  });

  it("does not redirect a :id that never appeared in the list — that is the 404 branch's job", () => {
    pathname = "/skills/never-existed";
    state.skills = [skill("s1", "alpha")];
    renderShell(<div>NOT FOUND CONTENT</div>);
    expect(push).not.toHaveBeenCalledWith("/skills");
  });

  it("returns to /skills once the selected skill drops out of the list (AC-6)", () => {
    pathname = "/skills/s1";
    state.skills = [skill("s1", "alpha")];
    const { rerender } = renderShell(<div>DETAIL</div>);
    expect(push).not.toHaveBeenCalled();

    state.skills = [];
    rerender(tree(<div>DETAIL</div>));
    expect(push).toHaveBeenCalledWith("/skills");
  });

  it("keeps the current selection and tab while the search box is used", () => {
    pathname = "/skills/s1";
    searchParams = new URLSearchParams("tab=config");
    state.skills = [skill("s1", "alpha"), skill("s2", "beta")];
    renderShell();

    fireEvent.change(screen.getByPlaceholderText("Search skills…"), { target: { value: "beta" } });
    expect(screen.queryByText("alpha")).not.toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("beta"));
    expect(push).toHaveBeenCalledWith("/skills/s2?tab=config");
  });

  it("never offers the retired local preview action", () => {
    state.skills = [skill("s1", "alpha")];
    renderShell();
    expect(screen.queryByText("Open in the editor")).not.toBeInTheDocument();
  });

  describe("narrow viewport (AC-26)", () => {
    it("shows only the list when nothing is selected", () => {
      stubNarrow(true);
      state.skills = [skill("s1", "alpha")];
      renderShell(<div>DETAIL</div>);
      expect(screen.getByText("alpha")).toBeInTheDocument();
      expect(screen.queryByText("DETAIL")).not.toBeInTheDocument();
    });

    it("shows only the detail column with an explicit way back once a skill is selected", () => {
      stubNarrow(true);
      pathname = "/skills/s1";
      state.skills = [skill("s1", "alpha")];
      renderShell(<div>DETAIL</div>);
      expect(screen.queryByText("alpha")).not.toBeInTheDocument();
      expect(screen.getByText("DETAIL")).toBeInTheDocument();

      fireEvent.click(screen.getByText("← All skills"));
      expect(push).toHaveBeenCalledWith("/skills");
    });

    it("shows both columns at a wide viewport even with a skill selected", () => {
      stubNarrow(false);
      pathname = "/skills/s1";
      state.skills = [skill("s1", "alpha")];
      renderShell(<div>DETAIL</div>);
      expect(screen.getByText("alpha")).toBeInTheDocument();
      expect(screen.getByText("DETAIL")).toBeInTheDocument();
      expect(screen.queryByText("← All skills")).not.toBeInTheDocument();
    });
  });

  describe("unsaved-changes gate (AC-7)", () => {
    it("switches straight through when nothing is registered as dirty", () => {
      pathname = "/skills/s1";
      state.skills = [skill("s1", "alpha"), skill("s2", "beta")];
      renderShell(<DirtyStub dirty={false} />);

      fireEvent.click(screen.getByText("beta"));
      expect(push).toHaveBeenCalledWith("/skills/s2?tab=config");
      expect(screen.queryByText("Discard unsaved changes?")).not.toBeInTheDocument();
    });

    it("asks before switching skill while the editor is dirty, and switches on Discard", () => {
      pathname = "/skills/s1";
      state.skills = [skill("s1", "alpha"), skill("s2", "beta")];
      renderShell(<DirtyStub dirty={true} />);

      fireEvent.click(screen.getByText("beta"));
      expect(push).not.toHaveBeenCalled();
      expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Discard changes"));
      expect(push).toHaveBeenCalledWith("/skills/s2?tab=config");
    });

    it("leaves the current skill selected and drops the dialog on Cancel", () => {
      pathname = "/skills/s1";
      state.skills = [skill("s1", "alpha"), skill("s2", "beta")];
      renderShell(<DirtyStub dirty={true} />);

      fireEvent.click(screen.getByText("beta"));
      fireEvent.click(screen.getByText("Cancel"));
      expect(push).not.toHaveBeenCalled();
      expect(screen.queryByText("Discard unsaved changes?")).not.toBeInTheDocument();
    });

    it("never asks for a click on the already-selected skill", () => {
      pathname = "/skills/s1";
      state.skills = [skill("s1", "alpha")];
      renderShell(<DirtyStub dirty={true} />);

      fireEvent.click(screen.getByText("alpha"));
      expect(push).not.toHaveBeenCalled();
      expect(screen.queryByText("Discard unsaved changes?")).not.toBeInTheDocument();
    });
  });
});
