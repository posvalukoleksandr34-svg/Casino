/**
 * Post-login destination from an untrusted `?next=` value. The value is
 * resolved exactly as the browser would (WHATWG URL rules: `\` counts as `/`,
 * tabs and newlines are dropped) and kept only if it stays on this origin, so
 * `/\evil.example` or `/<tab>/evil.example` cannot leave the site.
 */
export function safeNextPath(next: string | null | undefined, origin: string, fallback = '/lobby'): string {
  if (!next) return fallback;
  try {
    const url = new URL(next, origin);
    if (url.origin !== new URL(origin).origin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
