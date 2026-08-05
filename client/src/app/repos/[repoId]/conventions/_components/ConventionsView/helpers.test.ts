import { describe, it, expect } from "vitest";
import type { ConventionCandidate } from "@devdigest/shared";
import {
  acceptedOf,
  buildConventionsSkill,
  defaultSkillName,
  repoSlug,
  sortForReview,
} from "./helpers";

function c(over: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: "1",
    category: "async",
    rule: "Always use async/await instead of .then() chains",
    evidence_path: "src/api/users.ts",
    evidence_snippet: "const user = await db.users.find(id);",
    evidence_line: 23,
    confidence: 0.91,
    status: "pending",
    ...over,
  };
}

describe("repoSlug / defaultSkillName", () => {
  it("takes the repo name out of owner/name", () => {
    expect(repoSlug("acme/payments-api")).toBe("payments-api");
    expect(defaultSkillName("acme/payments-api")).toBe("payments-api-conventions");
  });

  it("falls back to the whole string when there is no slash", () => {
    expect(repoSlug("payments-api")).toBe("payments-api");
  });
});

describe("acceptedOf / sortForReview", () => {
  it("keeps only accepted candidates", () => {
    const list = [c({ id: "a", status: "accepted" }), c({ id: "b", status: "rejected" }), c({ id: "d" })];
    expect(acceptedOf(list).map((x) => x.id)).toEqual(["a"]);
  });

  it("puts undecided candidates first and rejected last", () => {
    const list = [
      c({ id: "rejected", status: "rejected" }),
      c({ id: "accepted", status: "accepted" }),
      c({ id: "pending", status: "pending" }),
    ];
    expect(sortForReview(list).map((x) => x.id)).toEqual(["pending", "accepted", "rejected"]);
  });

  it("does not mutate the input", () => {
    const list = [c({ id: "b", status: "rejected" }), c({ id: "a" })];
    sortForReview(list);
    expect(list.map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("buildConventionsSkill", () => {
  it("titles the body and names the repo", () => {
    const body = buildConventionsSkill("acme/payments-api", [c()]);
    expect(body).toContain("# payments-api-conventions");
    expect(body).toContain("`acme/payments-api`");
  });

  it("writes one section per accepted rule, carrying its evidence", () => {
    const body = buildConventionsSkill("acme/payments-api", [
      c({ id: "1", category: "async" }),
      c({ id: "2", category: "structure", rule: "Redis goes through one client", evidence_line: 9 }),
    ]);
    expect(body).toContain("## async");
    expect(body).toContain("## structure");
    expect(body).toContain("Detected in `src/api/users.ts:23`:");
    expect(body).toContain("Detected in `src/api/users.ts:9`:");
    expect(body).toContain("const user = await db.users.find(id);");
  });

  it("omits the line suffix when no line was derived", () => {
    const body = buildConventionsSkill("acme/payments-api", [c({ evidence_line: null })]);
    expect(body).toContain("Detected in `src/api/users.ts`:");
  });

  it("skips the evidence block entirely when there is no path", () => {
    const body = buildConventionsSkill("acme/payments-api", [c({ evidence_path: "" })]);
    expect(body).not.toContain("Detected in");
    expect(body).toContain("Always use async/await");
  });

  it("produces a header-only body for an empty selection", () => {
    const body = buildConventionsSkill("acme/payments-api", []);
    expect(body).toContain("# payments-api-conventions");
    expect(body).not.toContain("##");
  });
});
