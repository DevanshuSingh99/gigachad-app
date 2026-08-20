import crypto from 'node:crypto';
import dns from 'node:dns/promises';

import type { AddDomainInput, DomainDto } from '@gigachad/shared';
import { isIpLiteral, RESERVED_SLUGS } from '@gigachad/shared';

import { env } from '../../env';
import { AppError, notFound } from '../../lib/errors';
import type { WorkspaceScope } from '../../lib/repo';
import { requireFound } from '../../lib/repo';
import { logger } from '../../lib/logger';
import { domainDto } from './dto';
import * as repo from './repo';

// ─── Reserved / forbidden hostname patterns ────────────────────────────────────

/**
 * Platform hostnames that must never be verified as custom domains. Also used
 * by app.ts to decide whether an incoming Host header could possibly be a
 * verified customer domain (anything not in this set) versus the platform's
 * own API/dashboard/KB traffic.
 */
export function platformHostnames(): Set<string> {
  const hosts = new Set<string>();
  const addUrl = (raw: string) => {
    try { hosts.add(new URL(raw).hostname); } catch { /* ignore */ }
  };
  addUrl(env.API_URL);
  addUrl(env.DASHBOARD_ORIGIN);
  hosts.add(env.KB_HOST);
  hosts.add(env.KB_CNAME_TARGET);
  return hosts;
}

/**
 * Registrable-domain approximation for a hostname: its last two labels (e.g.
 * `api.gigachad.com` → `gigachad.com`). A simplification — it does not know
 * about multi-part public suffixes like `.co.uk` — but the platform's own
 * hostnames are configured by us, not attacker-controlled, so it only needs
 * to be correct for the handful of hostnames in `platformHostnames()`.
 */
function apexOf(host: string): string {
  const labels = host.split('.');
  return labels.length <= 2 ? host : labels.slice(-2).join('.');
}

/**
 * True when `lower` is the platform's own apex, or a subdomain of it — i.e.
 * this hostname lives in a namespace the platform itself controls, as opposed
 * to a customer's own arbitrary domain (`app.contoso.com` shares no apex with
 * the platform and is none of the platform's business to reserve labels on).
 */
function isPlatformOwnedNamespace(lower: string): boolean {
  const apexes = new Set(Array.from(platformHostnames(), apexOf));
  return Array.from(apexes).some((apex) => lower === apex || lower.endsWith(`.${apex}`));
}

/**
 * Validates a hostname before creating a domain row.
 * Throws `DOMAIN_INVALID` for any forbidden value so the error is clear
 * without leaking information about internal topology.
 */
function assertSafeHostname(h: string): void {
  const lower = h.toLowerCase();

  if (lower === 'localhost' || lower.endsWith('.localhost')) {
    throw new AppError('DOMAIN_INVALID', { message: 'localhost is not allowed.' });
  }
  if (isIpLiteral(lower)) {
    throw new AppError('DOMAIN_INVALID', { message: 'IP addresses are not allowed.' });
  }

  // Private and link-local labels (RFC 1918, RFC 4193, link-local).
  const privateSuffixes = ['.local', '.internal', '.intranet', '.lan', '.corp', '.home'];
  if (privateSuffixes.some((s) => lower.endsWith(s))) {
    throw new AppError('DOMAIN_INVALID', { message: 'Private or reserved hostnames are not allowed.' });
  }

  // Platform hostnames.
  if (platformHostnames().has(lower)) {
    throw new AppError('DOMAIN_INVALID', {
      message: 'That hostname belongs to this platform.',
    });
  }

  // Reserved slug labels (e.g. api.*, app.*, mail.* under the PLATFORM'S OWN
  // apex only — a customer's own domain, like app.contoso.com, is theirs to
  // name however they like and has nothing to do with this platform's
  // reserved subdomain namespace).
  if (isPlatformOwnedNamespace(lower)) {
    const label = lower.split('.')[0] ?? '';
    if (RESERVED_SLUGS.has(label)) {
      throw new AppError('DOMAIN_INVALID', {
        message: `The label "${label}" is reserved.`,
      });
    }
  }
}

// ─── Service functions ─────────────────────────────────────────────────────────

export async function listDomains(scope: WorkspaceScope): Promise<DomainDto[]> {
  return (await repo.listDomains(scope)).map(domainDto);
}

/**
 * How long an unverified `PENDING` claim on a hostname blocks every other
 * workspace from claiming it. `hostname` is globally unique (correct — two
 * workspaces cannot simultaneously verify the same hostname), but with no TTL
 * a `PENDING` row that never gets its DNS records set up — whether the
 * claimant wasn't the real owner, or just gave up — would squat on the
 * hostname forever and permanently block the real owner. 48h is generous
 * enough for a legitimate owner to add DNS records and hit "verify", while
 * bounding how long a squat can block the real owner.
 */
const PENDING_CLAIM_RECLAIM_MS = 48 * 60 * 60 * 1000;

export async function addDomain(
  scope: WorkspaceScope,
  input: AddDomainInput,
): Promise<DomainDto> {
  assertSafeHostname(input.hostname);

  // Reclaim a stale, never-verified claim left by a DIFFERENT workspace, so it
  // cannot squat on the hostname forever. A VERIFIED row, a PENDING row still
  // within the reclaim window, or a PENDING row owned by this SAME workspace
  // are all left alone and fall through to the existing unique-constraint
  // error from `createDomain` below.
  const existingClaim = await repo.findDomainClaimByHostname(input.hostname);
  if (
    existingClaim &&
    existingClaim.workspaceId !== scope.workspaceId &&
    existingClaim.status === 'PENDING' &&
    Date.now() - existingClaim.createdAt.getTime() > PENDING_CLAIM_RECLAIM_MS
  ) {
    await repo.deleteStalePendingClaim(existingClaim.id);
  }

  const token = `gigachad-verify=${crypto.randomBytes(16).toString('hex')}`;
  const row = await repo.createDomain(scope, {
    hostname: input.hostname,
    verificationToken: token,
  });
  return domainDto(row);
}

export async function deleteDomain(scope: WorkspaceScope, id: string): Promise<void> {
  requireFound(await repo.findDomain(scope, id), 'domain');
  await repo.deleteDomain(scope, id);
}

/**
 * Verifies both DNS records with a 5s timeout per lookup.
 *
 * Two checks:
 *   1. CNAME: `{hostname}` → must ultimately resolve to `KB_CNAME_TARGET`
 *   2. TXT:   `_gigachad.{hostname}` → must contain `verificationToken`
 *
 * Sets VERIFIED only when both pass. Sets ERROR with a reason otherwise.
 */
export async function verifyDomain(scope: WorkspaceScope, id: string): Promise<DomainDto> {
  const row = requireFound(await repo.findDomain(scope, id), 'domain');

  const resolver = new dns.Resolver({ timeout: 5_000 });

  let cnameOk = false;
  let txtOk = false;
  let reason: string | null = null;

  // ── CNAME check ────────────────────────────────────────────────────────────
  try {
    const cnameRecords = await resolver.resolveCname(row.hostname);
    cnameOk = cnameRecords.some(
      (r) => r.toLowerCase().replace(/\.$/, '') === env.KB_CNAME_TARGET.toLowerCase(),
    );
    if (!cnameOk) {
      reason = `CNAME not found. Expected ${env.KB_CNAME_TARGET}, got: ${cnameRecords.join(', ')}`;
    }
  } catch (err) {
    logger.warn({ err, hostname: row.hostname }, 'domain verify: CNAME lookup failed');
    reason = 'CNAME record not found.';
  }

  // ── TXT check ──────────────────────────────────────────────────────────────
  if (cnameOk) {
    const txtName = `_gigachad.${row.hostname}`;
    try {
      const txtRecords = await resolver.resolveTxt(txtName);
      txtOk = txtRecords.flat().some((v) => v === row.verificationToken);
      if (!txtOk) {
        reason = `TXT record at ${txtName} not found or value mismatch.`;
      }
    } catch (err) {
      logger.warn({ err, txtName }, 'domain verify: TXT lookup failed');
      reason = `TXT record at ${txtName} not found.`;
    }
  }

  const status = cnameOk && txtOk ? 'VERIFIED' : 'ERROR';
  const updated = await repo.updateDomainStatus(scope, id, status, reason);
  return domainDto(updated);
}
