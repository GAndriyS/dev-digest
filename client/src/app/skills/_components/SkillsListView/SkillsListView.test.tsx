import type { ComponentProps } from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillStats } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";

const updateMutate = vi.fn();

const state = {
  stats: null as SkillStats | null,
};

vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: updateMutate, isPending: false }),
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

function renderList(props: Partial<ComponentProps<typeof SkillsListView>> = {}) {
  const onRetry = vi.fn();
  const onSelect = vi.fn();
  const onImportCta = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillsListView
        skills={[]}
        isLoading={false}
        isError={false}
        onRetry={onRetry}
        search=""
        selectedId={null}
        onSelect={onSelect}
        onImportCta={onImportCta}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onRetry, onSelect, onImportCta };
}

beforeEach(() => {
  state.stats = null;
  updateMutate.mockReset();
});
afterEach(cleanup);

describe("SkillsListView", () => {
  it("offers an import CTA when the workspace has no skills", () => {
    const { onImportCta } = renderList();
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Import from file"));
    expect(onImportCta).toHaveBeenCalled();
  });

  it("shows loading skeletons while the list is in flight", () => {
    renderList({ isLoading: true, skills: [] });
    expect(screen.queryByText("No skills yet")).not.toBeInTheDocument();
  });

  it("surfaces a load failure with a retry", () => {
    const { onRetry } = renderList({ isError: true });
    expect(screen.getByText("Could not load skills.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("renders a card per skill with its name, type, description and toggle", () => {
    renderList({ skills: [skill("s1", "pr-quality-rubric", { source: "community" })] });
    const card = screen.getByRole("button", { name: /pr-quality-rubric/ });
    expect(within(card).getByText("pr-quality-rubric")).toBeInTheDocument();
    expect(within(card).getByText("rubric")).toBeInTheDocument();
    expect(within(card).getByText("pr-quality-rubric description")).toBeInTheDocument();
    expect(within(card).getByRole("switch")).toBeInTheDocument();
    expect(within(card).getByText("needs vetting")).toBeInTheDocument();
  });

  it("renders one card per skill rather than a single rail", () => {
    renderList({ skills: [skill("s1", "alpha"), skill("s2", "beta"), skill("s3", "gamma")] });
    expect(screen.getAllByRole("switch")).toHaveLength(3);
  });

  it("marks the selected card active via the selectedId prop", () => {
    renderList({ skills: [skill("s1", "alpha"), skill("s2", "beta")], selectedId: "s2" });
    expect(screen.getByRole("button", { name: /beta/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /alpha/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onSelect rather than navigating itself", () => {
    const { onSelect } = renderList({ skills: [skill("s1", "alpha")] });
    fireEvent.click(screen.getByText("alpha"));
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("toggles enabled without selecting the card", () => {
    const { onSelect } = renderList({ skills: [skill("s1", "alpha")] });
    fireEvent.click(screen.getByRole("switch"));
    expect(updateMutate).toHaveBeenCalledWith({ id: "s1", patch: { enabled: false } });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders the usage line once stats arrive", () => {
    state.stats = {
      used_by: [{ agent_id: "a1", agent_name: "A", order: 0, agent_enabled: true }],
      pull_count_30d: 3,
      runs_total: 4,
      findings_30d: 9,
      accept_rate: 0.5,
      findings_by_category: [],
    };
    renderList({ skills: [skill("s1", "pr-quality-rubric")] });
    expect(screen.getByText("1 agents · 75% pull · 50% accept")).toBeInTheDocument();
  });

  it("filters on the search prop and says so when nothing matches", () => {
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <SkillsListView
          skills={[skill("s1", "alpha"), skill("s2", "beta")]}
          isLoading={false}
          isError={false}
          onRetry={vi.fn()}
          search="alph"
          selectedId={null}
          onSelect={vi.fn()}
          onImportCta={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <SkillsListView
          skills={[skill("s1", "alpha"), skill("s2", "beta")]}
          isLoading={false}
          isError={false}
          onRetry={vi.fn()}
          search="zzz"
          selectedId={null}
          onSelect={vi.fn()}
          onImportCta={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("No matching skills")).toBeInTheDocument();
  });
});
