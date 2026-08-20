import { describe, it, expect } from "vitest";
import { estimateBodyTokens } from "./helpers";

describe("estimateBodyTokens", () => {
  it("estimates an empty body as 0 tokens, not 1", () => {
    expect(estimateBodyTokens("")).toBe(0);
  });

  it("rounds a short ASCII body up to at least 1 token", () => {
    expect(estimateBodyTokens("go")).toBe(1);
  });

  it("estimates ~4 characters per token, rounding up", () => {
    expect(estimateBodyTokens("a".repeat(4))).toBe(1);
    expect(estimateBodyTokens("a".repeat(5))).toBe(2);
    expect(estimateBodyTokens("a".repeat(40))).toBe(10);
  });

  it("counts multi-byte text by character length, not UTF-8 bytes", () => {
    // "é" is 1 UTF-16 code unit but 2 UTF-8 bytes — the client's ≈ estimate
    // runs low relative to the server's byte-based one on non-ASCII bodies.
    expect(estimateBodyTokens("é".repeat(4))).toBe(1);
  });
});
