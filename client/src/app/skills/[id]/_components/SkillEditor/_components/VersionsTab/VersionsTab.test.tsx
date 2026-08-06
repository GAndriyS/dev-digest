import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillVersion } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";

const restoreMutate = vi.fn();

// Different lengths on purpose — the list shows a per-version char count.
const BODIES: Record<number, string> = {
  1: "# Rubric\nold\ntail",
  2: "# Rubric\nbrand new line\ntail",
};

const version = (v: number): SkillVersion => ({
  skill_id: "sk1",
  version: v,
  body_chars: BODIES[v]?.length ?? 0,
  created_at: "2026-08-0" + v + "T10:00:00.000Z",
});

const state = { versions: [version(1), version(2)] as SkillVersion[], isError: false };

vi.mock("@/lib/hooks/skills", () => ({
  useSkillVersions: () => ({
    data: state.versions,
    isLoading: false,
    isError: state.isError,
    refetch: vi.fn(),
  }),
  useSkillVersion: (_id: string, v: number | null) => ({
    data: v == null ? undefined : { ...version(v), body: BODIES[v] },
  }),
  useRestoreSkillVersion: () => ({ mutate: restoreMutate, isPending: false }),
}));

import { VersionsTab } from "./VersionsTab";

const SKILL: Skill = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "",
  type: "rubric",
  source: "manual",
  body: BODIES[2]!,
  enabled: true,
  version: 2,
};

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <VersionsTab skill={SKILL} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.versions = [version(1), version(2)];
  state.isError = false;
  restoreMutate.mockReset();
});
afterEach(cleanup);

describe("VersionsTab", () => {
  it("lists versions newest first with their size, marking the current one", () => {
    renderTab();
    // Badges only — the compare pickers repeat the same labels as <option>s.
    const badges = screen
      .getAllByText(/^v\d+$/)
      .filter((n) => n.tagName === "SPAN")
      .map((n) => n.textContent);
    expect(badges).toEqual(["v2", "v1"]);
    expect(screen.getByText("current")).toBeInTheDocument();
    expect(screen.getByText(`${BODIES[1]!.length} chars`)).toBeInTheDocument();
  });

  it("defaults the comparison to the two newest versions and diffs them", () => {
    renderTab();
    expect(screen.getByText("+1 / −1 lines")).toBeInTheDocument();
    expect(screen.getByText("old")).toBeInTheDocument();
    expect(screen.getByText("brand new line")).toBeInTheDocument();
  });

  it("restores a version only after the confirm is accepted", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderTab();
    fireEvent.click(screen.getByText("Restore"));
    expect(restoreMutate).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByText("Restore"));
    expect(restoreMutate).toHaveBeenCalledWith(
      { id: "sk1", version: 1 },
      expect.anything(),
    );
    confirm.mockRestore();
  });

  it("asks for two versions when there is only one", () => {
    state.versions = [version(2)];
    renderTab();
    expect(screen.getByText("Pick two different versions to see what changed.")).toBeInTheDocument();
  });

  it("shows an empty state when there is no history at all", () => {
    state.versions = [];
    renderTab();
    expect(screen.getByText("No version history")).toBeInTheDocument();
  });

  it("surfaces a load failure with a retry", () => {
    state.isError = true;
    renderTab();
    expect(screen.getByText("Could not load version history.")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });
});
