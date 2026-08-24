-- Review annotations (L06)
--
-- A reviewer can leave one note per review: why they agreed with the agent, or
-- why they overrode it. The note travels with the review everywhere the review
-- is shown, and attachments (screenshots, log excerpts) hang off it.

ALTER TABLE "reviews" ADD COLUMN "annotation_text" text;
ALTER TABLE "reviews" ADD COLUMN "annotation_author_id" uuid;
ALTER TABLE "reviews" ADD COLUMN "annotated_at" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "annotation_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "review_id" uuid NOT NULL REFERENCES "reviews"("id") ON DELETE CASCADE,
  "file_name" text NOT NULL,
  "content_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "storage_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "annotation_attachments_review_idx"
  ON "annotation_attachments" ("review_id");

CREATE INDEX IF NOT EXISTS "reviews_annotated_at_idx"
  ON "reviews" ("annotated_at");
