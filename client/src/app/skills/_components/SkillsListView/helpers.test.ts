import { describe, it, expect } from "vitest";
import type { Skill } from "@devdigest/shared";
import { filterSkills, isUntrusted, typeColor } from "./helpers";

const skill = (over: Partial<Skill> = {}): Skill => ({
  id: "s1",
  name: "pr-quality-rubric",
  description: "Use when reviewing a pull request end to end",
  type: "rubric",
  source: "manual",
  body: "# body",
  enabled: true,
  version: 1,
  ...over,
});

describe("filterSkills", () => {
  it("returns everything for an empty query", () => {
    const list = [skill(), skill({ id: "s2", name: "secrets" })];
    expect(filterSkills(list, "   ")).toHaveLength(2);
  });

  it("matches the description and the type, not only the name", () => {
    const list = [skill(), skill({ id: "s2", name: "other", description: "", type: "security" })];
    expect(filterSkills(list, "SECURITY").map((s) => s.id)).toEqual(["s2"]);
    expect(filterSkills(list, "end to end").map((s) => s.id)).toEqual(["s1"]);
  });
});

describe("typeColor", () => {
  it("gives every contract type its own accent", () => {
    expect(typeColor("security")).toBe("var(--crit)");
    expect(typeColor("rubric")).not.toBe(typeColor("security"));
  });
});

describe("isUntrusted", () => {
  it("treats remote provenance as unvetted and local authoring as ours", () => {
    expect(isUntrusted("community")).toBe(true);
    expect(isUntrusted("imported_url")).toBe(true);
    expect(isUntrusted("manual")).toBe(false);
    expect(isUntrusted("extracted")).toBe(false);
  });
});
