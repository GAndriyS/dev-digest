/* Pure helpers for FindingsPopover — kept out of the component so the ordering,
   the markdown stripping and the placement math are unit-testable without a DOM
   render. */

import type { CSSProperties } from "react";
import type { FindingRecord } from "@devdigest/shared";

/** Worst-first, matching SEVERITY_ORDER on the detail page's findings panel. */
const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

/** How many findings the card lists before collapsing the rest into "and N more". */
export const POPOVER_LIMIT = 3;

/**
 * Worst severity first, then most-confident first. Does not mutate the input —
 * `findings` comes straight from a react-query cache.
 */
export function sortForPopover(findings: FindingRecord[]): FindingRecord[] {
  return [...findings].sort((a, b) => {
    const rank = (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99);
    return rank !== 0 ? rank : b.confidence - a.confidence;
  });
}

/**
 * Flatten inline markdown to plain text. The rationale is markdown, but it is
 * rendered inside a 2-line clamp: `<Markdown>` emits block elements that break
 * `-webkit-line-clamp`, so the popover shows text instead. Deliberately shallow
 * — this is a preview, and the full rationale is one click away on the card.
 */
export function stripMarkdownInline(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/`([^`]*)`/g, "$1") // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links / images → their text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // heading markers
    .replace(/^\s{0,3}>\s?/gm, "") // block quotes
    // Emphasis markers only when they sit on a word boundary — rationales are
    // full of snake_case identifiers (`sk_live_`, `head_sha`) and a naive
    // /_(.*?)_/ silently eats their underscores.
    //
    // `__bold__` is left ALONE on purpose: CommonMark reads it as emphasis, but
    // in review text a double-underscore token is far more often a dunder name
    // (`__init__`) than someone's bold. `**bold**` covers real emphasis.
    .replace(/(?<![\w*])\*\*([^*]+)\*\*(?!\w)/g, "$1") // **bold**
    .replace(/(?<![\w*])\*([^*\n]+)\*(?!\w)/g, "$1") // *italic*
    .replace(/(?<![\w_])_([^_\n]+)_(?!\w)/g, "$1") // _italic_
    .replace(/\s+/g, " ")
    .trim();
}

/** Width of the popover panel; also the basis for horizontal clamping. */
export const POPOVER_WIDTH = 380;
const GAP = 6;
const EDGE = 8;
/** Rough panel height, used only to decide whether to flip above the trigger. */
const ESTIMATED_HEIGHT = 280;

/**
 * Fixed-position coordinates for the panel, derived from the trigger's rect.
 *
 * `fixed` rather than `absolute` because the PR list rows live inside a card
 * with `overflow: hidden` (pulls/styles.ts `tableCard`), which would clip an
 * absolutely-positioned panel. Nothing between the trigger and the viewport
 * establishes a containing block (no transform/filter ancestors), so viewport
 * coordinates are the trigger's real screen position.
 */
export function placePopover(
  rect: { top: number; bottom: number; left: number },
  viewport: { width: number; height: number },
): CSSProperties {
  const left = Math.min(Math.max(rect.left, EDGE), Math.max(EDGE, viewport.width - POPOVER_WIDTH - EDGE));
  // Flip above when there is not enough room below AND more room above, so a row
  // near the bottom of a long list still shows its findings.
  const flip = rect.bottom + ESTIMATED_HEIGHT > viewport.height && rect.top > viewport.height - rect.bottom;
  return flip
    ? { position: "fixed", left, bottom: viewport.height - rect.top + GAP }
    : { position: "fixed", left, top: rect.bottom + GAP };
}
