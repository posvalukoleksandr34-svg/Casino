/**
 * Virtual-currency rewards. Every bonus is a BONUS_GRANTED ledger transaction
 * from the PROMOTIONS account (which may go negative; its balance is the
 * cumulative promotional cost used for NGR) plus a `bonuses` row whose
 * UNIQUE claim_key makes each grant exactly-once.
 */
import { and, desc, eq } from 'drizzle-orm';
import { formatChips } from '@/engine/money';
import { withTransaction, type Executor, type Tx } from '../db/client';
import { bonuses, users } from '../db/schema';
import { errors } from '../errors';
import { lockWalletAccount, systemAccountIds } from '../ledger/accounts';
import { postTransaction } from '../ledger/ledger';
import { getPlatformSettings } from '../risk/risk-service';
import { audit } from '../audit/audit';
import { getLimits } from '../responsible/limits';

async function grant(tx: Tx, userId: string, type: 'SIGNUP' | 'DAILY', claimKey: string, amount: number, walletId: number) {
  const ids = await systemAccountIds(tx);
  const posted = await postTransaction(tx, {
    type: 'BONUS_GRANTED',
    idempotencyKey: `bonus:${claimKey}`,
    userId,
    description: type === 'SIGNUP' ? 'Welcome chips' : 'Daily chips',
    postings: [
      { accountId: ids.PROMOTIONS, amount: -amount },
      { accountId: walletId, amount },
    ],
    metadata: { bonusType: type },
  });
  await tx.insert(bonuses).values({ userId, type, claimKey, amount, ledgerTransactionId: posted.id });
  return posted;
}

export async function grantSignupBonus(tx: Tx, userId: string): Promise<number> {
  const settings = await getPlatformSettings(tx);
  if (settings.signupBonus <= 0) return 0;
  const wallet = await lockWalletAccount(tx, userId);
  await grant(tx, userId, 'SIGNUP', `signup:${userId}`, settings.signupBonus, wallet.id);
  return settings.signupBonus;
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function dailyBonusStatus(tx: Executor, userId: string, now = new Date()) {
  const settings = await getPlatformSettings(tx);
  const [last] = await tx
    .select({ createdAt: bonuses.createdAt })
    .from(bonuses)
    .where(and(eq(bonuses.userId, userId), eq(bonuses.type, 'DAILY')))
    .orderBy(desc(bonuses.createdAt))
    .limit(1);
  const claimedToday = last ? utcDay(last.createdAt) === utcDay(now) : false;
  const next = new Date(`${utcDay(now)}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  // No play incentives while a player has chosen a break from play.
  const rg = await getLimits(tx, userId, now);
  const blockedReason = rg.selfExcludedUntil
    ? 'Daily chips are not offered while your account is self-excluded.'
    : rg.coolOffUntil
      ? 'Daily chips are not offered during a cool-off break.'
      : null;
  return {
    amount: settings.dailyBonus,
    maxBalance: settings.dailyBonusMaxBalance,
    claimedToday,
    nextAvailableAt: claimedToday ? next.toISOString() : now.toISOString(),
    blockedReason,
  };
}

/**
 * Daily top-up, available once per UTC day and only while the balance is
 * below the configured threshold, so it cannot be farmed into a large balance.
 */
export async function claimDailyBonus(userId: string, now = new Date()) {
  return withTransaction(async (tx) => {
    const wallet = await lockWalletAccount(tx, userId);
    // Re-checked under the wallet lock: a suspension that committed after the session check wins.
    const [account] = await tx.select({ status: users.status }).from(users).where(eq(users.id, userId));
    if (account?.status !== 'ACTIVE') throw errors.forbidden('This account cannot claim chips.');
    const status = await dailyBonusStatus(tx, userId, now);
    if (status.blockedReason) throw errors.responsible(status.blockedReason);
    if (status.amount <= 0) throw errors.conflict('Daily chips are currently unavailable');
    if (status.claimedToday) throw errors.conflict('Daily chips already claimed today', { nextAvailableAt: status.nextAvailableAt });
    if (wallet.balance >= status.maxBalance) {
      throw errors.conflict(`Daily chips are available when your balance is below ${formatChips(status.maxBalance)}`);
    }
    const posted = await grant(tx, userId, 'DAILY', `daily:${userId}:${utcDay(now)}`, status.amount, wallet.id);
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'bonus.daily_claimed', resourceType: 'bonus', resourceId: String(posted.id) });
    const walletEntry = posted.entries.find((e) => e.accountId === wallet.id);
    return { amount: status.amount, balance: walletEntry?.balanceAfter ?? wallet.balance + status.amount };
  });
}
