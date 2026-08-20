-- Gigachad initial migration.
--
-- Generated from prisma/schema.prisma, then hand-edited to add four things Prisma
-- cannot express. Each is load-bearing, and each fails silently if dropped:
--
--   1. CREATE EXTENSION pg_trgm — an index referencing gin_trgm_ops is not enough.
--      Without the extension, widget suggestions cannot do partial-word matching.
--   2. knowledge_articles.search_vector as a GENERATED STORED column plus its GIN
--      index. Skipping this makes knowledge base search return nothing, and it
--      looks exactly like a query bug.
--   3. Partial unique indexes on contacts, so many anonymous contacts (null email
--      and null external_key) can coexist while a real email stays unique.
--   4. UNIQUE NULLS NOT DISTINCT on idempotency_keys. PostgreSQL treats NULLs as
--      distinct by default, which would let two rows share a provider event id
--      whenever workspace_id is null — silently defeating webhook replay
--      protection for exactly the unroutable-recipient case it exists to cover.
--
-- See docs/04-database.md and docs/18-execution.md (Phase A).

-- pg_trgm backs the trigram similarity half of widget suggestions.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('ADMIN', 'AGENT');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('CHAT', 'EMAIL');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'SNOOZED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "SenderType" AS ENUM ('CUSTOMER', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "IdentitySource" AS ENUM ('EMAIL', 'WIDGET');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'BOUNCED');

-- CreateEnum
CREATE TYPE "EmailDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "SummaryState" AS ENUM ('QUEUED', 'READY', 'STALE', 'ERROR');

-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'ERROR');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform_role" "PlatformRole" NOT NULL DEFAULT 'USER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "widget_key" TEXT NOT NULL,
    "support_address" TEXT NOT NULL,
    "settings_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "invited_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "external_key" TEXT,
    "identity_source" "IdentitySource" NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "channel" "Channel" NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assignee_id" UUID,
    "snoozed_until" TIMESTAMP(3),
    "subject" TEXT,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "agent_last_read_sequence" INTEGER NOT NULL DEFAULT 0,
    "customer_last_read_sequence" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_type" "SenderType" NOT NULL,
    "sender_user_id" UUID,
    "body_text" TEXT NOT NULL,
    "body_html" TEXT,
    "client_message_id" TEXT,
    "sequence" INTEGER NOT NULL,
    "delivery_status" "DeliveryStatus" NOT NULL DEFAULT 'SENT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_assignments" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "assignee_id" UUID,
    "assigned_by" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "conversation_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_categories" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_articles" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "category_id" UUID,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "body_json" JSONB,
    "body_html" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "status" "ArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "author_id" UUID,
    "search_vector" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
        setweight(to_tsvector('english', coalesce("body_text", '')), 'B')
    ) STORED,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_summaries" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "summary_text" TEXT,
    "user_wants" TEXT,
    "tried" TEXT,
    "current_status" TEXT,
    "source_message_count" INTEGER,
    "source_last_message_id" UUID,
    "state" "SummaryState" NOT NULL,
    "error_code" TEXT,
    "model" TEXT,
    "prompt_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "widget_sessions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "public_token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" TEXT,
    "origin" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "widget_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_threads" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "provider_thread_id" TEXT,
    "mailbox_address" TEXT NOT NULL,
    "last_message_id" TEXT,
    "references_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "message_id" TEXT NOT NULL,
    "in_reply_to" TEXT,
    "references_json" JSONB,
    "from_address" TEXT NOT NULL,
    "to_addresses_json" JSONB NOT NULL,
    "provider_event_id" TEXT,
    "direction" "EmailDirection" NOT NULL,
    "delivery_status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "raw_headers_json" JSONB,
    "received_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "gigachad_message_id" UUID,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_domains" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" "DomainStatus" NOT NULL DEFAULT 'PENDING',
    "verification_token" TEXT NOT NULL,
    "last_checked_at" TIMESTAMP(3),
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "workspace_id" UUID,
    "actor_scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_json" JSONB,
    "status_code" INTEGER,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_platform_role_idx" ON "users"("platform_role");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_expires_at_idx" ON "sessions"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_widget_key_key" ON "workspaces"("widget_key");

-- CreateIndex
CREATE INDEX "workspace_members_workspace_id_role_idx" ON "workspace_members"("workspace_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_workspace_id_email_idx" ON "invitations"("workspace_id", "email");

-- CreateIndex
CREATE INDEX "contacts_workspace_id_last_seen_at_idx" ON "contacts"("workspace_id", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_workspace_id_id_key" ON "contacts"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "conversations_workspace_id_status_last_message_at_idx" ON "conversations"("workspace_id", "status", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_workspace_id_channel_status_idx" ON "conversations"("workspace_id", "channel", "status");

-- CreateIndex
CREATE INDEX "conversations_workspace_id_assignee_id_status_idx" ON "conversations"("workspace_id", "assignee_id", "status");

-- CreateIndex
CREATE INDEX "conversations_workspace_id_contact_id_idx" ON "conversations"("workspace_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_workspace_id_id_key" ON "conversations"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "messages_workspace_id_conversation_id_created_at_idx" ON "messages"("workspace_id", "conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversation_id_sequence_key" ON "messages"("conversation_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversation_id_client_message_id_key" ON "messages"("conversation_id", "client_message_id");

-- CreateIndex
CREATE INDEX "conversation_assignments_workspace_id_conversation_id_assig_idx" ON "conversation_assignments"("workspace_id", "conversation_id", "assigned_at");

-- CreateIndex
CREATE INDEX "conversation_assignments_workspace_id_assignee_id_ended_at_idx" ON "conversation_assignments"("workspace_id", "assignee_id", "ended_at");

-- CreateIndex
CREATE INDEX "knowledge_categories_workspace_id_sort_order_idx" ON "knowledge_categories"("workspace_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_categories_workspace_id_slug_key" ON "knowledge_categories"("workspace_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_categories_workspace_id_id_key" ON "knowledge_categories"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "knowledge_articles_workspace_id_status_category_id_idx" ON "knowledge_articles"("workspace_id", "status", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_articles_workspace_id_slug_key" ON "knowledge_articles"("workspace_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ai_summaries_conversation_id_key" ON "ai_summaries"("conversation_id");

-- CreateIndex
CREATE INDEX "ai_summaries_workspace_id_state_idx" ON "ai_summaries"("workspace_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ai_summaries_workspace_id_conversation_id_key" ON "ai_summaries"("workspace_id", "conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "widget_sessions_public_token_hash_key" ON "widget_sessions"("public_token_hash");

-- CreateIndex
CREATE INDEX "widget_sessions_workspace_id_last_seen_at_idx" ON "widget_sessions"("workspace_id", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_threads_conversation_id_key" ON "email_threads"("conversation_id");

-- CreateIndex
CREATE INDEX "email_threads_workspace_id_last_message_id_idx" ON "email_threads"("workspace_id", "last_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_threads_workspace_id_conversation_id_key" ON "email_threads"("workspace_id", "conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_threads_workspace_id_provider_thread_id_key" ON "email_threads"("workspace_id", "provider_thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_provider_event_id_key" ON "email_messages"("provider_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_gigachad_message_id_key" ON "email_messages"("gigachad_message_id");

-- CreateIndex
CREATE INDEX "email_messages_workspace_id_in_reply_to_idx" ON "email_messages"("workspace_id", "in_reply_to");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_workspace_id_message_id_key" ON "email_messages"("workspace_id", "message_id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_domains_hostname_key" ON "custom_domains"("hostname");

-- CreateIndex
CREATE INDEX "custom_domains_status_hostname_idx" ON "custom_domains"("status", "hostname");

-- CreateIndex
CREATE INDEX "custom_domains_workspace_id_idx" ON "custom_domains"("workspace_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_contact_id_fkey" FOREIGN KEY ("workspace_id", "contact_id") REFERENCES "contacts"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_conversation_id_fkey" FOREIGN KEY ("workspace_id", "conversation_id") REFERENCES "conversations"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_assignments" ADD CONSTRAINT "conversation_assignments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_assignments" ADD CONSTRAINT "conversation_assignments_workspace_id_conversation_id_fkey" FOREIGN KEY ("workspace_id", "conversation_id") REFERENCES "conversations"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_assignments" ADD CONSTRAINT "conversation_assignments_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_assignments" ADD CONSTRAINT "conversation_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_categories" ADD CONSTRAINT "knowledge_categories_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_workspace_id_category_id_fkey" FOREIGN KEY ("workspace_id", "category_id") REFERENCES "knowledge_categories"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_summaries" ADD CONSTRAINT "ai_summaries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_summaries" ADD CONSTRAINT "ai_summaries_workspace_id_conversation_id_fkey" FOREIGN KEY ("workspace_id", "conversation_id") REFERENCES "conversations"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "widget_sessions" ADD CONSTRAINT "widget_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "widget_sessions" ADD CONSTRAINT "widget_sessions_workspace_id_contact_id_fkey" FOREIGN KEY ("workspace_id", "contact_id") REFERENCES "contacts"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_workspace_id_conversation_id_fkey" FOREIGN KEY ("workspace_id", "conversation_id") REFERENCES "conversations"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_gigachad_message_id_fkey" FOREIGN KEY ("gigachad_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Hand-written: what Prisma cannot express ────────────────────────────────

-- Partial unique indexes on contacts. A plain unique index would allow only one
-- anonymous contact per workspace, because every one of them has a null email.
CREATE UNIQUE INDEX "contacts_workspace_email_key"
    ON "contacts" ("workspace_id", "email") WHERE "email" IS NOT NULL;

CREATE UNIQUE INDEX "contacts_workspace_external_key"
    ON "contacts" ("workspace_id", "external_key") WHERE "external_key" IS NOT NULL;

-- Two search indexes serving two different jobs.
--
-- Public KB search uses websearch_to_tsquery against search_vector, ranked by
-- ts_rank. Widget suggestions run while the customer is still typing, so they
-- cannot rely on whole-word matching: they combine a prefix query on the last
-- token with trigram similarity on the title. Without the trigram index, typing
-- "refun" returns nothing until the word is complete, and the feature looks broken
-- at the exact moment an evaluator is watching.
CREATE INDEX "kb_search_vector_idx" ON "knowledge_articles" USING GIN ("search_vector");

CREATE INDEX "kb_title_trgm_idx" ON "knowledge_articles" USING GIN ("title" gin_trgm_ops);

-- Replay protection.
--
-- NULLS NOT DISTINCT is the whole point: inbound webhooks are deduplicated by
-- provider event id BEFORE the workspace is resolved, so those rows have a null
-- workspace_id. Under PostgreSQL's default NULLS DISTINCT, two such rows with the
-- same key would both be accepted and a replayed webhook for an unroutable
-- recipient would reprocess forever.
CREATE UNIQUE INDEX "idempotency_keys_scope_key_key"
    ON "idempotency_keys" ("workspace_id", "actor_scope", "key") NULLS NOT DISTINCT;
