import type { NextConfig } from 'next';

/**
 * Security headers applied to every response. Pages get a per-request,
 * nonce-based Content-Security-Policy from src/middleware.ts (no
 * 'unsafe-inline' scripts); the static policy below covers API responses and
 * static assets, which execute no inline scripts at all.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  // Lint runs as a separate CI step (npm run lint) so builds stay deterministic.
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ['pg', 'nodemailer'],
  // The app serves no optimised images (no next/image, no remote images). With
  // optimisation off, /_next/image is not served at all, removing the sharp /
  // libvips attack surface (cf. GHSA-2464-fhr4-w9xw, GHSA-cjq9-62q9-8jv4).
  images: { unoptimized: true },
  // Evaluated at BUILD time (Next.js bakes headers into the routes manifest), so
  // this HSTS header only appears when APP_URL is https:// during `next build`.
  // The TLS terminator should send HSTS regardless (deploy/nginx-tls.conf).
  async headers() {
    const headers = [...securityHeaders];
    if (process.env.NODE_ENV === 'production' && process.env.APP_URL?.startsWith('https://')) {
      headers.push({ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' });
    }
    const nonCsp = headers.filter((h) => h.key !== 'Content-Security-Policy');
    const csp = headers.find((h) => h.key === 'Content-Security-Policy')!;
    return [
      { source: '/:path*', headers: nonCsp },
      // Pages receive their nonce-based policy from the middleware; everything else gets this one.
      { source: '/api/:path*', headers: [csp] },
      { source: '/_next/static/:path*', headers: [csp] },
    ];
  },
};

export default nextConfig;
