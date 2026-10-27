/**
 * Outbound HTTP for data providers: timeout, bounded retries with backoff,
 * Retry-After on 429, per-provider request spacing (rate limit) and schema
 * validation. Errors and logs carry the provider and URL path only, never the
 * query string or headers (where API keys live).
 */
import type { z } from 'zod';
import { logger } from '../../observability/logger';

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status: number | null = null,
  ) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderError';
  }
}

const lastCall = new Map<string, number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchJsonOptions<T> {
  provider: string;
  url: URL;
  headers?: Record<string, string>;
  schema: z.ZodType<T>;
  timeoutMs?: number;
  retries?: number;
  /** Minimum spacing between calls to this provider from this process. */
  minIntervalMs?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}

export interface FetchJsonResult<T> {
  data: T;
  headers: Headers;
}

export async function fetchJson<T>(opts: FetchJsonOptions<T>): Promise<FetchJsonResult<T>> {
  const { provider, url } = opts;
  const where = `${url.host}${url.pathname}`;
  const retries = opts.retries ?? 2;
  const doFetch = opts.fetchImpl ?? fetch;
  for (let attempt = 0; ; attempt += 1) {
    const wait = (lastCall.get(provider) ?? 0) + (opts.minIntervalMs ?? 0) - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall.set(provider, Date.now());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8_000);
    let res: Response;
    try {
      res = await doFetch(url, { headers: { Accept: 'application/json', ...(opts.headers ?? {}) }, signal: controller.signal, redirect: 'error' });
    } catch (err) {
      clearTimeout(timer);
      const reason = (err as Error).name === 'AbortError' ? 'timed out' : 'network error';
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new ProviderError(provider, `${reason} calling ${where}`);
    }
    clearTimeout(timer);
    if (res.status === 429 || res.status >= 500) {
      if (attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 1_000 * 2 ** attempt);
        continue;
      }
      throw new ProviderError(provider, `HTTP ${res.status} from ${where}`, res.status);
    }
    if (!res.ok) throw new ProviderError(provider, `HTTP ${res.status} from ${where}`, res.status);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ProviderError(provider, `invalid JSON from ${where}`, res.status);
    }
    const parsed = opts.schema.safeParse(body);
    if (!parsed.success) {
      logger.warn('provider payload rejected', { provider, where, issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) });
      throw new ProviderError(provider, `unexpected payload from ${where}`, res.status);
    }
    return { data: parsed.data, headers: res.headers };
  }
}

/** Decimal odds (e.g. 2.15) to ×100 integers, rejecting values outside 1.01–1000. */
export function oddsToE2(decimal: number): number | null {
  if (!Number.isFinite(decimal)) return null;
  // Rounded down (never in the player's favour beyond the published price); the epsilon absorbs binary rounding (1.9 × 100 = 189.999…).
  const e2 = Math.floor(decimal * 100 + 1e-6);
  return e2 >= 101 && e2 <= 100_000 ? e2 : null;
}
