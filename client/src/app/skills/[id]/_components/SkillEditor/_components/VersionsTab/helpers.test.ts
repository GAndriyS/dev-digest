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

describe("diffLines — identical head/tail are peeled before the LCS", () => {
  it("gives the same rows as a full alignment for an edit in the middle", () => {
    const before = ["a", "b", "OLD", "d", "e"].join("\n");
    const after = ["a", "b", "NEW", "d", "e"].join("\n");
    expect(diffLines(before, after).map((r) => [r.kind, r.text, r.leftNo, r.rightNo])).toEqual([
      ["context", "a", 1, 1],
      ["context", "b", 2, 2],
      ["del", "OLD", 3, null],
      ["add", "NEW", null, 3],
      ["context", "d", 4, 4],
      ["context", "e", 5, 5],
    ]);
  });

  it("numbers the tail correctly when the sides have different lengths", () => {
    const before = ["head", "x", "tail"].join("\n");
    const after = ["head", "x", "y", "tail"].join("\n");
    const rows = diffLines(before, after);
    expect(rows.map((r) => [r.kind, r.text])).toEqual([
      ["context", "head"],
      ["context", "x"],
      ["add", "y"],
      ["context", "tail"],
    ]);
    const last = rows[rows.length - 1];
    expect([last?.leftNo, last?.rightNo]).toEqual([3, 4]);
  });

  it("stays exact on a one-line edit far beyond the LCS guard", () => {
    // Without peeling this is 4000x4000 = 16M cells (~64 MB) and would fall
    // back to "everything replaced". Peeling leaves a 1-line middle.
    const lines = Array.from({ length: 4000 }, (_, k) => `line ${k}`);
    const before = lines.join("\n");
    const edited = [...lines];
    edited[2000] = "line 2000 CHANGED";
    const rows = diffLines(before, edited.join("\n"));
    expect(countChanges(rows)).toEqual({ added: 1, removed: 1 });
    expect(rows).toHaveLength(4001);
    const del = rows.find((r) => r.kind === "del");
    expect([del?.text, del?.leftNo]).toEqual(["line 2000", 2001]);
  });

  it("still degrades to wholesale when the DIFFERING middle is too large", () => {
    const before = Array.from({ length: 2000 }, (_, k) => `a${k}`).join("\n");
    const after = Array.from({ length: 2000 }, (_, k) => `b${k}`).join("\n");
    const rows = diffLines(before, after);
    expect(countChanges(rows)).toEqual({ added: 2000, removed: 2000 });
    expect(rows.some((r) => r.kind === "context")).toBe(false);
  });
});
