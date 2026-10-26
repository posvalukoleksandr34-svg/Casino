import { getDb } from '@/server/db/client';
import { route } from '@/server/http/handler';
import { getWalletAccount } from '@/server/ledger/accounts';
import { dailyBonusStatus } from '@/server/promotions/bonuses';

export const GET = route({ name: 'wallet.get', auth: 'user' }, async ({ session }) => {
  const db = getDb();
  const wallet = await getWalletAccount(db, session.userId);
  return { balance: wallet?.balance ?? 0, currency: 'CHIP', minorPerUnit: 100, dailyBonus: await dailyBonusStatus(db, session.userId) };
});
