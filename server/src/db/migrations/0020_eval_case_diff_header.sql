-- L06 fix. `POST /findings/:id/eval-case` stored `pr_files.patch` RAW. GitHub's
-- patch is hunks-only; `parseUnifiedDiff` resolves a file path ONLY from a
-- `+++ ` line, so those diffs parsed to `files: []` and the citation-grounding
-- gate dropped every finding as uncited — a must_not_flag case could never fail
-- and a must_find case could never pass. Repair in place with the SAME three
-- header lines `diffFromPrFiles` has always reconstructed on the review path.
--
-- Only agent-owned rows, only those whose `source_finding_id` still resolves
-- (that column has no FK on purpose — see db/schema/eval.ts), and only those
-- with no `+++ ` header of their own. Anything that does not resolve is left
-- untouched deliberately: there is no path to synthesize, and the runner guard
-- shipped alongside now errors such a case loudly instead of passing it.
-- Self-guarding, therefore re-runnable.
UPDATE "eval_cases" AS c
SET "input_diff" =
      'diff --git a/' || f."file" || ' b/' || f."file" || chr(10) ||
      '--- a/' || f."file" || chr(10) ||
      '+++ b/' || f."file" || chr(10) ||
      c."input_diff"
FROM "findings" AS f
WHERE f."id" = c."source_finding_id"
  AND c."owner_kind" = 'agent'
  AND c."input_diff" IS NOT NULL
  AND btrim(c."input_diff") <> ''
  AND c."input_diff" NOT LIKE '+++ %'
  AND position(chr(10) || '+++ ' in c."input_diff") = 0;
