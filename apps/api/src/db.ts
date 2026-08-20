import { AsyncLocalStorage } from 'node:async_hooks';

import { PrismaClient } from '@prisma/client';

import { env } from './env';
import { logger } from './lib/logger';
import { TIMEOUTS } from '@gigachad/shared';

/**
 * The Prisma client, extended with a tenant-scope guard.
 *
 * Invariant 1 says every repository query carries a workspace predicate. Docs
 * call a filter that forgets it "the single highest-severity bug class in this
 * project, and invisible until two workspaces exist". Discipline alone does not
 * survive fifty query sites written under time pressure, so the guard enforces it
 * mechanically: any read, write, or delete on a tenant-owned model whose
 * predicate lacks `workspaceId` throws before it reaches the database.
 *
 * The escape hatch is `unscoped()`, which is deliberately verbose and greppable.
 * Every legitimate cross-tenant query — resolving a workspace from a slug,
 * looking up a session, deduplicating a webhook before the workspace is known —
 * has to name itself.
 */

/** Models carrying a `workspace_id` column. Kept in sync with prisma/schema.prisma. */
const TENANT_MODELS = new Set([
  'WorkspaceMember',
  'Invitation',
  'Contact',
  'Conversation',
  'Message',
  'ConversationAssignment',
  'KnowledgeCategory',
  'KnowledgeArticle',
  'AiSummary',
  'WidgetSession',
  'EmailThread',
  'EmailMessage',
  'CustomDomain',
]);

/**
 * Deliberately excluded:
 *   * User, Session, Workspace — no workspace_id; these are the tenant's own
 *     identity records.
 *   * IdempotencyKey — workspace_id is nullable by design, because an inbound
 *     webhook is deduplicated before the workspace is resolved.
 */

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);

const DATA_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

/**
 * True when `where` constrains the workspace at the top level or inside a
 * top-level AND. A predicate reached only through OR does not count: OR widens a
 * result set, so `{ OR: [{ workspaceId }, { somethingElse }] }` is not scoped.
 */
function hasWorkspacePredicate(where: unknown): boolean {
  if (!where || typeof where !== 'object') return false;
  const w = where as Record<string, unknown>;

  for (const key of Object.keys(w)) {
    // Prisma renders undefined as "no filter", so it must not count as scoping.
    if (key === 'workspaceId') return w[key] !== undefined && w[key] !== null;
    // Compound unique inputs are named after their fields, e.g. workspaceId_slug.
    if (key.startsWith('workspaceId_')) return w[key] !== undefined;
  }

  const and = w.AND;
  if (Array.isArray(and)) return and.some(hasWorkspacePredicate);
  if (and) return hasWorkspacePredicate(and);

  return false;
}

function hasWorkspaceData(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  if (Array.isArray(data)) return data.length > 0 && data.every(hasWorkspaceData);
  const d = data as Record<string, unknown>;
  if (d.workspaceId !== undefined && d.workspaceId !== null) return true;
  // Nested writes may connect the relation instead of setting the scalar.
  const workspace = d.workspace as Record<string, unknown> | undefined;
  return Boolean(workspace && (workspace.connect ?? workspace.connectOrCreate));
}

class TenantScopeError extends Error {
  constructor(model: string, operation: string) {
    super(
      `Unscoped query blocked: ${model}.${operation}() ran without a workspaceId ` +
        `predicate. Add workspaceId to the query, or wrap a genuinely ` +
        `cross-tenant read in unscoped('<reason>', ...). See src/db.ts.`,
    );
    this.name = 'TenantScopeError';
  }
}

const unscopedContext = new AsyncLocalStorage<{ reason: string }>();

/**
 * Runs `fn` with the tenant-scope guard suspended. Use only where a query is
 * legitimately cross-tenant, and say why in `reason` — the reason is logged at
 * debug level and is what makes these call sites auditable.
 */
export function unscoped<T>(reason: string, fn: () => Promise<T>): Promise<T> {
  return unscopedContext.run({ reason }, async () => {
    logger.debug({ unscopedReason: reason }, 'unscoped query');
    return fn();
  });
}

/**
 * Prisma's pool scales with CPU count and the API and worker each open their own,
 * which together exhaust postgres max_connections. `connection_limit` is set in
 * DATABASE_URL; the statement timeout is applied here so it cannot be forgotten
 * in an environment file.
 */
function withStatementTimeout(url: string, timeoutMs: number): string {
  if (url.includes('statement_timeout')) return url;
  const separator = url.includes('?') ? '&' : '?';
  const options = encodeURIComponent(`-c statement_timeout=${timeoutMs}`);
  return `${url}${separator}options=${options}`;
}

export interface PrismaOptions {
  /** 10s for the API, 30s for the worker (docs/16-errors-and-limits.md). */
  statementTimeoutMs?: number;
}

export function createPrismaClient(options: PrismaOptions = {}) {
  const statementTimeoutMs = options.statementTimeoutMs ?? TIMEOUTS.dbStatementAppMs;

  const base = new PrismaClient({
    datasourceUrl: withStatementTimeout(env.DATABASE_URL, statementTimeoutMs),
    // Query logging is deliberately off: Prisma logs bind parameters with the
    // query, which would put message and article bodies in the logs.
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

  base.$on('warn', (e) => logger.warn({ prisma: e.message }, 'prisma warning'));
  base.$on('error', (e) => logger.error({ prisma: e.message }, 'prisma error'));

  return base.$extends({
    name: 'tenant-scope-guard',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model) || unscopedContext.getStore()) {
            return query(args);
          }

          const a = (args ?? {}) as Record<string, unknown>;

          if (operation === 'upsert') {
            if (!hasWorkspacePredicate(a.where) || !hasWorkspaceData(a.create)) {
              throw new TenantScopeError(model, operation);
            }
          } else if (WHERE_OPERATIONS.has(operation)) {
            if (!hasWorkspacePredicate(a.where)) {
              throw new TenantScopeError(model, operation);
            }
          } else if (DATA_OPERATIONS.has(operation)) {
            if (!hasWorkspaceData(a.data)) {
              throw new TenantScopeError(model, operation);
            }
          }

          return query(args);
        },
      },
    },
  });
}

export type Db = ReturnType<typeof createPrismaClient>;

/**
 * A transaction handle. Repository functions accept `Db | Tx` so the same
 * function works inside and outside a transaction.
 */
export type Tx = Omit<Db, '$transaction' | '$connect' | '$disconnect' | '$on' | '$extends' | '$use'>;

export const db: Db = createPrismaClient();

/** Exported for the unit tests that cover the guard itself. */
export const __testing = { hasWorkspacePredicate, hasWorkspaceData, TenantScopeError };
