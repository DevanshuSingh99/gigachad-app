import type { DomainStatus } from '@gigachad/shared';

import { db, unscoped } from '../../db';
import type { WorkspaceScope } from '../../lib/repo';
import type { DomainRow } from './dto';

const DOMAIN_SELECT = {
  id: true,
  hostname: true,
  status: true,
  verificationToken: true,
  lastCheckedAt: true,
  errorCode: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function listDomains(scope: WorkspaceScope): Promise<DomainRow[]> {
  return db.customDomain.findMany({
    where: { workspaceId: scope.workspaceId },
    select: DOMAIN_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

export function findDomain(scope: WorkspaceScope, id: string): Promise<DomainRow | null> {
  return db.customDomain.findFirst({
    where: { id, workspaceId: scope.workspaceId },
    select: DOMAIN_SELECT,
  });
}

export function findDomainByHostname(hostname: string): Promise<DomainRow | null> {
  return unscoped('find domain by hostname for tls/ask', () =>
    db.customDomain.findFirst({
      where: { hostname },
      select: DOMAIN_SELECT,
    }),
  );
}

/** Minimal cross-workspace projection used only to decide whether a stale, unverified claim on a hostname may be reclaimed. Deliberately excludes the verification token. */
export interface DomainClaim {
  id: string;
  workspaceId: string;
  status: DomainStatus;
  createdAt: Date;
}

/**
 * Looks up any workspace's claim on a hostname, not just the caller's own.
 * Used by `addDomain` to detect a stale, never-verified `PENDING` row left by
 * a different workspace (see docs/09-security.md domain-squatting note) —
 * that decision is inherently cross-tenant, so it cannot be expressed as a
 * workspace-scoped query.
 */
export function findDomainClaimByHostname(hostname: string): Promise<DomainClaim | null> {
  return unscoped('check for a stale cross-workspace PENDING claim before creating a domain', () =>
    db.customDomain.findFirst({
      where: { hostname },
      select: { id: true, workspaceId: true, status: true, createdAt: true },
    }),
  );
}

/**
 * Deletes a stale `PENDING` claim belonging to another workspace so its
 * hostname can be reclaimed. Callers must have already verified the row is
 * `PENDING` and past the reclaim window — this function trusts its caller and
 * does not re-check, which is why it is not exposed outside this module's
 * `addDomain` reclaim path.
 */
export function deleteStalePendingClaim(id: string): Promise<void> {
  return unscoped('delete stale cross-workspace PENDING domain claim to allow reclaim', () =>
    db.customDomain.delete({ where: { id } }).then(() => undefined),
  );
}

export function createDomain(
  scope: WorkspaceScope,
  data: { hostname: string; verificationToken: string },
): Promise<DomainRow> {
  return db.customDomain.create({
    data: {
      workspaceId: scope.workspaceId,
      hostname: data.hostname,
      verificationToken: data.verificationToken,
      status: 'PENDING',
    },
    select: DOMAIN_SELECT,
  });
}

export function updateDomainStatus(
  scope: WorkspaceScope,
  id: string,
  status: 'VERIFIED' | 'ERROR',
  errorCode: string | null,
): Promise<DomainRow> {
  return db.customDomain.update({
    where: { id, workspaceId: scope.workspaceId },
    data: { status, errorCode, lastCheckedAt: new Date() },
    select: DOMAIN_SELECT,
  });
}

export function deleteDomain(scope: WorkspaceScope, id: string): Promise<void> {
  return db.customDomain.delete({ where: { id, workspaceId: scope.workspaceId } }).then(() => undefined);
}
