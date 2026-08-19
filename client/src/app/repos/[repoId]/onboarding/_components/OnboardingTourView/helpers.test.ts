import { describe, it, expect } from "vitest";
import { sanitizeSectionBody } from "./helpers";

/**
 * `sanitizeSectionBody` guards against attacker-influenceable `body` text —
 * both the model's own output and repo content it was grounded in are
 * untrusted (SPEC-03 NFR "Untrusted inputs" / "Вивід моделі": images and
 * links pointing outside the app must not survive, but ordinary markdown and
 * file paths must render unchanged). The evidence gate (AC-21) covers
 * `links[]`; this covers `body` prose, which the gate never touches.
 */
describe("sanitizeSectionBody", () => {
  it("removes a markdown image but keeps its alt text", () => {
    const out = sanitizeSectionBody(
      "Diagram: ![Architecture diagram](https://evil.tld/beacon.png) done.",
    );
    expect(out).toContain("Architecture diagram");
    expect(out).not.toContain("![");
    expect(out).not.toContain("https://evil.tld/beacon.png");
  });

  it("collapses a markdown link to its visible text and drops the destination entirely", () => {
    const out = sanitizeSectionBody("See [Configure credentials](https://evil.tld/login) for setup.");
    expect(out).toBe("See Configure credentials for setup.");
    expect(out).not.toContain("https://evil.tld/login");
    expect(out).not.toContain("(");
  });

  it("de-linkifies an angle-bracket autolink", () => {
    const out = sanitizeSectionBody("Contact <https://evil.tld>.");
    expect(out).not.toContain("<https://evil.tld>");
    // The zero-width separator breaks the contiguous "https://evil.tld" run
    // so remark-gfm can no longer recognize it as an autolink, while the
    // surrounding text stays readable.
    expect(out).not.toContain("https://evil.tld");
    expect(out).toContain("evil.tld");
  });

  it("de-linkifies a bare URL so it no longer autolinks", () => {
    const out = sanitizeSectionBody("Read more at https://evil.tld/p?d=x for docs.");
    expect(out).not.toContain("https://evil");
    expect(out).toContain("https:");
  });

  it("leaves ordinary markdown (bold, code spans, file paths, lists, headings) untouched", () => {
    const body = [
      "## Setup",
      "",
      "Run **pnpm install** first, then edit `src/index.ts`.",
      "",
      "- step one",
      "- step two",
    ].join("\n");
    expect(sanitizeSectionBody(body)).toBe(body);
  });
});
