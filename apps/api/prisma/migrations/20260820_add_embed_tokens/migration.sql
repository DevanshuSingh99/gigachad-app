-- Add embed_tokens table.
--
-- Each row is a per-domain widget embed key (`wk_embed_…`) scoped to one
-- workspace and one allowed origin. The widget session endpoint checks the
-- prefix to choose between the workspace-level key path (existing) and this
-- stricter per-domain path (new).

-- CreateTable
CREATE TABLE "embed_tokens" (
    "id"             UUID         NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id"   UUID         NOT NULL,
    "token"          TEXT         NOT NULL,
    "label"          TEXT         NOT NULL,
    "allowed_origin" TEXT         NOT NULL,
    "is_active"      BOOLEAN      NOT NULL DEFAULT true,
    "created_at"     TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMPTZ  NOT NULL,

    CONSTRAINT "embed_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "embed_tokens_token_key" ON "embed_tokens"("token");

-- CreateIndex
CREATE INDEX "embed_tokens_workspace_id_is_active_idx" ON "embed_tokens"("workspace_id", "is_active");

-- AddForeignKey
ALTER TABLE "embed_tokens"
    ADD CONSTRAINT "embed_tokens_workspace_id_fkey"
    FOREIGN KEY ("workspace_id")
    REFERENCES "workspaces"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
