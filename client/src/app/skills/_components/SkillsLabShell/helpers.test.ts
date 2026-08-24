import { describe, it, expect } from "vitest";
import { skillHref, skillIdFromPathname } from "./helpers";

describe("skillIdFromPathname", () => {
  it("extracts the id segment", () => {
    expect(skillIdFromPathname("/skills/sk1")).toBe("sk1");
  });

  it("returns null on /skills itself and on anything else", () => {
    expect(skillIdFromPathname("/skills")).toBeNull();
    expect(skillIdFromPathname("/agents/a1")).toBeNull();
    expect(skillIdFromPathname(null)).toBeNull();
  });

  it("decodes a validly percent-encoded segment", () => {
    expect(skillIdFromPathname("/skills/sk%20one")).toBe("sk one");
  });

  it("degrades to null instead of throwing on a malformed percent-escape (fix pass 1, item 3)", () => {
    // decodeURIComponent throws URIError on an incomplete escape sequence —
    // this call runs while the layout renders, so an uncaught throw here
    // would take the whole shell (list, search, chrome) down with it, not
    // just the detail column.
    expect(() => skillIdFromPathname("/skills/%E0%A4%A")).not.toThrow();
    expect(skillIdFromPathname("/skills/%E0%A4%A")).toBeNull();
  });
});

describe("skillHref", () => {
  it("builds /skills/:id?tab=:tab from a single URLSearchParams", () => {
    expect(skillHref("sk1", "context")).toBe("/skills/sk1?tab=context");
  });
});
