import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";
import { ApiError } from "@/lib/api";

const state = { skill: null as Skill | null, error: null as unknown };

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "sk1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=config"),
}));

const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null };

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/hooks/skills", () => ({
  useSkill: () => ({
    data: state.skill ?? undefined,
    isLoading: false,
    isError: state.error != null,
    error: state.error,
    refetch: vi.fn(),
  }),
  useDeleteSkill: () => mutation,
  useUpdateSkill: () => mutation,
}));

import { SkillDetailView } from "./SkillDetailView";

const SKILL: Skill = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "Overall PR quality rubric",
  type: "rubric",
  source: "community",
  body: "# Rubric",
  enabled: false,
  version: 4,
};

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <SkillDetailView />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.skill = SKILL;
  state.error = null;
});
afterEach(cleanup);

describe("SkillDetailView", () => {
  it("shows the name, version, disabled and untrusted markers", () => {
    renderView();
    expect(screen.getByText("pr-quality-rubric")).toBeInTheDocument();
    // The header and the Config tab below it both carry these.
    expect(screen.getAllByText("v4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Disabled").length).toBeGreaterThan(0);
    expect(screen.getByText("untrusted source")).toBeInTheDocument();
    expect(screen.getByText(/came from an untrusted source/)).toBeInTheDocument();
  });

  it("treats a 404 as 'not found' rather than a transport failure", () => {
    state.skill = null;
    state.error = new ApiError("gone", 404);
    renderView();
    expect(screen.getByText("Skill not found")).toBeInTheDocument();
    expect(screen.queryByText("Could not load this skill.")).not.toBeInTheDocument();
  });

  it("offers a retry on any other failure", () => {
    state.skill = null;
    state.error = new ApiError("boom", 500);
    renderView();
    expect(screen.getByText("Could not load this skill.")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });
});
