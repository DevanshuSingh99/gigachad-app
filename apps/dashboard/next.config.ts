import type { NextConfig } from 'next';

/**
 * Static export. The dashboard is an authenticated, per-tenant SPA: every screen
 * is dynamic and none of it benefits from server rendering, so it ships as static
 * files to Cloudflare Pages. That removes a Next.js process from a 1 vCPU VM
 * entirely, and it is what makes building the API image on that VM safe — the
 * memory-hungry React build happens on Pages instead.
 *
 * The cost, accepted deliberately: the dashboard is cross-origin to the API, so
 * CORS and cookie scoping have to be right. See docs/11-tradeoffs.md.
 */
const nextConfig: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  // No Next.js server means no image optimizer.
  images: { unoptimized: true },
  // Cloudflare Pages serves /path as /path/index.html.
  trailingSlash: true,
};

export default nextConfig;
