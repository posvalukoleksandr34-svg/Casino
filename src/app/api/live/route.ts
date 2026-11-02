import { NextResponse } from 'next/server';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { liveSnapshot, liveStreams } from '@/server/live/feed';

export const dynamic = 'force-dynamic';

const PUSH_MS = 5_000;
/** Streams end after a few minutes; the browser's EventSource reconnects on its own. */
const STREAM_MS = 5 * 60_000;

/**
 * Server-sent events: a public snapshot (players online, recent notable wins
 * with opted-in names only, the latest table spin) every few seconds.
 * Read-only: nothing a client sends can change it. `?once=1` returns one
 * snapshot as JSON (used as a fallback and by tests).
 */
export const GET = route({ name: 'live.stream', auth: 'public', rateLimit: [RATE_LIMITS.liveIp] }, async ({ req }) => {
  if (req.nextUrl.searchParams.get('once') === '1') return liveSnapshot();
  if (liveStreams.open >= liveStreams.max) {
    return NextResponse.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Live feed is busy; try again shortly.' } }, { status: 503, headers: { 'Retry-After': '30' } });
  }
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let stop: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  liveStreams.open += 1;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        liveStreams.open -= 1;
        clearInterval(timer);
        clearTimeout(stop);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const send = async () => {
        if (closed) return;
        try {
          const snap = await liveSnapshot();
          if (!closed) controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`));
        } catch {
          if (!closed) controller.enqueue(encoder.encode(`: unavailable\n\n`));
        }
      };
      controller.enqueue(encoder.encode(`retry: 10000\n\n`));
      void send();
      timer = setInterval(send, PUSH_MS);
      stop = setTimeout(close, STREAM_MS);
      req.signal.addEventListener('abort', close);
    },
    cancel() {
      if (!closed) {
        closed = true;
        liveStreams.open -= 1;
        clearInterval(timer);
        clearTimeout(stop);
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});
