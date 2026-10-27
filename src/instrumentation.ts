/**
 * Next.js instrumentation hook: runs once per server process. All work is
 * Node.js-only (src/instrumentation-node.ts). The import sits inside the
 * NEXT_RUNTIME check in the form Next.js eliminates from the edge bundle, so
 * `next dev` does not try to bundle the database driver for the edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startNodeServer } = await import('./instrumentation-node');
    startNodeServer();
  }
}
