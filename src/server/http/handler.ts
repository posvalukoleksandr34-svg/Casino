/**
 * Wrapper for every API route handler. Responsibilities, in order:
 * request id → CSRF (Origin) check for state-changing methods → session
 * resolution → authentication/authorisation → rate limiting → handler →
 * uniform JSON error mapping, structured access log and metrics.
 */
import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { type z, ZodError } from 'zod';
import { GameRuleError } from '@/engine/games/types';
import { hasPermission, type Permission } from '../auth/rbac';
import { resolveSession, sessionCookieName, sessionCookieOptions, type SessionUser } from '../auth/sessions';
import { hashIp } from '../crypto';
import { env } from '../env';
import { AppError, errors } from '../errors';
import { captureError } from '../observability/errors';
import { logger } from '../observability/logger';
import { metrics } from '../observability/metrics';
import { consume, type RateLimitRule } from './rate-limit';

export type AuthMode = 'public' | 'optional' | 'user' | Permission;

export interface BaseContext<P> {
  req: NextRequest;
  params: P;
  requestId: string;
  ipHash: string | null;
  userAgent: string | null;
}

export interface PublicContext<P> extends BaseContext<P> {
  session: SessionUser | null;
}

export interface UserContext<P> extends BaseContext<P> {
  session: SessionUser;
}

type Ctx<A extends AuthMode, P> = A extends 'public' | 'optional' ? PublicContext<P> : UserContext<P>;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Client IP for rate limiting and audit hashing.
 *
 * Next.js only sets X-Forwarded-For when the client did not send one, so the
 * header is attacker-controlled unless a trusted reverse proxy sets it.
 * TRUST_PROXY_HOPS = number of trusted proxies in front of the app, each of
 * which appends (or overwrites with) the address it received the request
 * from; the client is the entry that many positions from the right. With 0
 * (no trusted proxy) forwarded headers are ignored and per-IP limits fall
 * back to a shared bucket — production must run behind a proxy (see
 * deploy/nginx.conf and docs/operations.md).
 */
export function clientIp(req: Pick<NextRequest, 'headers'>, hops = env().TRUST_PROXY_HOPS): string | null {
  if (hops <= 0) return null;
  const xff = req.headers.get('x-forwarded-for');
  if (!xff) return null;
  const list = xff
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const ip = list[list.length - hops];
  return ip && /^[0-9a-fA-F.:]{2,45}$/.test(ip) ? ip : null;
}

/**
 * CSRF defence for cookie-authenticated requests: a state-changing request is
 * accepted only if the browser says it comes from our own origin. Requests
 * without Origin/Sec-Fetch-Site (non-browser clients) carry no ambient
 * credentials and are not a CSRF vector. JSON-only bodies additionally force
 * a CORS preflight, which we never grant.
 */
export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get('origin');
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site') throw new AppError('CSRF_REJECTED', 'Cross-site request rejected');
  if (!origin) return;
  const allowed = new Set<string>([new URL(env().APP_URL).origin]);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) {
    const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');
    allowed.add(`${proto}://${host}`);
  }
  if (!allowed.has(origin)) throw new AppError('CSRF_REJECTED', 'Cross-site request rejected');
}

export async function readJson<T>(req: NextRequest, schema: z.ZodType<T>): Promise<T> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw errors.validation('Content-Type must be application/json');
  }
  const length = Number(req.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES) throw errors.validation('Request body too large');
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw errors.validation('Request body too large');
  let raw: unknown;
  try {
    raw = text.length ? JSON.parse(text) : {};
  } catch {
    throw errors.validation('Malformed JSON body');
  }
  return parseInput(schema, raw);
}

export function parseInput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw errors.validation('Invalid request', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data;
}

export function parseQuery<T>(req: NextRequest, schema: z.ZodType<T>): T {
  return parseInput(schema, Object.fromEntries(req.nextUrl.searchParams.entries()));
}

function errorResponse(err: unknown, requestId: string, route: string): NextResponse {
  let appErr: AppError;
  if (err instanceof AppError) appErr = err;
  else if (err instanceof ZodError) {
    appErr = errors.validation('Invalid request', { issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  } else if (err instanceof GameRuleError) appErr = new AppError('GAME_RULE', err.message, { rule: err.code, ...(err.details ?? {}) });
  else {
    captureError(err, { route, requestId });
    appErr = new AppError('INTERNAL', 'Something went wrong. No funds were moved by a failed request.');
  }
  const res = NextResponse.json(
    { error: { code: appErr.code, message: appErr.message, details: appErr.details ?? null, requestId } },
    { status: appErr.status },
  );
  if (appErr.code === 'RATE_LIMITED' && appErr.details?.retryAfterSeconds) {
    res.headers.set('Retry-After', String(appErr.details.retryAfterSeconds));
  }
  return res;
}

export function route<A extends AuthMode, P = Record<string, string>>(
  opts: { name: string; auth: A; rateLimit?: RateLimitRule[] },
  fn: (ctx: Ctx<A, P>) => Promise<unknown>,
) {
  return async (req: NextRequest, segment: { params: Promise<P> }): Promise<Response> => {
    const started = performance.now();
    const incoming = req.headers.get('x-request-id');
    const requestId = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    const ipHash = hashIp(clientIp(req));
    let response: Response;
    let userId: string | undefined;
    try {
      if (!SAFE_METHODS.has(req.method)) assertSameOrigin(req);
      const params = (await segment?.params) ?? ({} as P);
      let session: SessionUser | null = null;
      if (opts.auth !== 'public') {
        session = await resolveSession(req.cookies.get(sessionCookieName())?.value);
        if (!session && opts.auth !== 'optional') throw errors.unauthenticated();
        if (session && opts.auth !== 'optional' && opts.auth !== 'user' && !hasPermission(session.role, opts.auth as Permission)) {
          throw errors.forbidden();
        }
      }
      userId = session?.userId;
      for (const rule of opts.rateLimit ?? []) {
        const subject = rule.by === 'user' ? session?.userId : (ipHash ?? 'unidentified');
        if (subject) await consume(rule, subject);
      }
      const ctx = { req, params, requestId, ipHash, userAgent: req.headers.get('user-agent'), session } as Ctx<A, P>;
      const result = await fn(ctx);
      response = result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (err) {
      response = errorResponse(err, requestId, opts.name);
    }
    response.headers.set('X-Request-Id', requestId);
    if (!response.headers.has('Cache-Control')) response.headers.set('Cache-Control', 'no-store');
    const ms = performance.now() - started;
    metrics.inc('http_requests_total', { route: opts.name, method: req.method, status: String(response.status) });
    metrics.observe('http_request_duration_ms', { route: opts.name }, ms);
    logger.info('request', { requestId, route: opts.name, method: req.method, status: response.status, ms: Math.round(ms), userId });
    return response;
  };
}

export function withSessionCookie(res: NextResponse, token: string, expiresAt: Date): NextResponse {
  res.cookies.set(sessionCookieName(), token, sessionCookieOptions(expiresAt));
  return res;
}

export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(sessionCookieName(), '', { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
  return res;
}

export function idempotencyKeyFrom(req: NextRequest): string {
  const k = req.headers.get('idempotency-key');
  if (!k) throw errors.validation('Idempotency-Key header is required for this request');
  return k;
}
