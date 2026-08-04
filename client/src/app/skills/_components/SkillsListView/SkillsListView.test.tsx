import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillStats } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";

const push = vi.fn();
const updateMutate = vi.fn();

const state = {
  skills: [] as Skill[],
  isError: false,
  stats: null as SkillStats | null,
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// The app chrome is not what this view is about; render its children only.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({
    data: state.skills,
    isLoading: false,
    isError: state.isError,
    refetch: vi.fn(),
  }),
  useUpdateSkill: () => ({ mutate: updateMutate, isPending: false }),
  useCreateSkill: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  useSkillStats: () => ({ data: state.stats }),
}));

import { SkillsListView } from "./SkillsListView";

const skill = (id: string, name: string, over: Partial<Skill> = {}): Skill => ({
  id,
  name,
  description: `${name} description`,
  type: "rubric",
  source: "manual",
  body: "# body",
  enabled: true,
  version: 1,
  ...over,
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <SkillsListView />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.skills = [];
  state.isError = false;
  state.stats = null;
  push.mockReset();
  updateMutate.mockReset();
});
afterEach(cleanup);

describe("SkillsListView", () => {
  it("prompts for a selection in the detail pane", () => {
    renderView();
    expect(screen.getByText("Select a skill")).toBeInTheDocument();
  });

  it("offers an import CTA when the workspace has no skills", () => {
    renderView();
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
  });

  it("surfaces a load failure with a retry", () => {
    state.isError = true;
    renderView();
    expect(screen.getByText("Could not load skills.")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("lists skills with their type and source badges", () => {
    state.skills = [skill("s1", "pr-quality-rubric", { source: "community" })];
    renderView();
    expect(screen.getByText("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("Community")).toBeInTheDocument();
    // A community import is unvetted — say so on the card.
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
  });

  it("renders the usage line once stats arrive", () => {
    state.skills = [skill("s1", "pr-quality-rubric")];
    state.stats = {
      used_by: [{ agent_id: "a1", agent_name: "A", order: 0, agent_enabled: true }],
      pull_count_30d: 3,
      runs_total: 4,
      findings_30d: 9,
      accept_rate: 0.5,
      findings_by_category: [],
    };
    renderView();
    expect(screen.getByText("1 agents · 75% pull · 50% accept")).toBeInTheDocument();
  });

  it("filters on search and says so when nothing matches", () => {
    state.skills = [skill("s1", "alpha"), skill("s2", "beta")];
    renderView();
    const search = screen.getByPlaceholderText("Search skills…");
    fireEvent.change(search, { target: { value: "alph" } });
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No matching skills")).toBeInTheDocument();
  });

  it("opens the editor on the Config tab when a card is clicked", () => {
    state.skills = [skill("s1", "alpha")];
    renderView();
    fireEvent.click(screen.getByText("alpha"));
    expect(push).toHaveBeenCalledWith("/skills/s1?tab=config");
  });

  it("toggles enabled without navigating", () => {
    state.skills = [skill("s1", "alpha")];
    renderView();
    fireEvent.click(screen.getByRole("switch"));
    expect(updateMutate).toHaveBeenCalledWith({ id: "s1", patch: { enabled: false } });
    expect(push).not.toHaveBeenCalled();
  });

  it("opens the add drawer", () => {
    renderView();
    fireEvent.click(screen.getByText("Add Skill"));
    expect(screen.getByText("Add a skill")).toBeInTheDocument();
  });
});
