import { describe, it, expect } from "vitest";
import { countChanges, diffLines, formatVersionDate } from "./helpers";

const render = (before: string, after: string) =>
  diffLines(before, after).map((r) => `${r.kind}:${r.text}`);

describe("diffLines (LCS line diff)", () => {
  it("marks every line as context when nothing changed", () => {
    expect(render("a\nb", "a\nb")).toEqual(["context:a", "context:b"]);
  });

  it("reports a replaced line as a delete followed by an add", () => {
    expect(render("a\nb\nc", "a\nx\nc")).toEqual([
      "context:a",
      "del:b",
      "add:x",
      "context:c",
    ]);
  });

  it("keeps common lines when a block is inserted in the middle", () => {
    expect(render("a\nc", "a\nb\nc")).toEqual(["context:a", "add:b", "context:c"]);
  });

  it("reports a pure deletion", () => {
    expect(render("a\nb\nc", "a\nc")).toEqual(["context:a", "del:b", "context:c"]);
  });

  it("numbers each side independently", () => {
    const rows = diffLines("a\nb", "a\nx\nb");
    expect(rows.map((r) => [r.leftNo, r.rightNo])).toEqual([
      [1, 1],
      [null, 2],
      [2, 3],
    ]);
  });

  it("handles an empty before-body as an all-add diff", () => {
    expect(render("", "a")).toEqual(["del:", "add:a"]);
  });
});

describe("countChanges", () => {
  it("counts adds and deletes, ignoring context", () => {
    expect(countChanges(diffLines("a\nb\nc", "a\nx\ny"))).toEqual({ added: 2, removed: 2 });
  });

  it("is zero for identical bodies", () => {
    expect(countChanges(diffLines("a\nb", "a\nb"))).toEqual({ added: 0, removed: 0 });
  });
});

describe("formatVersionDate", () => {
  it("formats an ISO timestamp", () => {
    expect(formatVersionDate("2026-08-04T10:30:00.000Z")).toMatch(/2026/);
  });

  it("passes an unparseable value through untouched", () => {
    expect(formatVersionDate("not-a-date")).toBe("not-a-date");
  });
});
