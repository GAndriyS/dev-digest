ALTER TABLE "pr_brief" ADD COLUMN "head_sha" text;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "model" text;