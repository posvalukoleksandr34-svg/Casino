'use client';

/**
 * Browser API client. State-changing game requests carry an Idempotency-Key;
 * if the network drops or the server is briefly unavailable, the request is
 * retried with the *same* key, so the server either returns the original
 * result or performs the action exactly once — never twice.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> | null = null,
    public readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  /** Retries for network failures / 502–504 (only when safe: GET or idempotent). */
  retries?: number;
  signal?: AbortSignal;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const canRetry = method === 'GET' || Boolean(opts.idempotencyKey);
  const retries = canRetry ? (opts.retries ?? 2) : 0;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  for (let attempt = 0; ; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(path, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: opts.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      if (attempt < retries) {
        await sleep(300 * 2 ** attempt);
        continue;
      }
      throw new ApiError('NETWORK_ERROR', 'Connection problem. Your request may not have reached the server; it is safe to retry.', 0);
    }
    if ([502, 503, 504].includes(res.status) && attempt < retries) {
      const isJson = res.headers.get('content-type')?.includes('application/json');
      // A JSON 503 is a deliberate business answer (e.g. game suspended), not a transient fault.
      if (!isJson) {
        await sleep(300 * 2 ** attempt);
        continue;
      }
    }
    const type = res.headers.get('content-type') ?? '';
    const data: unknown = type.includes('application/json') ? await res.json().catch(() => null) : null;
    if (!res.ok) {
      const e = (data as { error?: { code?: string; message?: string; details?: Record<string, unknown>; requestId?: string } } | null)?.error;
      throw new ApiError(e?.code ?? `HTTP_${res.status}`, e?.message ?? `Request failed (${res.status})`, res.status, e?.details ?? null, e?.requestId ?? null);
    }
    return data as T;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
