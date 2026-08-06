import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
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
  useCreateSkill: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useImportSkillPreview: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useSkillStats: () => ({ data: state.stats }),
}));

import { SkillsListView } from "./SkillsListView";

const skill = (id: string, name: string, over: Partial<Skill> = {}): Skill => ({
  id,
  name,
  description: `${name} description`,
  type: "rubric",
  source: "manual",
  body: `# ${name}\n\nBe **specific**.`,
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

/** The add menu is a dropdown: open it before its entries exist in the DOM. */
function openAddMenu() {
  fireEvent.click(screen.getByText("Add Skill"));
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
  it("prompts for a selection until a card is picked", () => {
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

  it("renders a card per skill with its name, type, description and toggle", () => {
    state.skills = [skill("s1", "pr-quality-rubric", { source: "community" })];
    renderView();
    const card = screen.getByRole("button", { name: /pr-quality-rubric/ });
    expect(within(card).getByText("pr-quality-rubric")).toBeInTheDocument();
    expect(within(card).getByText("rubric")).toBeInTheDocument();
    expect(within(card).getByText("pr-quality-rubric description")).toBeInTheDocument();
    expect(within(card).getByRole("switch")).toBeInTheDocument();
    // A community import is unvetted — say so on the card.
    expect(within(card).getByText("needs vetting")).toBeInTheDocument();
  });

  it("renders one card per skill rather than a single rail", () => {
    state.skills = [skill("s1", "alpha"), skill("s2", "beta"), skill("s3", "gamma")];
    renderView();
    expect(screen.getAllByRole("switch")).toHaveLength(3);
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
});

describe("SkillsListView › side preview", () => {
  it("opens the preview beside the grid when a card is selected", () => {
    state.skills = [skill("s1", "alpha")];
    renderView();
    fireEvent.click(screen.getByText("alpha"));

    expect(screen.queryByText("Select a skill")).not.toBeInTheDocument();
    expect(screen.getByText("Rendered body")).toBeInTheDocument();
    // The body is RENDERED, not echoed: the bold run is an element.
    expect(screen.getByText("specific").tagName).toBe("STRONG");
    // …and its metadata comes along.
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
  });

  it("selects rather than navigates, and offers the editor as a link", () => {
    state.skills = [skill("s1", "alpha")];
    renderView();
    fireEvent.click(screen.getByText("alpha"));
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Open in the editor"));
    expect(push).toHaveBeenCalledWith("/skills/s1?tab=config");
  });

  it("swaps the pane when another card is selected", () => {
    state.skills = [skill("s1", "alpha"), skill("s2", "beta")];
    renderView();
    fireEvent.click(screen.getByText("alpha"));
    fireEvent.click(screen.getByText("beta"));
    // Scoped to the <aside>: both descriptions also exist on their own cards.
    const pane = within(screen.getByRole("complementary"));
    expect(pane.getByText("beta description")).toBeInTheDocument();
    expect(pane.queryByText("alpha description")).not.toBeInTheDocument();
  });

  it("toggles enabled without selecting the card", () => {
    state.skills = [skill("s1", "alpha")];
    renderView();
    fireEvent.click(screen.getByRole("switch"));
    expect(updateMutate).toHaveBeenCalledWith({ id: "s1", patch: { enabled: false } });
    expect(screen.getByText("Select a skill")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("SkillsListView › add menu", () => {
  // A populated workspace: the empty state's CTA carries the same "Import from
  // file" label, and two matches would make the assertions ambiguous.
  beforeEach(() => {
    state.skills = [skill("s1", "alpha")];
  });

  it("offers both creating and importing", () => {
    renderView();
    openAddMenu();
    expect(screen.getByText("Create from scratch")).toBeInTheDocument();
    expect(screen.getByText("Import from file")).toBeInTheDocument();
  });

  it("opens the authoring drawer from the create entry", () => {
    renderView();
    openAddMenu();
    fireEvent.click(screen.getByText("Create from scratch"));
    expect(screen.getByText("Add a skill")).toBeInTheDocument();
  });

  it("opens the import drawer from the import entry", () => {
    renderView();
    openAddMenu();
    fireEvent.click(screen.getByText("Import from file"));
    expect(screen.getByText("Import a skill")).toBeInTheDocument();
  });
});
