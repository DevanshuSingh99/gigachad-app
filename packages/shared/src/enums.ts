import { z } from 'zod';

/** Enum values match the Prisma schema in apps/api/prisma/schema.prisma exactly. */

export const platformRole = z.enum(['SUPER_ADMIN', 'USER']);
export type PlatformRole = z.infer<typeof platformRole>;

export const workspaceRole = z.enum(['ADMIN', 'AGENT']);
export type WorkspaceRole = z.infer<typeof workspaceRole>;

export const memberStatus = z.enum(['ACTIVE', 'REMOVED']);
export type MemberStatus = z.infer<typeof memberStatus>;

export const channel = z.enum(['CHAT', 'EMAIL']);
export type Channel = z.infer<typeof channel>;

export const conversationStatus = z.enum(['OPEN', 'SNOOZED', 'RESOLVED']);
export type ConversationStatus = z.infer<typeof conversationStatus>;

export const senderType = z.enum(['CUSTOMER', 'AGENT', 'SYSTEM']);
export type SenderType = z.infer<typeof senderType>;

export const identitySource = z.enum(['EMAIL', 'WIDGET']);
export type IdentitySource = z.infer<typeof identitySource>;

export const deliveryStatus = z.enum(['PENDING', 'SENT', 'DELIVERED', 'FAILED', 'BOUNCED']);
export type DeliveryStatus = z.infer<typeof deliveryStatus>;

export const emailDirection = z.enum(['INBOUND', 'OUTBOUND']);
export type EmailDirection = z.infer<typeof emailDirection>;

export const articleStatus = z.enum(['DRAFT', 'PUBLISHED']);
export type ArticleStatus = z.infer<typeof articleStatus>;

export const summaryState = z.enum(['QUEUED', 'READY', 'STALE', 'ERROR']);
export type SummaryState = z.infer<typeof summaryState>;

export const domainStatus = z.enum(['PENDING', 'VERIFIED', 'ERROR']);
export type DomainStatus = z.infer<typeof domainStatus>;
