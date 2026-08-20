import { Worker } from 'bullmq';

import type { Db } from '../../../db';
import { unscoped } from '../../../db';
import { env, supportAddressFor } from '../../../env';

/**
 * Parses a formatted RFC-5321 address ("Name <email>" or plain "email") into
 * the `{ name?, email }` shape the provider interface expects.
 */
function parseMailAddress(addr: string): { email: string; name?: string } {
  const match = /^(.*?)\s*<([^>]+)>$/.exec(addr.trim());
  if (match && match[2]) {
    const name = (match[1] ?? '').trim();
    const email = match[2].trim();
    return name ? { email, name } : { email };
  }
  return { email: addr.trim() };
}
import { brevoProvider } from '../../../lib/email/provider';
import { EMAIL_SEND_QUEUE, type EmailSendJobData } from '../../../lib/email/queue';
import { logger } from '../../../lib/logger';
import { emitMessageUpdated } from '../../../realtime/emit';
import { syncMessageDeliveryStatus } from '../repo';
import type Redis from 'ioredis';

/** Ids needed both to update the linked inbox message and to emit afterward. */
interface DeliveryIds {
  emailMessageId: string;
  gigachadMessageId: string;
  workspaceId: string;
  conversationId: string;
}

/**
 * BullMQ worker that sends outbound email via the Brevo API.
 *
 * Registered in apps/api/src/worker.ts at boot. Jobs are enqueued by
 * modules/email/service.ts#createEmailReply after the DB transaction commits
 * (invariant 2 — persist before sending).
 *
 * Each job receives only committed IDs, fetches what it needs from the DB,
 * sends via Brevo, and updates the delivery status. Permanent failures mark
 * the EmailMessage as FAILED so the dashboard can surface the error.
 */
export function createEmailSendWorker(db: Db, connection: Redis): Worker<EmailSendJobData> {
  return new Worker<EmailSendJobData>(
    EMAIL_SEND_QUEUE,
    async (job) => {
      const { emailMessageId, gigachadMessageId, workspaceId, conversationId } = job.data;

      logger.info(
        { jobId: job.id, emailMessageId, workspaceId, conversationId },
        'email send job started',
      );

      const ids: DeliveryIds = { emailMessageId, gigachadMessageId, workspaceId, conversationId };

      if (!env.emailEnabled) {
        logger.warn({ emailMessageId }, 'email send skipped: BREVO_API_KEY not configured');
        await markFailed(db, ids, 'Email provider not configured.');
        return;
      }

      // Load the EmailMessage + thread context needed to compose the send request.
      const emailMsg = await unscoped('load email message for outbound send', () =>
        db.emailMessage.findFirst({
          where: { id: emailMessageId },
          select: {
            id: true,
            messageId: true,
            inReplyTo: true,
            referencesJson: true,
            fromAddress: true,
            toAddressesJson: true,
            message: {
              select: {
                bodyText: true,
                bodyHtml: true,
                conversation: {
                  select: {
                    subject: true,
                    workspaceId: true,
                    contact: { select: { email: true, name: true } },
                    workspace: { select: { slug: true } },
                    emailThread: { select: { mailboxAddress: true } },
                  },
                },
              },
            },
          },
        }),
      );

      if (!emailMsg) {
        logger.error({ emailMessageId }, 'email send job: EmailMessage not found');
        return;
      }

      const conv = emailMsg.message?.conversation;
      if (!conv) {
        logger.error({ emailMessageId }, 'email send job: linked conversation not found');
        return;
      }

      const toEmail = conv.contact.email;
      if (!toEmail) {
        logger.error({ emailMessageId, conversationId }, 'email send job: contact has no email');
        await markFailed(db, ids, 'Contact has no email address.');
        return;
      }

      const inboundAddress = supportAddressFor(conv.workspace.slug);
      const rawFrom = env.mailFrom ?? inboundAddress;
      // Parse "Name <email>" formatted address into structured fields.
      const fromParsed = parseMailAddress(rawFrom);
      const references = Array.isArray(emailMsg.referencesJson)
        ? (emailMsg.referencesJson as string[])
        : [];

      try {
        const result = await brevoProvider.sendEmail({
          to: [{ email: toEmail, name: conv.contact.name ?? undefined }],
          from: fromParsed,
          replyTo: { email: inboundAddress },
          subject: conv.subject ?? '(No Subject)',
          textContent: emailMsg.message?.bodyText ?? '',
          ...(emailMsg.message?.bodyHtml ? { htmlContent: emailMsg.message.bodyHtml } : {}),
          messageId: `<${emailMsg.messageId}>`,
          ...(emailMsg.inReplyTo ? { inReplyTo: `<${emailMsg.inReplyTo}>` } : {}),
          ...(references.length > 0 ? { references: references.map((r) => `<${r}>`) } : {}),
        });

        // Mark as SENT and store the provider's assigned message ID. Mirrors the
        // same status onto messages.delivery_status in the same operation — that
        // column, not email_messages', is what the dashboard's MessageDto reads
        // (modules/messages/repo.ts), so without this the badge would stay
        // whatever it defaulted to at insert time regardless of what actually
        // happened.
        await unscoped('update delivery status after successful send', () =>
          db.$transaction([
            db.emailMessage.update({
              where: { id: emailMessageId },
              data: {
                deliveryStatus: 'SENT',
                sentAt: new Date(),
                providerEventId: result.providerMessageId,
              },
            }),
            syncMessageDeliveryStatus(db, gigachadMessageId, 'SENT'),
          ]),
        );

        emitMessageUpdated(workspaceId, conversationId, {
          messageId: gigachadMessageId,
          conversationId,
          deliveryStatus: 'SENT',
        });

        logger.info(
          { emailMessageId, providerMessageId: result.providerMessageId },
          'email send job: sent successfully',
        );
      } catch (err) {
        logger.error({ err, emailMessageId }, 'email send job: provider error');
        // BullMQ will retry according to the queue's default job options
        // (3 attempts, exponential backoff). On the final attempt the job moves
        // to the failed set. We do not mark FAILED here so the retry can succeed;
        // the onFailed hook below marks it permanently.
        throw err;
      }
    },
    {
      connection,
      concurrency: 5,
    },
  );
}

/** Marks both delivery-status columns FAILED and emits, same reasoning as the SENT path above. */
async function markFailed(db: Db, ids: DeliveryIds, reason: string): Promise<void> {
  try {
    await unscoped('mark email message as failed', () =>
      db.$transaction([
        db.emailMessage.update({
          where: { id: ids.emailMessageId },
          data: { deliveryStatus: 'FAILED' },
        }),
        syncMessageDeliveryStatus(db, ids.gigachadMessageId, 'FAILED'),
      ]),
    );
    emitMessageUpdated(ids.workspaceId, ids.conversationId, {
      messageId: ids.gigachadMessageId,
      conversationId: ids.conversationId,
      deliveryStatus: 'FAILED',
    });
  } catch (err) {
    logger.error({ err, emailMessageId: ids.emailMessageId, reason }, 'email send job: could not mark as failed');
  }
}

/**
 * Called by the worker registration in worker.ts when a job exhausts all
 * retries so the EmailMessage is permanently marked FAILED.
 */
export async function onEmailSendFailed(
  db: Db,
  job: { data: EmailSendJobData } | undefined,
): Promise<void> {
  if (!job) return;
  const { emailMessageId, gigachadMessageId, workspaceId, conversationId } = job.data;
  await markFailed(
    db,
    { emailMessageId, gigachadMessageId, workspaceId, conversationId },
    'All retry attempts exhausted.',
  );
}
