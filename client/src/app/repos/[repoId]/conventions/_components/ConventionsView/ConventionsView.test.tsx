import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import skillMessages from "../../../../../../../messages/en/skills.json";
import commonMessages from "../../../../../../../messages/en/common.json";
import { ToastProvider } from "@/lib/toast";

const extractMutate = vi.fn();
const updateMutate = vi.fn();
const createSkillMutate = vi.fn();

const state = {
  data: [] as ConventionCandidate[] | undefined,
  isLoading: false,
  isError: false,
  extractPending: false,
  repoNotFound: false,
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ repoId: "r1" }),
}));

// The app chrome is not what this view is about; render its children only.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "r1", full_name: "acme/payments-api", default_branch: "main" },
  }),
  useRepoNotFound: () => state.repoNotFound,
}));

// The modal creates through the ordinary skills hook; mocking it keeps this
// suite free of a QueryClientProvider, as every other view test here is.
vi.mock("@/lib/hooks/skills", () => ({
  useCreateSkill: () => ({
    mutate: createSkillMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("@/lib/hooks/conventions", () => ({
  useConventions: () => ({
    data: state.data,
    isLoading: state.isLoading,
    isError: state.isError,
    refetch: vi.fn(),
  }),
  useExtractConventions: () => ({
    mutate: extractMutate,
    isPending: state.extractPending,
    isError: false,
    error: null,
    data: undefined,
  }),
  useUpdateConvention: () => ({ mutate: updateMutate, isPending: false }),
}));

import { ConventionsView } from "./ConventionsView";

function candidate(over: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: "c1",
    category: "async",
    rule: "Always use async/await instead of .then() chains",
    evidence_path: "src/api/users.ts",
    evidence_snippet: "const user = await db.users.find(id);",
    evidence_line: 23,
    confidence: 0.91,
    status: "pending",
    ...over,
  };
}

function renderView() {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{ conventions: messages, skills: skillMessages, common: commonMessages }}
    >
      <ToastProvider>
        <ConventionsView repoId="r1" />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.data = [];
  state.isLoading = false;
  state.isError = false;
  state.extractPending = false;
  state.repoNotFound = false;
  extractMutate.mockReset();
  updateMutate.mockReset();
  createSkillMutate.mockReset();
});
afterEach(cleanup);

describe("ConventionsView", () => {
  it("offers to run the extraction when nothing has been scanned", () => {
    renderView();
    expect(screen.getByText("No conventions extracted yet")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Run extraction"));
    expect(extractMutate).toHaveBeenCalledOnce();
  });

  it("surfaces a load failure instead of an empty state", () => {
    state.data = undefined;
    state.isError = true;
    renderView();
    expect(screen.getByText("Could not load conventions.")).toBeInTheDocument();
  });

  it("renders a candidate with its evidence and a GitHub deep-link", () => {
    state.data = [candidate()];
    renderView();

    expect(screen.getByText(/Always use async\/await/)).toBeInTheDocument();
    expect(screen.getByText("const user = await db.users.find(id);")).toBeInTheDocument();

    const link = screen.getByText("src/api/users.ts:23").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/main/src/api/users.ts#L23",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("accepts and rejects a candidate", () => {
    state.data = [candidate()];
    renderView();

    fireEvent.click(screen.getByText("Accept"));
    expect(updateMutate).toHaveBeenCalledWith({ id: "c1", patch: { status: "accepted" } });

    fireEvent.click(screen.getByText("Reject"));
    expect(updateMutate).toHaveBeenCalledWith({ id: "c1", patch: { status: "rejected" } });
  });

  it("clicking the active status again clears it back to pending", () => {
    state.data = [candidate({ status: "accepted" })];
    renderView();
    // Both the badge and the button read "Accepted"; the button is the last one.
    const buttons = screen.getAllByText("Accepted");
    fireEvent.click(buttons[buttons.length - 1]!);
    expect(updateMutate).toHaveBeenCalledWith({ id: "c1", patch: { status: "pending" } });
  });

  it("edits a rule and saves the new wording", () => {
    state.data = [candidate()];
    renderView();

    fireEvent.click(screen.getByText("Edit rule"));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "Prefer async/await everywhere" } });
    fireEvent.click(screen.getByText("Save"));

    expect(updateMutate).toHaveBeenCalledWith({
      id: "c1",
      patch: { rule: "Prefer async/await everywhere" },
    });
  });

  it("only enables Create skill once something is accepted", () => {
    state.data = [candidate()];
    const { unmount } = { unmount: () => cleanup() };
    renderView();
    expect(screen.getByText("Create skill").closest("button")).toBeDisabled();
    expect(screen.getByText("0 of 1 accepted")).toBeInTheDocument();
    unmount();

    state.data = [candidate({ status: "accepted" })];
    renderView();
    expect(screen.getByText("Create skill").closest("button")).not.toBeDisabled();
    expect(screen.getByText("1 of 1 accepted")).toBeInTheDocument();
  });

  it("opens the create-skill modal prefilled from the accepted rules", () => {
    state.data = [candidate({ status: "accepted" })];
    renderView();

    fireEvent.click(screen.getByText("Create skill"));
    expect(screen.getByText("Create skill from conventions")).toBeInTheDocument();
    expect(
      screen.getByText("Merged from 1 accepted convention in acme/payments-api. Everything below is editable before you save."),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("payments-api-conventions")).toBeInTheDocument();
  });

  it("saves the merged skill as extracted, carrying the evidence paths", () => {
    state.data = [
      candidate({ id: "a", status: "accepted" }),
      candidate({ id: "b", status: "accepted", category: "structure", evidence_path: "src/lib/redis.ts" }),
      candidate({ id: "c", status: "rejected" }),
    ];
    renderView();

    fireEvent.click(screen.getByText("Create skill"));
    // The modal's save button carries the same label as the toolbar's, and the
    // modal renders FIRST in the DOM — so scope the query to the dialog rather
    // than picking by position.
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Create skill"));

    const [payload] = createSkillMutate.mock.calls.at(-1)!;
    expect(payload).toMatchObject({
      name: "payments-api-conventions",
      type: "convention",
      source: "extracted",
      enabled: true,
      // Only the two ACCEPTED rules — the rejected one never reaches the skill.
      evidence_files: ["src/api/users.ts", "src/lib/redis.ts"],
    });
    expect(payload.body).toContain("## async");
    expect(payload.body).toContain("## structure");
    expect(payload.body).not.toContain("rejected");
  });

  it("shows the repo-not-found state for a stale repo id", () => {
    state.repoNotFound = true;
    renderView();
    expect(screen.queryByText("No conventions extracted yet")).not.toBeInTheDocument();
  });
});
