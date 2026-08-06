import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentSkillLink, Skill } from "@devdigest/shared";
import messages from "../../../messages/en/agents.json";

const setSkillsMutate = vi.fn();
const state = {
  skills: [] as Skill[],
  links: [] as AgentSkillLink[],
};

vi.mock("../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: state.skills, isLoading: false, isError: false }),
  useAgentSkills: () => ({ data: state.links, isLoading: false, isError: false }),
  useSetAgentSkills: () => ({ mutate: setSkillsMutate, isPending: false }),
}));

import { AgentSkillPicker } from "./AgentSkillPicker";

const skill = (id: string, name: string, description = ""): Skill => ({
  id,
  name,
  description,
  type: "custom",
  source: "manual",
  body: "…",
  enabled: true,
  version: 1,
});

const CATALOG = [
  skill("s1", "pr-quality-rubric", "Overall PR quality rubric."),
  skill("s2", "secret-leakage-gate", "Detects leaked credentials."),
  skill("s3", "no-then-chains", "Prefer async/await."),
];

function renderPicker() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <AgentSkillPicker agentId="ag1" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  setSkillsMutate.mockClear();
  state.skills = CATALOG;
  state.links = [
    { agent_id: "ag1", skill_id: "s1", order: 0 },
    { agent_id: "ag1", skill_id: "s2", order: 1 },
  ];
});
afterEach(cleanup);

/** The linked list is rendered first; read its rows in DOM order. */
function linkedList(): HTMLElement {
  return screen.getAllByRole("list")[0]!;
}

function linkedNames(): string[] {
  return within(linkedList())
    .getAllByRole("listitem")
    .map((li) => li.getAttribute("data-skill") ?? "");
}

describe("AgentSkillPicker", () => {
  it("summarises how many of the catalog's skills are attached", () => {
    renderPicker();
    expect(screen.getByText("2 of 3 enabled")).toBeInTheDocument();
  });

  it("shows linked skills in prompt order, numbered, with the rest available", () => {
    renderPicker();
    expect(linkedNames()).toEqual(["pr-quality-rubric", "secret-leakage-gate"]);
    expect(screen.getByText("In this agent's prompt")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("attaches an unlinked skill at the end of the prompt order", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("checkbox", { name: "no-then-chains" }));
    expect(setSkillsMutate).toHaveBeenCalledWith(
      { agentId: "ag1", skill_ids: ["s1", "s2", "s3"] },
      expect.anything(),
    );
  });

  it("detaches a linked skill", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("checkbox", { name: "pr-quality-rubric" }));
    expect(setSkillsMutate).toHaveBeenCalledWith(
      { agentId: "ag1", skill_ids: ["s2"] },
      expect.anything(),
    );
  });

  it("reorders with the arrow buttons and shows the new order immediately", () => {
    renderPicker();
    fireEvent.click(screen.getByLabelText("Move secret-leakage-gate earlier in the prompt"));
    expect(setSkillsMutate).toHaveBeenCalledWith(
      { agentId: "ag1", skill_ids: ["s2", "s1"] },
      expect.anything(),
    );
    // Optimistic: the list re-renders from the draft, not from a refetch.
    expect(linkedNames()).toEqual(["secret-leakage-gate", "pr-quality-rubric"]);
  });

  it("rolls back to the server order when the write fails", () => {
    renderPicker();
    fireEvent.click(screen.getByLabelText("Move secret-leakage-gate earlier in the prompt"));
    expect(linkedNames()).toEqual(["secret-leakage-gate", "pr-quality-rubric"]);
    // The hook would call this from the mutation's error path; here it is
    // invoked directly, so the state update needs its own act().
    const options = setSkillsMutate.mock.calls[0]![1] as { onError: () => void };
    act(() => options.onError());
    expect(linkedNames()).toEqual(["pr-quality-rubric", "secret-leakage-gate"]);
  });

  it("filters both sections without renumbering the prompt", () => {
    renderPicker();
    fireEvent.change(screen.getByPlaceholderText("Filter skills…"), {
      target: { value: "secret" },
    });
    expect(screen.getByText("secret-leakage-gate")).toBeInTheDocument();
    expect(screen.queryByText("no-then-chains")).not.toBeInTheDocument();
    // Still position 2 in the full order, even though it is the only row shown.
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("reorders on drop", () => {
    renderPicker();
    const rows = within(linkedList()).getAllByRole("listitem");
    const [first, second] = [rows[0]!, rows[1]!];
    const dataTransfer = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
    fireEvent.dragStart(second, { dataTransfer });
    fireEvent.dragOver(first, { dataTransfer });
    fireEvent.drop(first, { dataTransfer });
    expect(setSkillsMutate).toHaveBeenCalledWith(
      { agentId: "ag1", skill_ids: ["s2", "s1"] },
      expect.anything(),
    );
  });

  it("tells the user when nothing matches the filter", () => {
    renderPicker();
    fireEvent.change(screen.getByPlaceholderText("Filter skills…"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No skills match “zzz”.")).toBeInTheDocument();
  });

  it("explains an empty catalog instead of rendering an empty list", () => {
    state.skills = [];
    state.links = [];
    renderPicker();
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
  });
});
