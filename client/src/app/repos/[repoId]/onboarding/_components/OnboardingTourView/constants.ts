import type { OnboardingSection } from "@devdigest/shared";

/**
 * Fixed section order the server guarantees on the wire (AC-9). Used to look
 * sections up by `kind` and to build the "ON THIS PAGE" table of contents
 * deterministically — never derived from whatever order `sections` happens to
 * carry.
 */
export const SECTION_KINDS: readonly OnboardingSection["kind"][] = [
  "architecture_overview",
  "critical_paths",
  "run_locally",
  "reading_path",
  "first_tasks",
];

/** Section kinds whose links render as file references with an `Open` button
    to GitHub (AC-13, AC-14). Everything else renders links as plain rows,
    except `run_locally` (rendered as copyable commands, never opened). */
export const OPEN_LINK_KINDS: ReadonlySet<OnboardingSection["kind"]> = new Set([
  "critical_paths",
  "architecture_overview",
]);

/** Skeleton rows shown while the tour loads. */
export const LOADING_ROWS = 4;

/** How long the "Copied" / "Link copied" confirmation stays visible. */
export const COPY_CONFIRM_MS = 1500;
