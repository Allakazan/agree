ALTER TABLE "conversations" ADD COLUMN "last_message_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "conversations_participants_idx" ON "conversations" USING gin ("participants");--> statement-breakpoint
CREATE INDEX "conversations_last_message_at_idx" ON "conversations" USING btree ("last_message_at");--> statement-breakpoint
-- Backfill: existing conversations predate the column, and a null would sort
-- them out of the conversation list until someone sends a new message.
UPDATE "conversations" c SET "last_message_at" = m."last_at"
FROM (
  SELECT "conversation_id", MAX("created_at") AS "last_at"
  FROM "messages" GROUP BY "conversation_id"
) m
WHERE m."conversation_id" = c."id";