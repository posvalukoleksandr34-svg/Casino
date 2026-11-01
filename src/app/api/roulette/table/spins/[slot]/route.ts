import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { revealTableSpin } from '@/server/games/roulette-table';
import { errors } from '@/server/errors';

/**
 * Reveals a table (spectator) spin once its betting window has closed and
 * records it in the public history. Not a wager: no session, round, ledger
 * entry or balance is involved.
 */
export const GET = route<'public', { slot: string }>({ name: 'roulette.table.spin', auth: 'public', rateLimit: [RATE_LIMITS.tableIp] }, async ({ params }) => {
  if (!/^\d{1,12}$/.test(params.slot)) throw errors.validation('Invalid spin');
  return { spin: await revealTableSpin(Number(params.slot)), serverNow: new Date().toISOString() };
});
