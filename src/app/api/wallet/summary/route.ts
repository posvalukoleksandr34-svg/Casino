import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { walletSummary } from '@/server/wallet/wallet';

/** Cashier overview: available, reserved in play, locked bonus and lifetime totals, all from the ledger. */
export const GET = route({ name: 'wallet.summary', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async ({ session }) => walletSummary(session.userId));
