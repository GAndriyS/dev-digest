import { describe, it, expect } from "vitest";
import { activeKeyFor } from "./helpers";

describe("activeKeyFor", () => {
  // AC-2 / SPEC-03: the repo-scoped tour and the unrelated "add a repository"
  // screen both contain the substring "/onboarding" — only the repo-scoped
  // one may highlight the sidebar item.
  it("highlights the tour item for the repo-scoped onboarding route", () => {
    expect(activeKeyFor("/repos/abc/onboarding")).toBe("onboarding-tour");
  });

  it("still highlights the tour item for a sub-path under the repo-scoped route", () => {
    expect(activeKeyFor("/repos/abc/onboarding/something")).toBe("onboarding-tour");
  });

  it("does not highlight anything for the bare add-a-repository screen", () => {
    expect(activeKeyFor("/onboarding")).toBe("");
  });

  it("does not highlight anything for a sub-path of the bare add-a-repository screen", () => {
    expect(activeKeyFor("/onboarding/step-2")).toBe("");
  });

  // The rest of the mapping must keep working after AC-2's fix — nothing here
  // was supposed to move.
  it("maps every other existing route to its own key", () => {
    expect(activeKeyFor("/settings")).toBe("settings");
    expect(activeKeyFor("/settings/providers")).toBe("settings");
    expect(activeKeyFor("/repos/abc/multi-agent")).toBe("multi-agent");
    expect(activeKeyFor("/repos/abc/context")).toBe("context");
    expect(activeKeyFor("/repos/abc/conventions")).toBe("conventions");
    expect(activeKeyFor("/repos/abc/pulls")).toBe("pulls");
    expect(activeKeyFor("/repos/abc/pulls/42")).toBe("pulls");
    expect(activeKeyFor("/skills")).toBe("skills");
    expect(activeKeyFor("/agents")).toBe("agents");
    expect(activeKeyFor("/eval")).toBe("eval");
    expect(activeKeyFor("/memory")).toBe("memory");
    expect(activeKeyFor("/agent-performance")).toBe("agent-performance");
    expect(activeKeyFor("/ci-runs")).toBe("ci-runs");
  });

  it("falls back to no active key for an unrecognized route", () => {
    expect(activeKeyFor("/")).toBe("");
    expect(activeKeyFor("/repos/abc")).toBe("");
  });
});
