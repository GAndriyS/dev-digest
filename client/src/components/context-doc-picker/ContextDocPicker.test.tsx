import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextListing, ContextPaths, SpecFile } from "@devdigest/shared";
import messages from "../../../messages/en/context.json";

const setPathsMutate = vi.fn();
const state = {
  listing: { files: [] as SpecFile[], total: 0, truncated: false, roots: ["specs", "docs", "insights"], scanned_at: "" } as ContextListing,
  links: { paths: [] as string[] } as ContextPaths,
};

vi.mock("../../lib/hooks/core", () => ({
  useContextFiles: () => ({ data: state.listing, isLoading: false, isError: false }),
  useOwnerContext: () => ({ data: state.links, isLoading: false, isError: false }),
  useSetOwnerContext: () => ({ mutate: setPathsMutate, isPending: false }),
  useContextDoc: () => ({ data: undefined, isLoading: false, isError: false }),
}));

import { ContextDocPicker } from "./ContextDocPicker";

const doc = (path: string, opts: Partial<SpecFile> = {}): SpecFile => ({
  path,
  root: path.split("/")[0],
  tokens_est: 120,
  ...opts,
});

const CATALOG = [doc("specs/SPEC-01.md"), doc("docs/README.md"), doc("insights/notes.md")];

function renderPicker() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextDocPicker repoId="r1" ownerType="agent" ownerId="ag1" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  setPathsMutate.mockClear();
  state.listing = { files: CATALOG, total: 3, truncated: false, roots: ["specs", "docs", "insights"], scanned_at: "2026-08-18T00:00:00Z" };
  state.links = { paths: ["specs/SPEC-01.md", "docs/README.md"] };
});
afterEach(cleanup);

/** The attached list is rendered first; read its rows in DOM order. */
function attachedList(): HTMLElement {
  return screen.getAllByRole("list")[0]!;
}

function attachedPaths(): string[] {
  return within(attachedList())
    .getAllByRole("listitem")
    .map((li) => li.getAttribute("data-path") ?? "");
}

describe("ContextDocPicker", () => {
  it("summarises how many of the listing's documents are attached", () => {
    renderPicker();
    expect(screen.getByText("2 of 3 attached")).toBeInTheDocument();
  });

  it("shows attached documents in prompt order, numbered, with the rest available", () => {
    renderPicker();
    expect(attachedPaths()).toEqual(["specs/SPEC-01.md", "docs/README.md"]);
    expect(screen.getByText("Attached")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
  });

  it("attaches an unlinked document at the end of the prompt order", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("checkbox", { name: "insights/notes.md" }));
    expect(setPathsMutate).toHaveBeenCalledWith(
      { ownerType: "agent", ownerId: "ag1", paths: ["specs/SPEC-01.md", "docs/README.md", "insights/notes.md"] },
      expect.anything(),
    );
  });

  it("detaches an attached document", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("checkbox", { name: "specs/SPEC-01.md" }));
    expect(setPathsMutate).toHaveBeenCalledWith(
      { ownerType: "agent", ownerId: "ag1", paths: ["docs/README.md"] },
      expect.anything(),
    );
  });

  it("reorders with the arrow buttons and shows the new order immediately", () => {
    renderPicker();
    fireEvent.click(screen.getByLabelText("Move docs/README.md earlier in the prompt"));
    expect(setPathsMutate).toHaveBeenCalledWith(
      { ownerType: "agent", ownerId: "ag1", paths: ["docs/README.md", "specs/SPEC-01.md"] },
      expect.anything(),
    );
    // Optimistic: the list re-renders from the draft, not from a refetch.
    expect(attachedPaths()).toEqual(["docs/README.md", "specs/SPEC-01.md"]);
  });

  it("rolls back to the server order when the write fails", () => {
    renderPicker();
    fireEvent.click(screen.getByLabelText("Move docs/README.md earlier in the prompt"));
    expect(attachedPaths()).toEqual(["docs/README.md", "specs/SPEC-01.md"]);
    const options = setPathsMutate.mock.calls[0]![1] as { onError: () => void };
    act(() => options.onError());
    expect(attachedPaths()).toEqual(["specs/SPEC-01.md", "docs/README.md"]);
  });

  it("filters both sections without renumbering the prompt", () => {
    renderPicker();
    fireEvent.change(screen.getByPlaceholderText("Filter documents…"), { target: { value: "readme" } });
    expect(screen.getByText("docs/README.md")).toBeInTheDocument();
    expect(screen.queryByText("insights/notes.md")).not.toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("tells the user when nothing matches the filter", () => {
    renderPicker();
    fireEvent.change(screen.getByPlaceholderText("Filter documents…"), { target: { value: "zzz" } });
    expect(screen.getByText("No documents match “zzz”.")).toBeInTheDocument();
  });

  it("renders a path attached earlier but no longer in the listing as a missing row", () => {
    state.links = { paths: ["specs/deleted.md"] };
    renderPicker();
    expect(screen.getByText("specs/deleted.md")).toBeInTheDocument();
    expect(screen.getByText("missing — deleted from the repo")).toBeInTheDocument();
  });

  it("sums ≈ tokens across the attached set", () => {
    renderPicker();
    expect(screen.getByText("≈ 240 tokens")).toBeInTheDocument();
  });

  it("explains an empty catalog instead of rendering an empty list", () => {
    state.listing = { files: [], total: 0, truncated: false, roots: ["specs"], scanned_at: "" };
    state.links = { paths: [] };
    renderPicker();
    expect(screen.getByText("No documents to attach")).toBeInTheDocument();
  });
});
