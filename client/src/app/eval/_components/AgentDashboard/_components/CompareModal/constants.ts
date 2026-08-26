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

/** Row background/sign per diff kind — the only place the add/del colours
    are named for this modal. */
export const DIFF_COLORS = {
  add: { bg: "var(--ok-bg, rgba(34,197,94,0.12))", fg: "var(--ok)", sign: "+" },
  del: { bg: "var(--crit-bg, rgba(239,68,68,0.12))", fg: "var(--crit)", sign: "−" },
  context: { bg: "transparent", fg: "var(--text-secondary)", sign: " " },
} as const;
