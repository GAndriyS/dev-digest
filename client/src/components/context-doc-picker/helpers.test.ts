import { describe, it, expect } from "vitest";
import type { SpecFile } from "@devdigest/shared";
import { matchesFilter, moveItem, partitionFiles, totalTokensEst } from "./helpers";

const file = (path: string, opts: Partial<SpecFile> = {}): SpecFile => ({
  path,
  root: "specs",
  tokens_est: 100,
  ...opts,
});

describe("moveItem", () => {
  it("moves an item later", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  it("moves an item earlier", () => {
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
  });

  it("is a no-op outside the array, so a boundary drag cannot drop the item", () => {
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], -1, 0)).toEqual(["a", "b"]);
  });

  it("never mutates the input", () => {
    const input = ["a", "b"];
    moveItem(input, 0, 1);
    expect(input).toEqual(["a", "b"]);
  });
});

describe("matchesFilter", () => {
  it("matches the path case-insensitively", () => {
    expect(matchesFilter("specs/SPEC-01-project-context.md", "spec-01")).toBe(true);
  });

  it("matches everything on an empty or whitespace query", () => {
    expect(matchesFilter("docs/readme.md", "")).toBe(true);
    expect(matchesFilter("docs/readme.md", "   ")).toBe(true);
  });

  it("rejects a non-match", () => {
    expect(matchesFilter("docs/readme.md", "insights")).toBe(false);
  });
});

describe("partitionFiles", () => {
  const files = [file("docs/a.md"), file("specs/b.md"), file("insights/c.md")];

  it("returns attached rows in prompt order and the rest in listing order", () => {
    const { attached, available } = partitionFiles(files, ["insights/c.md", "docs/a.md"]);
    expect(attached.map((r) => r.path)).toEqual(["insights/c.md", "docs/a.md"]);
    expect(available.map((f) => f.path)).toEqual(["specs/b.md"]);
  });

  it("keeps an attached path with no matching file as a missing row, not a hole", () => {
    const { attached } = partitionFiles(files, ["docs/a.md", "docs/deleted.md"]);
    expect(attached).toEqual([
      { path: "docs/a.md", file: files[0] },
      { path: "docs/deleted.md", file: null },
    ]);
  });
});

describe("totalTokensEst", () => {
  const files = [file("a.md", { tokens_est: 100 }), file("b.md", { tokens_est: 250 })];

  it("sums the listing's own estimates for the attached set", () => {
    expect(totalTokensEst(files, ["a.md", "b.md"])).toBe(350);
  });

  it("deduplicates a path that appears more than once", () => {
    expect(totalTokensEst(files, ["a.md", "a.md", "b.md"])).toBe(350);
  });

  it("treats a missing estimate and a missing file as zero, not NaN", () => {
    expect(totalTokensEst(files, ["a.md", "deleted.md"])).toBe(100);
    expect(totalTokensEst([file("a.md", { tokens_est: null })], ["a.md"])).toBe(0);
  });
});
