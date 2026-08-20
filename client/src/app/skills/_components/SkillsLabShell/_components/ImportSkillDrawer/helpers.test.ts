import { describe, it, expect } from "vitest";
import { isSupportedSkillFile, readFileAsBase64, stripDataUrlPrefix } from "./helpers";

describe("isSupportedSkillFile", () => {
  it("accepts markdown and archives, case-insensitively", () => {
    expect(isSupportedSkillFile("skill.md")).toBe(true);
    expect(isSupportedSkillFile("SKILL.MARKDOWN")).toBe(true);
    expect(isSupportedSkillFile("bundle.Zip")).toBe(true);
  });

  it("rejects anything else — an executable must not reach the endpoint", () => {
    expect(isSupportedSkillFile("payload.sh")).toBe(false);
    expect(isSupportedSkillFile("skill.md.exe")).toBe(false);
    expect(isSupportedSkillFile("noextension")).toBe(false);
  });
});

describe("stripDataUrlPrefix", () => {
  it("keeps only the base64 payload", () => {
    expect(stripDataUrlPrefix("data:text/markdown;base64,SGk=")).toBe("SGk=");
  });

  it("passes through a value that is already bare base64", () => {
    expect(stripDataUrlPrefix("SGk=")).toBe("SGk=");
  });
});

describe("readFileAsBase64", () => {
  it("encodes the file without the data-URL wrapper", async () => {
    const file = new File(["# Hi"], "skill.md", { type: "text/markdown" });
    await expect(readFileAsBase64(file)).resolves.toBe(btoa("# Hi"));
  });
});
