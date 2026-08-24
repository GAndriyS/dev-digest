import { describe, it, expect } from "vitest";
import type { SkillStats } from "@devdigest/shared";
import { isUntrusted, statsLine, typeColor } from "./helpers";

const stats = (over: Partial<SkillStats> = {}): SkillStats => ({
  used_by: [],
  pull_count_30d: 0,
  runs_total: 0,
  findings_30d: 0,
  accept_rate: null,
  findings_by_category: [],
  ...over,
});

describe("statsLine", () => {
  it("turns pulls into a share of all runs", () => {
    const line = statsLine(stats({ pull_count_30d: 3, runs_total: 4, accept_rate: 0.5 }), "—");
    expect(line).toEqual({ agents: 0, pull: 75, accept: 50 });
  });

  it("does not divide by zero when nothing has run", () => {
    expect(statsLine(stats({ pull_count_30d: 2 }), "—").pull).toBe(0);
  });

  it("shows a placeholder rather than 0% when nothing was triaged", () => {
    expect(statsLine(stats(), "—").accept).toBe("—");
  });

  it("counts the linked agents", () => {
    const used_by = [{ agent_id: "a1", agent_name: "A", order: 0, agent_enabled: true }];
    expect(statsLine(stats({ used_by }), "—").agents).toBe(1);
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
