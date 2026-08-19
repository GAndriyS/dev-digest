import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";
import contextMessages from "../../../../../../messages/en/context.json";
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

// ConfigTab's "Project context to use" section (AC-15) mounts the shared
// ContextDocPicker, which needs these — stub them so the tab shell tests stay
// free of a real QueryClientProvider.
vi.mock("@/lib/hooks/core", () => ({
  useContextFiles: () => ({
    data: {
      files: [{ path: "specs/SPEC-01.md", root: "specs", tokens_est: 50 }],
      total: 1,
      truncated: false,
      roots: ["specs"],
      scanned_at: "2026-08-18T00:00:00Z",
    },
    isLoading: false,
    isError: false,
  }),
  useOwnerContext: () => ({ data: { paths: [] }, isLoading: false, isError: false }),
  useSetOwnerContext: () => mutation,
  useContextDoc: () => idle,
}));

// ContextTab (AC-14) needs to tell "no repo picked yet" (reposLoaded=false)
// apart from "no active repository" (reposLoaded=true, repoId=null) — a
// per-test mutable stub, same shape as the default context in repo-context.tsx.
const activeRepo = { repoId: null as string | null, reposLoaded: false };
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => activeRepo,
}));

import { SkillEditor } from "./SkillEditor";

afterEach(() => {
  cleanup();
  searchParams = new URLSearchParams("tab=config");
  activeRepo.repoId = null;
  activeRepo.reposLoaded = false;
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
    <NextIntlClientProvider locale="en" messages={{ skills: messages, context: contextMessages }}>
      <ToastProvider>
        <SkillEditor skill={SKILL} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("SkillEditor (tab shell)", () => {
  it("renders all six tabs and opens Config by default", () => {
    renderEditor();
    for (const label of ["Config", "Context", "Preview", "Evals", "Stats", "Versions"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByDisplayValue("pr-quality-rubric")).toBeInTheDocument();
    // AC-13: the picker moved to its own tab, so Config no longer shows it.
    expect(screen.queryByText("Project context to use")).not.toBeInTheDocument();
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

  it("shows a deterministic token estimate next to the body field that updates as it is edited (AC-19)", () => {
    renderEditor();
    // SKILL.body is 26 chars → ceil(26/4) = 7.
    expect(screen.getByText("≈ 7 tokens")).toBeInTheDocument();
    // getByDisplayValue's built-in whitespace normalizer collapses the
    // body's "\n\n" before matching, so a multi-line exact string never
    // matches — a regex sidesteps that, matching against the normalized text.
    fireEvent.change(screen.getByDisplayValue(/specific/), { target: { value: "12345678" } });
    expect(screen.getByText("≈ 2 tokens")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("estimates an empty body as ≈ 0 tokens, not 1", () => {
    renderEditor();
    fireEvent.change(screen.getByDisplayValue(/specific/), { target: { value: "" } });
    expect(screen.getByText("≈ 0 tokens")).toBeInTheDocument();
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

describe("SkillEditor › AC-7 unsaved-changes gate", () => {
  // L05 step 6's default: tabs stay mounted within one selected skill, so an
  // edit in Config is not lost by a trip to another tab — the pane is hidden
  // (display: none), never unmounted, while another tab is active.
  it("keeps an edited Config field across a switch to another tab and back", () => {
    const { rerender } = renderEditor();
    fireEvent.change(screen.getByDisplayValue("pr-quality-rubric"), {
      target: { value: "renamed" },
    });
    expect(screen.getByDisplayValue("renamed")).toBeInTheDocument();

    searchParams = new URLSearchParams("tab=preview");
    rerender(
      <NextIntlClientProvider locale="en" messages={{ skills: messages, context: contextMessages }}>
        <ToastProvider>
          <SkillEditor skill={SKILL} />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Rendered body")).toBeInTheDocument();
    // Still in the DOM (registered for AC-7), just not the active tab.
    expect(screen.getByDisplayValue("renamed")).not.toBeVisible();

    searchParams = new URLSearchParams("tab=config");
    rerender(
      <NextIntlClientProvider locale="en" messages={{ skills: messages, context: contextMessages }}>
        <ToastProvider>
          <SkillEditor skill={SKILL} />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByDisplayValue("renamed")).toBeVisible();
  });
});

describe("SkillEditor › ContextTab", () => {
  it("mounts the same picker, title and hint the Config tab used to carry (AC-12, AC-15)", () => {
    searchParams = new URLSearchParams("tab=context");
    renderEditor();
    expect(screen.getByText("Project context to use")).toBeInTheDocument();
    expect(
      screen.getByText("Any agent using this skill inherits these documents."),
    ).toBeInTheDocument();
  });

  it("falls back to the picker's own empty state, not the no-repo one, while repos are still loading", () => {
    searchParams = new URLSearchParams("tab=context");
    // activeRepo.reposLoaded is false by default (see afterEach) — mirrors
    // repo-context.tsx's own default context value before repos resolve.
    renderEditor();
    expect(screen.queryByText("No repository selected")).not.toBeInTheDocument();
  });

  it("explains there is no active repository once repos have loaded and none is selected (AC-14)", () => {
    searchParams = new URLSearchParams("tab=context");
    activeRepo.reposLoaded = true;
    activeRepo.repoId = null;
    renderEditor();
    expect(screen.getByText("No repository selected")).toBeInTheDocument();
    expect(
      screen.getByText("Pick a repository to browse and attach its context documents."),
    ).toBeInTheDocument();
  });
});
