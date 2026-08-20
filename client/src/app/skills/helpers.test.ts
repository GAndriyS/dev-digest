import { describe, it, expect } from "vitest";
import { pullFrequency } from "./helpers";

describe("pullFrequency", () => {
  it("turns pulls into a share of all runs", () => {
    expect(pullFrequency({ pull_count_30d: 3, runs_total: 4 })).toBe(75);
  });

  it("rounds to the nearest whole percent", () => {
    expect(pullFrequency({ pull_count_30d: 1, runs_total: 3 })).toBe(33);
  });

  it("reads runs_total = 0 as 0%, not a division by zero", () => {
    expect(pullFrequency({ pull_count_30d: 2, runs_total: 0 })).toBe(0);
  });
});
