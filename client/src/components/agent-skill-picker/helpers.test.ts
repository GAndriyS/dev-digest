import { describe, it, expect } from "vitest";
import type { AgentSkillLink, Skill } from "@devdigest/shared";
import { matchesFilter, moveItem, orderedSkillIds, partitionSkills } from "./helpers";

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

const link = (skill_id: string, order: number): AgentSkillLink => ({
  agent_id: "ag1",
  skill_id,
  order,
});

describe("orderedSkillIds", () => {
  it("sorts by the order column rather than trusting arrival order", () => {
    expect(orderedSkillIds([link("b", 1), link("a", 0)])).toEqual(["a", "b"]);
  });

  it("treats a missing link list as empty", () => {
    expect(orderedSkillIds(undefined)).toEqual([]);
  });
});

describe("moveItem", () => {
  it("moves an item later", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  it("moves an item earlier", () => {
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
  });

  it("is a no-op outside the array, so a boundary drag cannot drop the item", () => {
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], -1, 0)).toEqual(["a", "b"]);
  });

  it("never mutates the input", () => {
    const input = ["a", "b"];
    moveItem(input, 0, 1);
    expect(input).toEqual(["a", "b"]);
  });
});

describe("matchesFilter", () => {
  const s = skill("1", "secret-leakage-gate", "Detects sk_live leaks in a diff.");

  it("matches name and description case-insensitively", () => {
    expect(matchesFilter(s, "LEAKAGE")).toBe(true);
    expect(matchesFilter(s, "sk_live")).toBe(true);
  });

  it("matches everything on an empty or whitespace query", () => {
    expect(matchesFilter(s, "")).toBe(true);
    expect(matchesFilter(s, "   ")).toBe(true);
  });

  it("rejects a non-match", () => {
    expect(matchesFilter(s, "rubric")).toBe(false);
  });
});

describe("partitionSkills", () => {
  const catalog = [skill("a", "alpha"), skill("b", "beta"), skill("c", "gamma")];

  it("returns linked in prompt order and the rest in catalog order", () => {
    const { linked, available } = partitionSkills(catalog, ["c", "a"]);
    expect(linked.map((s) => s.id)).toEqual(["c", "a"]);
    expect(available.map((s) => s.id)).toEqual(["b"]);
  });

  it("drops a linked id with no matching skill instead of rendering a hole", () => {
    const { linked } = partitionSkills(catalog, ["a", "deleted"]);
    expect(linked.map((s) => s.id)).toEqual(["a"]);
  });
});
