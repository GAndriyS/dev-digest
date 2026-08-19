import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Onboarding, OnboardingLink, OnboardingSection } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/onboarding.json";

// jsdom implements neither of these; the component calls both.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn() },
    configurable: true,
  });
});

const generateMutate = vi.fn();
const refetch = vi.fn();

const state = {
  tour: undefined as Onboarding | undefined,
  isLoading: false,
  isError: false,
  repoNotFound: false,
  generatePending: false,
};

vi.mock("next/navigation", () => ({
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
  useActiveRepo: () => ({
    activeRepo: { id: "r1", full_name: "acme/payments-api", default_branch: "main" },
  }),
  useRepoNotFound: () => state.repoNotFound,
}));

vi.mock("@/lib/hooks/onboarding", () => ({
  useOnboardingTour: () => ({
    data: state.tour,
    isLoading: state.isLoading,
    isError: state.isError,
    refetch,
  }),
  useGenerateOnboardingTour: () => ({
    mutate: generateMutate,
    isPending: state.generatePending,
    isError: false,
    error: null,
  }),
}));

import { OnboardingTourView } from "./OnboardingTourView";

// ---- fixtures ---------------------------------------------------------

function link(path: string, label: string): OnboardingLink {
  return { path, label };
}

function section(kind: OnboardingSection["kind"], over: Partial<OnboardingSection> = {}): OnboardingSection {
  const defaults: Record<OnboardingSection["kind"], Pick<OnboardingSection, "title" | "body">> = {
    architecture_overview: {
      title: "System architecture at a glance",
      body: "A single Fastify API serves a Next.js client over one Postgres instance.",
    },
    critical_paths: {
      title: "Files on the hot path",
      body: "These files sit on the path of nearly every request.",
    },
    run_locally: {
      title: "Getting a dev server running",
      body: "Install once, then start the API and the client.",
    },
    reading_path: {
      title: "Suggested reading order",
      body: "Start at the composition root, then follow the wiring outward.",
    },
    first_tasks: {
      title: "Good first tasks",
      body: "Signals picked from real markers in the repository.",
    },
  };
  return {
    kind,
    title: over.title ?? defaults[kind].title,
    body: over.body ?? defaults[kind].body,
    diagram: over.diagram ?? null,
    links: over.links ?? [],
  };
}

function emptyTour(): Onboarding {
  return {
    status: "ready",
    reason: null,
    generated_at: null,
    index: { files_indexed: 0, total_candidates: 0, bounded: false, status: "full" },
    sections: [],
  };
}

function skeletonTour(reason: NonNullable<Onboarding["reason"]>): Onboarding {
  return {
    status: "skeleton",
    reason,
    generated_at: null,
    index: { files_indexed: 0, total_candidates: 0, bounded: false, status: "full" },
    sections: [],
  };
}

function fullTour(over: Partial<Onboarding> = {}): Onboarding {
  // Sections deliberately given out of AC-9 order — the view must still
  // place cards in the fixed order, driven by `kind`, not by array position.
  return {
    status: "ready",
    reason: null,
    generated_at: "2026-08-18T12:00:00.000Z",
    index: { files_indexed: 128, total_candidates: 640, bounded: true, status: "partial" },
    sections: [
      section("first_tasks", {
        links: [link("src/modules/onboarding/service.ts", "TODO: add a retry for the stalled draft.")],
      }),
      section("run_locally", {
        links: [
          link("package.json", "pnpm install"),
          link("package.json", "pnpm dev"),
          link("docker-compose.yml", "docker compose up -d"),
        ],
      }),
      section("critical_paths", {
        links: [
          link("src/modules/index.ts", "Registers every feature module — the composition root."),
          link("src/platform/container.ts", "Builds the DI container every module reads from."),
          link("src/db/schema/repos.ts", "Defines the repos table other modules join against."),
        ],
      }),
      section("reading_path", {
        links: [
          link("src/server.ts", "Entry point — wires the HTTP server."),
          link("src/modules/index.ts", "Registers every feature module."),
        ],
      }),
      // Invalid on purpose (AC-12): does not start with a mermaid keyword, so
      // `MermaidDiagram` resolves to "invalid" synchronously, without ever
      // importing the real `mermaid` package.
      section("architecture_overview", { diagram: "just some prose, not a diagram" }),
    ],
    ...over,
  };
}

function renderView(messagesOverride: typeof messages = messages) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messagesOverride }}>
      <OnboardingTourView />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.tour = undefined;
  state.isLoading = false;
  state.isError = false;
  state.repoNotFound = false;
  state.generatePending = false;
  generateMutate.mockReset();
  refetch.mockReset();
});
afterEach(cleanup);

describe("OnboardingTourView", () => {
  // ---- AC-1: page surface -----------------------------------------------
  it("renders the tour page with its H1 title (AC-1)", () => {
    state.tour = fullTour();
    renderView();
    expect(screen.getByRole("heading", { level: 1, name: "Onboarding Tour" })).toBeInTheDocument();
  });

  // ---- AC-3: empty state, no auto-generation -----------------------------
  it("shows the empty state with a Generate button and never calls generate on mount (AC-3)", () => {
    state.tour = emptyTour();
    renderView();

    const buttons = screen
      .getAllByText("Generate onboarding tour")
      .map((el) => el.closest("button"))
      .filter((el): el is HTMLButtonElement => el != null);
    expect(buttons).toHaveLength(1);
    expect(generateMutate).not.toHaveBeenCalled();
  });

  it("clicking Generate from the empty state calls the mutation exactly once", () => {
    state.tour = emptyTour();
    renderView();
    const btn = screen
      .getAllByText("Generate onboarding tour")
      .map((el) => el.closest("button"))
      .find((el): el is HTMLButtonElement => el != null)!;
    fireEvent.click(btn);
    expect(generateMutate).toHaveBeenCalledOnce();
  });

  // ---- AC-24: skeleton distinct from the empty state ---------------------
  it("shows a skeleton state with a CTA distinct from the empty state, and never auto-calls generate (AC-24)", () => {
    state.tour = skeletonTour("not_indexed");
    renderView();

    expect(screen.getByText("Tour isn't ready yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    // Distinct from AC-3's empty state — the empty-state copy must not leak in.
    expect(screen.queryByText("Generate onboarding tour")).not.toBeInTheDocument();
    expect(generateMutate).not.toHaveBeenCalled();
  });

  // ---- AC-8: pending guards the CTA against a fast double click ----------
  it("disables Regenerate while pending, so a rerender between two clicks still yields exactly one mutate call (AC-8)", () => {
    state.tour = fullTour();
    const { rerender } = renderView();

    fireEvent.click(screen.getByText("Regenerate"));
    expect(generateMutate).toHaveBeenCalledOnce();

    // Reproduce the state transition a real `useMutation` makes synchronously
    // once `mutate()` is called, before a second click can land.
    state.generatePending = true;
    rerender(
      <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
        <OnboardingTourView />
      </NextIntlClientProvider>,
    );

    const btn = screen.getByText("Regenerating…").closest("button")!;
    expect(btn).toBeDisabled();

    fireEvent.click(btn);
    expect(generateMutate).toHaveBeenCalledOnce();
  });

  // ---- AC-6: subtitle facts ----------------------------------------------
  it("shows files_indexed / total_candidates / index status / generated_at under the title (AC-6)", () => {
    state.tour = fullTour();
    renderView();

    expect(screen.getByText(/128 of 640 code files indexed/)).toBeInTheDocument();
    expect(screen.getByText(/index partial/)).toBeInTheDocument();
    expect(screen.getByText(/generated/)).toBeInTheDocument();
    // The "—" fallback is only for a null `generated_at` (the empty state).
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  // ---- AC-7: Share link ---------------------------------------------------
  it("copies the current page URL and confirms it when Share link is clicked (AC-7)", () => {
    state.tour = fullTour();
    renderView();

    fireEvent.click(screen.getByText("Share link"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(window.location.href);
    expect(screen.getByRole("status")).toHaveTextContent("Link copied");
  });

  // ---- AC-10: five collapsible cards + a five-item, activity-tracking TOC ---
  it("renders all five sections as cards, in the fixed AC-9 order regardless of array order (AC-10)", () => {
    state.tour = fullTour();
    renderView();

    const order = ["architecture_overview", "critical_paths", "run_locally", "reading_path", "first_tasks"];
    const ids = Array.from(document.querySelectorAll("[data-section-kind]")).map((el) =>
      el.getAttribute("data-section-kind"),
    );
    expect(ids).toEqual(order);
  });

  it("renders a table of contents with five items whose active pointer follows the clicked section (AC-10)", () => {
    state.tour = fullTour();
    renderView();

    const nav = screen.getByRole("navigation", { name: "On this page" });
    const items = within(nav).getAllByRole("button");
    expect(items.map((el) => el.textContent)).toEqual([
      "Architecture overview",
      "Critical paths",
      "Run it locally",
      "Reading path",
      "First tasks",
    ]);
    expect(items[0]).toHaveAttribute("aria-current", "true");

    fireEvent.click(items[1]!);
    expect(items[1]).toHaveAttribute("aria-current", "true");
    expect(items[0]).not.toHaveAttribute("aria-current");
  });

  it("collapses and re-expands a section card, hiding and restoring its body (AC-10)", () => {
    state.tour = fullTour();
    renderView();

    const card = document.getElementById("onboarding-section-architecture_overview")!;
    const header = within(card).getByRole("button");
    const body = "A single Fastify API serves a Next.js client over one Postgres instance.";

    expect(screen.getByText(body)).toBeInTheDocument();
    expect(header).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(body)).not.toBeInTheDocument();

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(body)).toBeInTheDocument();
  });

  // ---- AC-12: invalid mermaid renders no diagram, no error graphic --------
  it("renders no diagram for an unparsable mermaid string, and no error graphic (AC-12)", () => {
    state.tour = fullTour(); // architecture_overview.diagram is invalid prose
    renderView();

    // Scope to the section's expandable panel, not the whole card — the card
    // header always renders its own chevron <svg>, unrelated to the diagram.
    const panel = document.getElementById("onboarding-section-architecture_overview-panel")!;
    expect(panel.querySelector("svg")).not.toBeInTheDocument();
    expect(screen.queryByText(/syntax error/i)).not.toBeInTheDocument();
  });

  // ---- AC-13 / AC-14: critical_paths rows, order + Open ------------------
  it("renders critical_paths rows in the given (rank-descending) order with a working Open link (AC-13, AC-14)", () => {
    state.tour = fullTour();
    renderView();

    const card = document.getElementById("onboarding-section-critical_paths")!;
    const rows = within(card).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("src/modules/index.ts"),
      expect.stringContaining("src/platform/container.ts"),
      expect.stringContaining("src/db/schema/repos.ts"),
    ]);

    const openLinks = within(card).getAllByRole("link");
    expect(openLinks).toHaveLength(3);
    expect(openLinks[0]).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/main/src/modules/index.ts",
    );
    expect(openLinks[0]).toHaveAttribute("target", "_blank");
    expect(openLinks[1]).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/main/src/platform/container.ts",
    );
  });

  it("does not render an Open link for reading_path rows (only critical_paths / architecture_overview do)", () => {
    state.tour = fullTour();
    renderView();

    const card = document.getElementById("onboarding-section-reading_path")!;
    expect(within(card).queryAllByRole("link")).toHaveLength(0);
    expect(within(card).getAllByRole("listitem")).toHaveLength(2);
  });

  // ---- AC-15: numbered run_locally commands, copy-only -------------------
  it("renders numbered run_locally commands with a copy button that writes to the clipboard and never executes anything (AC-15, AC-16)", () => {
    state.tour = fullTour();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderView();

    const card = document.getElementById("onboarding-section-run_locally")!;
    const list = within(card).getByRole("list");
    expect(list.tagName).toBe("OL");
    const rows = within(card).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("pnpm install"),
      expect.stringContaining("pnpm dev"),
      expect.stringContaining("docker compose up -d"),
    ]);

    const copyBtn = within(card).getByLabelText("Copy command: pnpm install");
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("pnpm install");
    // The only observable side effect of "copy" is the clipboard write — no
    // network call is made, i.e. nothing is sent anywhere to be executed.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(within(card).getByLabelText("Copied")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  // ---- AC-20: honest "no signals" copy, nothing invented ------------------
  it("shows the first_tasks section's own honest message and no fabricated links when no signals were found (AC-20)", () => {
    state.tour = fullTour({
      sections: [
        section("architecture_overview"),
        section("critical_paths"),
        section("run_locally"),
        section("reading_path"),
        section("first_tasks", {
          links: [],
          body: "No deterministic first-task signals were found in this repository.",
        }),
      ],
    });
    renderView();

    const card = document.getElementById("onboarding-section-first_tasks")!;
    // The honest message is the VIEW's own i18n copy, keyed off `links: []`
    // (code-enforced, AC-20) — it must appear even though the model body
    // says something else; and no task rows are fabricated.
    expect(within(card).getByText(messages.firstTasks.noSignals)).toBeInTheDocument();
    expect(within(card).queryAllByRole("listitem")).toHaveLength(0);
  });

  // ---- AC-38: model body is markdown, never raw executable HTML ----------
  it("renders a section body containing a <script> tag as escaped markdown, never as an executable element (AC-38)", () => {
    state.tour = fullTour({
      sections: [
        section("architecture_overview", {
          body: "Read this first.\n\n<script>alert(1)</script>\n\nThen check `src/index.ts`.",
        }),
        section("critical_paths"),
        section("run_locally"),
        section("reading_path"),
        section("first_tasks"),
      ],
    });
    renderView();

    expect(document.querySelector("script")).not.toBeInTheDocument();
    expect(screen.getByText("Read this first.")).toBeInTheDocument();
    expect(screen.getByText("Then check", { exact: false })).toBeInTheDocument();
  });

  // ---- AC-37: no default English literal survives an i18n key swap -------
  describe("AC-37 — every string comes from messages/en/onboarding.json", () => {
    // Every leaf message value, minus `{placeholder}` interpolation slots,
    // trimmed to non-trivial static text. A component that hardcodes a
    // fallback string instead of calling `t()` would still show one of these
    // even after every message key below is replaced by a sentinel.
    function meaningfulLiterals(node: unknown, out: string[] = []): string[] {
      if (typeof node === "string") {
        for (const seg of node.split(/\{[^}]+\}/)) {
          const trimmed = seg.trim();
          if (trimmed.length >= 4) out.push(trimmed);
        }
      } else if (node && typeof node === "object") {
        for (const v of Object.values(node as Record<string, unknown>)) meaningfulLiterals(v, out);
      }
      return out;
    }

    let sentinelCounter = 0;
    function sentinelize(node: unknown): unknown {
      if (typeof node === "string") return `SENTINEL_${sentinelCounter++}`;
      if (Array.isArray(node)) return node.map(sentinelize);
      if (node && typeof node === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = sentinelize(v);
        return out;
      }
      return node;
    }

    const bannedLiterals = meaningfulLiterals(messages);

    // Visible text + accessible-name/title attributes only — NOT raw
    // innerHTML. innerHTML also carries inline `style` values, SVG path data
    // and class names, any of which can coincidentally contain a short banned
    // word (e.g. a CSS transform) with nothing to do with i18n.
    function userFacingText(): string {
      const text = document.body.textContent ?? "";
      const attrs = Array.from(document.body.querySelectorAll("[aria-label], [title]"))
        .flatMap((el) => [el.getAttribute("aria-label"), el.getAttribute("title")])
        .filter((v): v is string => !!v);
      return [text, ...attrs].join(" \u241F ");
    }

    function assertNoDefaultLiteralOnScreen() {
      const haystack = userFacingText();
      const leaked = bannedLiterals.filter((literal) => haystack.includes(literal));
      expect(leaked).toEqual([]);
      // Prove the swap actually took effect rather than the view rendering blank.
      expect(haystack).toContain("SENTINEL_");
    }

    it("leaks no default literal in the full-tour state", () => {
      sentinelCounter = 0;
      state.tour = fullTour();
      renderView(sentinelize(messages) as typeof messages);
      assertNoDefaultLiteralOnScreen();
    });

    it("leaks no default literal in the empty state", () => {
      sentinelCounter = 0;
      state.tour = emptyTour();
      renderView(sentinelize(messages) as typeof messages);
      assertNoDefaultLiteralOnScreen();
    });

    it("leaks no default literal in the skeleton state", () => {
      sentinelCounter = 0;
      state.tour = skeletonTour("llm_failed");
      renderView(sentinelize(messages) as typeof messages);
      assertNoDefaultLiteralOnScreen();
    });
  });
});
