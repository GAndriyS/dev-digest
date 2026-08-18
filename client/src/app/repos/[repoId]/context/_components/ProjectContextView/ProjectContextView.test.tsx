import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextListing, SpecFile } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/context.json";

const replace = vi.fn();
let searchParams = new URLSearchParams();

const state = {
  listing: undefined as ContextListing | undefined,
  isLoading: false,
  isError: false,
  repoNotFound: false,
  doc: undefined as SpecFile | undefined,
  docLoading: false,
  docError: false,
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => searchParams,
  useParams: () => ({ repoId: "r1" }),
}));

vi.mock("@/components/repo-not-found", () => ({
  RepoNotFound: () => <div>REPO_NOT_FOUND</div>,
}));

// The app chrome is not what this view is about; render its children only.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "r1", full_name: "acme/payments-api", default_branch: "main" } }),
  useRepoNotFound: () => state.repoNotFound,
}));

const refetch = vi.fn();
vi.mock("@/lib/hooks/core", () => ({
  useContextFiles: () => ({ data: state.listing, isLoading: state.isLoading, isError: state.isError, refetch }),
  useContextDoc: () => ({ data: state.doc, isLoading: state.docLoading, isError: state.docError }),
}));

import { ProjectContextView } from "./ProjectContextView";

const file = (path: string, opts: Partial<SpecFile> = {}): SpecFile => ({
  path,
  root: path.split("/")[0],
  tokens_est: 100,
  updated_at: "2026-08-18T00:00:00Z",
  ...opts,
});

function listing(files: SpecFile[], opts: Partial<ContextListing> = {}): ContextListing {
  return { files, total: files.length, truncated: false, roots: ["specs", "docs", "insights"], scanned_at: "2026-08-18T09:00:00Z", ...opts };
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ProjectContextView />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  searchParams = new URLSearchParams();
  state.listing = listing([file("specs/SPEC-01.md"), file("docs/README.md")]);
  state.isLoading = false;
  state.isError = false;
  state.repoNotFound = false;
  state.doc = undefined;
  state.docLoading = false;
  state.docError = false;
  replace.mockClear();
  refetch.mockClear();
});
afterEach(cleanup);

describe("ProjectContextView", () => {
  it("lists every document under the configured roots", () => {
    renderView();
    expect(screen.getByText("specs/SPEC-01.md")).toBeInTheDocument();
    expect(screen.getByText("docs/README.md")).toBeInTheDocument();
  });

  it("shows the footer with file count, token total and last scan", () => {
    renderView();
    expect(screen.getByText(/Indexed: 2 files · 200 tokens total · last scan/)).toBeInTheDocument();
  });

  it("shows skeletons rather than an empty state while loading", () => {
    state.listing = undefined;
    state.isLoading = true;
    renderView();
    expect(screen.queryByText("No documents found")).not.toBeInTheDocument();
    expect(screen.queryByText("specs/SPEC-01.md")).not.toBeInTheDocument();
  });

  it("surfaces a load failure with Retry, distinct from the empty state", () => {
    state.listing = undefined;
    state.isError = true;
    renderView();
    expect(screen.getByText("Couldn’t load this repo’s context")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Retry"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("explains an empty listing by naming the configured roots", () => {
    state.listing = listing([]);
    renderView();
    expect(screen.getByText("No documents found")).toBeInTheDocument();
    expect(screen.getByText(/specs, docs, insights/)).toBeInTheDocument();
  });

  it("banners a truncated listing", () => {
    state.listing = listing([file("a.md")], { truncated: true, total: 2500 });
    renderView();
    expect(screen.getByText(/Showing the first 1 of 2500 files/)).toBeInTheDocument();
  });

  it("filters the list by path", () => {
    renderView();
    fireEvent.change(screen.getByPlaceholderText("Search documents…"), { target: { value: "readme" } });
    expect(screen.getByText("docs/README.md")).toBeInTheDocument();
    expect(screen.queryByText("specs/SPEC-01.md")).not.toBeInTheDocument();
  });

  it("prompts to select a document before anything is picked", () => {
    renderView();
    expect(screen.getByText("Select a document to preview it.")).toBeInTheDocument();
  });

  it("writes the picked path into ?path=", () => {
    renderView();
    fireEvent.click(screen.getByText("specs/SPEC-01.md"));
    expect(replace).toHaveBeenCalledWith("/repos/r1/context?path=specs%2FSPEC-01.md");
  });

  it("previews the selected document's Markdown body and its used-by-agents count — never raw HTML/scripts", () => {
    searchParams = new URLSearchParams("path=specs%2FSPEC-01.md");
    state.listing = listing([file("specs/SPEC-01.md", { used_by_agents: 2 })]);
    state.doc = { path: "specs/SPEC-01.md", content: "# Title\n\n<script>alert(1)</script>\n\nBody **text**." };
    renderView();

    expect(screen.getByText("Used by 2 agents")).toBeInTheDocument();
    // Rendered by react-markdown: the bold run is an element, and a raw
    // <script> tag is never injected as executable HTML.
    expect(document.querySelector("script")).not.toBeInTheDocument();
    expect(screen.getByText("text").tagName).toBe("STRONG");
  });

  it("shows the repo-not-found state for a stale repo id", () => {
    state.repoNotFound = true;
    renderView();
    expect(screen.getByText("REPO_NOT_FOUND")).toBeInTheDocument();
    expect(screen.queryByText("specs/SPEC-01.md")).not.toBeInTheDocument();
  });
});
