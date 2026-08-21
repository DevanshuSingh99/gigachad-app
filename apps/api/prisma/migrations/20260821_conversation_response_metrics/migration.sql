-- Adds durable response/resolution timing to conversations, so the
-- Analytics Dashboard can compute first-response and resolution times with a
-- cheap AVG/PERCENTILE_CONT instead of deriving them from message history on
-- every page load. Additive and nullable: no backfill, so conversations
-- created before this migration have no response/resolution timing data.
ALTER TABLE "conversations" ADD COLUMN "first_response_at" TIMESTAMP(3);
ALTER TABLE "conversations" ADD COLUMN "resolved_at" TIMESTAMP(3);

CREATE INDEX "conversations_workspace_id_created_at_idx" ON "conversations"("workspace_id", "created_at");
CREATE INDEX "conversations_workspace_id_resolved_at_idx" ON "conversations"("workspace_id", "resolved_at");
