import { OnboardingSection } from "@devdigest/shared";

/**
 * Fixed section order the server guarantees on the wire (AC-9). Used to look
 * sections up by `kind` and to build the "ON THIS PAGE" table of contents
 * deterministically — never derived from whatever order `sections` happens to
 * carry.
 *
 * Derived from the wire enum rather than retyped: the enum's declaration order
 * IS the AC-9 order, so a sixth kind added server-side cannot silently fail to
 * render here.
 */
export const SECTION_KINDS = OnboardingSection.shape.kind.options;

/** Section kinds whose links render as file references with an `Open` button
    to GitHub (AC-13, AC-14). Everything else renders links as plain rows,
    except `run_locally` (rendered as copyable commands, never opened). */
export const OPEN_LINK_KINDS: ReadonlySet<(typeof SECTION_KINDS)[number]> = new Set([
  "critical_paths",
  "architecture_overview",
]);

/** Skeleton rows shown while the tour loads. */
export const LOADING_ROWS = 4;

/** How long the "Copied" / "Link copied" confirmation stays visible. */
export const COPY_CONFIRM_MS = 1500;
