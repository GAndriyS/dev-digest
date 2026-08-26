import type { CaseOrigin } from "../../helpers";

export const MODAL_WIDTH = 640;

/** Rows for the input-diff textarea. */
export const DIFF_ROWS = 12;

/** Rows for the expected-output JSON textarea. */
export const EXPECTED_ROWS = 10;

/** AC-59 subtitle key per origin, keyed off `../../helpers.ts#caseOrigin()`
    (wave 2) — the three copies live in `messages/en/eval.json`'s
    `caseEditor.subtitle*` (wave 1, step 3), never hardcoded here. */
export const SUBTITLE_KEY: Record<CaseOrigin, string> = {
  accepted: "caseEditor.subtitleAccepted",
  dismissed: "caseEditor.subtitleDismissed",
  manual: "caseEditor.subtitleManual",
};
