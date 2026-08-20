import { Router } from 'express';

import { byIp, rateLimit } from '../lib/rateLimit';
import { logger } from '../lib/logger';
import * as domainRepo from '../modules/domains/repo';

/**
 * Caddy on-demand TLS ask endpoint.
 *
 * Called by Caddy on every first TLS handshake for an unknown hostname:
 *   GET /internal/tls/ask?domain=<hostname>
 *
 * Returns:
 *   200 — Caddy should issue a certificate for this hostname
 *   403 — Caddy should refuse (hostname not verified, or unknown)
 *
 * Security constraints (docs/09-security.md):
 *   - Approves ONLY hostnames with status = VERIFIED.
 *   - Rate-limited per caller IP (Caddy's container IP in production), plus a
 *     generous global backstop, to prevent this from becoming a
 *     certificate-issuance relay — Let's Encrypt will block the deployment
 *     if it is abused, taking every real custom domain down with it. Keyed by
 *     IP rather than the `domain` query param, since that param is fully
 *     attacker-controlled and a fresh value would otherwise get a fresh
 *     bucket every request.
 *   - Bound to the Docker-internal network in production (Caddyfile config).
 *     The route exists here for completeness and rate-limiting; the network
 *     boundary is the primary defence.
 */
export const tlsAskRouter = Router();

tlsAskRouter.get(
  '/tls/ask',
  rateLimit('tlsAsk', byIp),
  rateLimit('tlsAskGlobal', () => 'global'),
  async (req, res) => {
    const domain = req.query.domain;
    if (typeof domain !== 'string' || !domain) {
      res.status(400).end();
      return;
    }

    const row = await domainRepo.findDomainByHostname(domain);

    if (!row || row.status !== 'VERIFIED') {
      logger.warn({ domain, status: row?.status ?? 'not_found' }, 'tls/ask: refused');
      res.status(403).end();
      return;
    }

    logger.info({ domain }, 'tls/ask: approved');
    res.status(200).end();
  },
);
