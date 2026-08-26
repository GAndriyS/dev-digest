ALTER TABLE "eval_cases" ADD COLUMN "expectation_kind" text;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_expectation_kind_ck" CHECK ("eval_cases"."expectation_kind" IS NULL OR "eval_cases"."expectation_kind" IN ('must_find', 'must_not_flag'));
--> statement-breakpoint
UPDATE "eval_cases" SET "expectation_kind" = CASE WHEN jsonb_typeof("expected_output"->'findings') = 'array' AND jsonb_array_length("expected_output"->'findings') > 0 THEN 'must_find' ELSE 'must_not_flag' END WHERE "owner_kind" = 'agent';