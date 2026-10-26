/**
 * Structured JSON logger (one line per event on stdout/stderr). Sensitive
 * keys are redacted recursively so passwords, tokens, cookies and seeds can
 * never be written to logs by accident.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE = /pass(word)?|secret|token|cookie|authorization|seed|session|hash|api[-_]?key/i;
const ALLOWED = new Set(['serverSeedHash', 'requestHash']);

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL as Level | undefined) ?? 'info';
  return LEVELS[lvl] ?? LEVELS.info;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE.test(k) && !ALLOWED.has(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

function write(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (LEVELS[level] < threshold()) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(redact(fields) as Record<string, unknown>) });
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => write('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
};
