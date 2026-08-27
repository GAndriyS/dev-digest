/** Locale-neutral placeholder for a genuinely null metric (`citation_accuracy`)
    or cost — never "0.0 pt", which would read as a real, unchanged delta. */
export const NO_VALUE = "—";

/**
 * Above this many lines on either side the LCS table (O(n·m) cells) stops
 * being worth it; system prompts are prose, so this is a guard rail, not a
 * limit anyone should hit. Mirrors `MAX_DIFF_LINES` in the skill editor's
 * VersionsTab (`skills/[id]/_components/SkillEditor/_components/VersionsTab/
 * constants.ts`) — duplicated locally, per `frontend-ui-architecture`
 * (different route tree, may not import across `src/app/<a>/` → `src/app/<b>/`). */
export const MAX_DIFF_LINES = 1500;

/**
 * The four comparison cards, in render order (AC-72). One descriptor per card
 * so the **direction-of-improvement** rule lives in exactly one place: `cost`
 * is the odd one out — a rise in cost is a regression, so colouring a delta by
 * its SIGN would paint the worst outcome green. That inversion is the single
 * easiest thing in this dialog to get wrong twice, which is why it is a data
 * field read by one function (`deltaBadge`) rather than a branch repeated per
 * card.
 *
 * `color` is the card's own value colour — the same three tokens the rest of
 * this feature uses for recall / precision / citation; cost is neutral because
 * it is not one of the three scored metrics.
 */
export const COMPARE_METRICS = [
  { key: "recall", labelKey: "cards.recall", color: "var(--accent)", higherIsBetter: true, unit: "pt" },
  { key: "precision", labelKey: "cards.precision", color: "var(--ok)", higherIsBetter: true, unit: "pt" },
  {
    key: "citation_accuracy",
    labelKey: "cards.citation",
    color: "var(--warn)",
    higherIsBetter: true,
    unit: "pt",
  },
  {
    key: "cost_usd",
    labelKey: "cards.cost",
    color: "var(--text-primary)",
    higherIsBetter: false,
    unit: "usd",
  },
] as const;

export type CompareMetric = (typeof COMPARE_METRICS)[number];

/**
 * Direction glyphs as literal text, not `Icon.ArrowUp`/`ArrowDown`: the
 * agent page renders those SVGs `aria-hidden`, which would leave direction
 * carried by colour alone — exactly what the accessibility NFR forbids. A
 * text glyph is read out.
 */
export const DELTA_ARROW = { good: "▲", bad: "▼" } as const;

/** Tone → colour pair for a delta badge. `neutral` is a real state, not a
    fallback: a zero (or float-noise) delta must still render, without an
    arrow and without claiming a direction (AC-75). */
export const DELTA_TONE = {
  good: { fg: "var(--ok)", bg: "var(--ok-bg, rgba(34,197,94,0.12))" },
  bad: { fg: "var(--crit)", bg: "var(--crit-bg, rgba(239,68,68,0.12))" },
  neutral: { fg: "var(--text-muted)", bg: "var(--bg-hover)" },
} as const;

/** Row background/sign per diff kind — the only place the add/del colours
    are named for this modal. */
export const DIFF_COLORS = {
  add: { bg: "var(--ok-bg, rgba(34,197,94,0.12))", fg: "var(--ok)", sign: "+" },
  del: { bg: "var(--crit-bg, rgba(239,68,68,0.12))", fg: "var(--crit)", sign: "−" },
  context: { bg: "transparent", fg: "var(--text-secondary)", sign: " " },
} as const;
