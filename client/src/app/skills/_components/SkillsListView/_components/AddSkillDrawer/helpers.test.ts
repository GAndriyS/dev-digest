import { describe, it, expect } from "vitest";
import { deriveNameFromBody, resolveSkillName } from "./helpers";

describe("deriveNameFromBody", () => {
  it("takes the first ATX heading", () => {
    expect(deriveNameFromBody("# PR quality rubric\n\nsome rule")).toBe("PR quality rubric");
  });

  it("accepts any heading level and skips leading prose", () => {
    expect(deriveNameFromBody("intro line\n### Deep heading\n")).toBe("Deep heading");
  });

  it("ignores a hash that is not a heading", () => {
    expect(deriveNameFromBody("#nospace\nbody")).toBe("");
    expect(deriveNameFromBody("no heading at all")).toBe("");
  });

  it("is empty for an empty body", () => {
    expect(deriveNameFromBody("")).toBe("");
  });
});

describe("resolveSkillName", () => {
  it("prefers what the user typed", () => {
    expect(resolveSkillName("  typed  ", "# heading")).toBe("typed");
  });

  it("falls back to the body's first heading when the name is blank", () => {
    expect(resolveSkillName("   ", "# heading")).toBe("heading");
  });

  it("is empty when neither is available — the caller must block the submit", () => {
    expect(resolveSkillName("", "body with no heading")).toBe("");
  });
});
