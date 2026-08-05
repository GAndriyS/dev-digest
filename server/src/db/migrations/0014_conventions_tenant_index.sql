DROP INDEX "conventions_repo_idx";--> statement-breakpoint
CREATE INDEX "conventions_repo_idx" ON "conventions" USING btree ("workspace_id","repo_id");