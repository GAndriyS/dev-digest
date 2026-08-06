import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/conventions.json";
import skillMessages from "../../../../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";

const createSkillMutate = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/hooks/skills", () => ({
  useCreateSkill: () => ({
    mutate: createSkillMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import { CreateSkillModal } from "./CreateSkillModal";

function candidate(over: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: "c1",
    category: "structure",
    rule: "Route handlers return typed results",
    evidence_path: "src/api/routes.ts",
    evidence_snippet: "return ok(items);",
    evidence_line: 12,
    confidence: 0.9,
    status: "accepted",
    ...over,
  };
}

function renderModal(accepted: ConventionCandidate[]) {
  const view = render(
    <NextIntlClientProvider
      locale="en"
      messages={{ conventions: messages, skills: skillMessages }}
    >
      <ToastProvider>
        <CreateSkillModal accepted={accepted} repoFullName="acme/payments-api" onClose={vi.fn()} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
  const rerender = (next: ConventionCandidate[]) =>
    view.rerender(
      <NextIntlClientProvider
        locale="en"
        messages={{ conventions: messages, skills: skillMessages }}
      >
        <ToastProvider>
          <CreateSkillModal accepted={next} repoFullName="acme/payments-api" onClose={vi.fn()} />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
  return { rerender };
}

const saveButton = () => screen.getByText("Create skill").closest("button")!;

beforeEach(() => createSkillMutate.mockReset());
afterEach(cleanup);

describe("CreateSkillModal", () => {
  it("merges the accepted conventions into one create call", () => {
    renderModal([candidate()]);
    fireEvent.click(saveButton());

    const [payload] = createSkillMutate.mock.calls.at(-1)!;
    expect(payload).toMatchObject({ source: "extracted", type: "convention" });
    expect(payload.evidence_files).toEqual(["src/api/routes.ts"]);
    expect(payload.body).toContain("Route handlers return typed results");
  });

  it("ships the set it opened with, even if another accept lands meanwhile", () => {
    // The body and description are captured at mount. An accept PUT already in
    // flight when the dialog opened still resolves — the overlay stops clicks,
    // not requests — and grows `accepted` underneath. Reading the live prop at
    // save time would attach evidence for a rule the body never mentions.
    const { rerender } = renderModal([candidate()]);
    rerender([candidate(), candidate({ id: "c2", rule: "Late rule", evidence_path: "src/late.ts" })]);

    fireEvent.click(saveButton());

    const [payload] = createSkillMutate.mock.calls.at(-1)!;
    expect(payload.evidence_files).toEqual(["src/api/routes.ts"]);
    expect(payload.body).not.toContain("Late rule");
    // The banner counts the same set it will save, so what the user reads and
    // what is written cannot disagree.
    expect(screen.getByText(/Merged from 1 accepted convention/)).toBeInTheDocument();
  });

  it("drops candidates with no evidence path from evidence_files", () => {
    renderModal([candidate(), candidate({ id: "c2", rule: "Second", evidence_path: "" })]);
    fireEvent.click(saveButton());

    const [payload] = createSkillMutate.mock.calls.at(-1)!;
    expect(payload.evidence_files).toEqual(["src/api/routes.ts"]);
  });
});
