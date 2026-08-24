import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillStats, SkillUsage } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";

const state = {
  stats: null as SkillStats | null,
  agents: [] as SkillUsage[],
  isError: false,
};

vi.mock("@/lib/hooks/skills", () => ({
  useSkillStats: () => ({
    data: state.stats ?? undefined,
    isLoading: false,
    isError: state.isError,
    refetch: vi.fn(),
  }),
  useSkillAgents: () => ({ data: state.agents }),
}));

import { StatsTab } from "./StatsTab";

const SKILL: Skill = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "",
  type: "rubric",
  source: "manual",
  body: "# Rubric",
  enabled: true,
  version: 1,
};

const STATS: SkillStats = {
  used_by: [{ agent_id: "a1", agent_name: "Security Reviewer", order: 2, agent_enabled: false }],
  pull_count_30d: 7,
  runs_total: 10,
  findings_30d: 12,
  accept_rate: 0.75,
  findings_by_category: [{ category: "security", count: 8 }],
};

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <StatsTab skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.stats = STATS;
  state.agents = STATS.used_by;
  state.isError = false;
});
afterEach(cleanup);

describe("StatsTab", () => {
  it("shows the five KPI tiles", () => {
    renderTab();
    expect(screen.getByText("USED BY")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    // AC-22: pull_count_30d=7 / runs_total=10 → 70%, the same pullFrequency()
    // formula the list card's usage line reads.
    expect(screen.getByText("PULL FREQUENCY")).toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("reads runs_total = 0 as a 0% pull-frequency tile, not a division by zero", () => {
    state.stats = { ...STATS, pull_count_30d: 3, runs_total: 0 };
    renderTab();
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("renders a placeholder rather than 0% when nothing was triaged", () => {
    state.stats = { ...STATS, accept_rate: null };
    renderTab();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("lists the agents that link the skill, with their prompt position", () => {
    renderTab();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("position 2")).toBeInTheDocument();
    expect(screen.getByText("disabled")).toBeInTheDocument();
  });

  it("links each agent row to its own editor, opened on the Skills tab (AC-21)", () => {
    renderTab();
    const open = screen.getByText("Open").closest("a");
    expect(open).toHaveAttribute("href", "/agents/a1?tab=skills");
  });

  it("says the finding attribution is run-level, not per-finding", () => {
    renderTab();
    expect(screen.getByText(/Attribution is run-level/)).toBeInTheDocument();
    expect(screen.getByText("security")).toBeInTheDocument();
  });

  it("says so when nothing is linked or recorded", () => {
    state.stats = {
      used_by: [],
      pull_count_30d: 0,
      runs_total: 0,
      findings_30d: 0,
      accept_rate: null,
      findings_by_category: [],
    };
    state.agents = [];
    renderTab();
    expect(screen.getByText("No agent has this skill linked yet.")).toBeInTheDocument();
    expect(screen.getByText("No findings recorded in the last 30 days.")).toBeInTheDocument();
    expect(screen.queryByText("Open")).not.toBeInTheDocument();
  });

  it("surfaces a load failure with a retry", () => {
    state.stats = null;
    state.isError = true;
    renderTab();
    expect(screen.getByText("Could not load skill stats.")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });
});
