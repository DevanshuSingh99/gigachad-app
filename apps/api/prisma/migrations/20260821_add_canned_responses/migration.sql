-- Add canned_responses table (S2 stretch feature).
--
-- Canned responses are workspace-scoped saved reply templates.
-- `shortcut` is optional; when set it must be unique within the workspace
-- and lets agents trigger the response by typing /shortcut in the composer.

-- CreateTable
CREATE TABLE "canned_responses" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID         NOT NULL,
    "name"         TEXT         NOT NULL,
    "content"      TEXT         NOT NULL,
    "shortcut"     TEXT,
    "tags"         JSONB        NOT NULL DEFAULT '[]',
    "created_by"   UUID,
    "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMPTZ  NOT NULL,

    CONSTRAINT "canned_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: workspace list (most common query)
CREATE INDEX "canned_responses_workspace_id_idx"
    ON "canned_responses"("workspace_id");

-- CreateIndex: shortcut lookup is unique per workspace, nulls allowed to coexist
CREATE UNIQUE INDEX "canned_responses_workspace_id_shortcut_key"
    ON "canned_responses"("workspace_id", "shortcut")
    WHERE "shortcut" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "canned_responses"
    ADD CONSTRAINT "canned_responses_workspace_id_fkey"
    FOREIGN KEY ("workspace_id")
    REFERENCES "workspaces"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

ALTER TABLE "canned_responses"
    ADD CONSTRAINT "canned_responses_created_by_fkey"
    FOREIGN KEY ("created_by")
    REFERENCES "users"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
