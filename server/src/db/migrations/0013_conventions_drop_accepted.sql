-- Hand-added ahead of the generated DROP: carry the boolean's meaning into the
-- tri-state while the column still exists. `status` arrived in 0012 defaulting
-- to 'pending', so without this every row a user had already accepted reads as
-- "not looked at yet" — and the column that could prove otherwise is gone one
-- statement later. Safe to re-run; a no-op on the empty table this ships with.
UPDATE "conventions" SET "status" = 'accepted' WHERE "accepted" = true;--> statement-breakpoint
ALTER TABLE "conventions" DROP COLUMN "accepted";