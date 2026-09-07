ALTER TABLE "conversations" ADD COLUMN "dm_key" varchar;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "unique_dm_key" UNIQUE("dm_key");