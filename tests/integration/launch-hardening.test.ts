/**
 * Regression tests for defects and gaps fixed in the public-launch pass that
 * have no better home: virtual-chip grants cannot reach a player on a break.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { adjustBalance, grantChips } from '@/server/admin/wallet';
import { getDb, withTransaction } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { getWalletAccount } from '@/server/ledger/accounts';
import { selfExclude, startCoolOff } from '@/server/responsible/limits';
import { key, newPlayer } from './helpers';

const code = (e: unknown) => (e instanceof AppError ? e.code : String(e));

async function owner() {
  const p = await newPlayer('lho');
  await getDb().update(users).set({ role: 'OWNER' }).where(eq(users.id, p.userId));
  return { adminId: p.userId, ipHash: null, requestId: key() };
}

describe('grants respect responsible-play breaks', () => {
  it('no chips can be granted during a cool-off or self-exclusion; corrections stay possible', async () => {
    const ctx = await owner();
    const cool = await newPlayer('lhc');
    await withTransaction((tx) => startCoolOff(tx, cool.userId, 24));
    const err = await grantChips(ctx, cool.userId, 1_000, 'Grant during cool-off', key()).catch((e) => e);
    expect(code(err)).toBe('CONFLICT');
    expect((err as AppError).details?.reason).toBe('responsible_break');

    const excluded = await newPlayer('lhx');
    await withTransaction((tx) => selfExclude(tx, excluded.userId, 6));
    expect(code(await grantChips(ctx, excluded.userId, 1_000, 'Grant during exclusion', key()).catch((e) => e))).toBe('CONFLICT');
    const before = (await getWalletAccount(getDb(), excluded.userId))!.balance;
    // A compensating correction is not an incentive and stays possible (it is four-eyes over HTTP).
    await adjustBalance(ctx, excluded.userId, -100, 'Correct an erroneous credit', key());
    expect((await getWalletAccount(getDb(), excluded.userId))!.balance).toBe(before - 100);
  });
});
