import { Prisma } from '@prisma/client';

/**
 * Checks whether a caught error is a unique-constraint violation touching a
 * specific field.
 *
 * Prisma reports the violated columns in `error.meta.target`, and the shape is
 * not consistent: sometimes an array of Prisma field names (`clientMessageId`),
 * sometimes the raw Postgres constraint name as one string
 * (`messages_conversation_id_client_message_id_key`) — snake_case, because @map
 * converts field names to snake_case columns. A plain substring check against
 * `clientmessageid` misses the snake_case form entirely, since the underscores
 * split it into separate words. Stripping `_`/`-` from both sides before
 * comparing (the same normalization the logger's redaction list uses) makes the
 * check independent of which shape Prisma happened to return.
 *
 * Found by load: a concurrent-duplicate-message test where the losing side of a
 * race fell through as a generic SLUG_TAKEN instead of being recognized as an
 * idempotent retry.
 */
export function isUniqueViolationOn(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  const normalize = (s: string) => s.toLowerCase().replace(/[_-]/g, '');
  const needle = normalize(field);
  return fields.some((f) => normalize(f).includes(needle));
}
