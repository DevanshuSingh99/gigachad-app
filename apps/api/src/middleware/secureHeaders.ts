import type { NextFunction, Request, Response } from 'express';

/**
 * Security response headers. Applied globally to every response from the API.
 *
 * CSP for HTML pages (public KB) is handled separately inside the Eta layout
 * template so the widget's frame-ancestors can be set per-workspace. Everything
 * here applies to JSON API responses and KB HTML alike.
 *
 * References: docs/09-security.md, OWASP Secure Headers Project.
 */
export function secureHeadersMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Prevents browsers from MIME-sniffing away from the declared content-type.
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // API responses must never be framed. KB HTML overrides this in its own CSP
  // via frame-ancestors (which takes precedence over X-Frame-Options when both
  // are present).
  res.setHeader('X-Frame-Options', 'DENY');

  // Limit referrer information to origin-only on cross-origin navigation,
  // and suppress it entirely on downgrade (HTTPS → HTTP).
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Disable features the API and KB pages never use.
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );

  // XSS auditor is deprecated but harmless; "0" disables the broken IE
  // version that could actually be exploited.
  res.setHeader('X-XSS-Protection', '0');

  next();
}
