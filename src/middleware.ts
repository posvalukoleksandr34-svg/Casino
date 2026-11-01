/**
 * Per-request Content-Security-Policy with a nonce for every page, so scripts
 * run only if the server emitted them: no 'unsafe-inline' for scripts. Next.js
 * reads the nonce from the request's CSP header and adds it to its own inline
 * bootstrap and chunk scripts (all pages render dynamically: the root layout
 * is force-dynamic). 'strict-dynamic' lets those trusted scripts load the
 * chunks they need. Styles keep 'unsafe-inline' (React style attributes), a
 * much smaller risk than script injection. API responses get the static
 * policy from next.config.ts.
 */
import { NextResponse, type NextRequest } from 'next/server';

export function contentSecurityPolicy(nonce: string, dev = process.env.NODE_ENV === 'development'): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

export function middleware(req: NextRequest) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));
  const csp = contentSecurityPolicy(nonce);
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  // Pages only: API routes and static assets keep the static policy.
  matcher: [
    {
      source: '/((?!api/|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
