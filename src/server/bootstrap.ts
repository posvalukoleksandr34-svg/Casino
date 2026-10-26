/**
 * Idempotent reference-data bootstrap, run after migrations: system ledger
 * accounts, platform settings, game rows, initial configuration versions,
 * default risk limits and the initial (virtual) house bankroll.
 */
import { eq } from 'drizzle-orm';
import { getGameModule } from '@/engine/games/registry';
import { withTransaction, type Tx } from './db/client';
import { gameConfigurations, games, ledgerTransactions, platformSettings, riskLimits } from './db/schema';
import { ensureSystemAccounts } from './ledger/accounts';
import { postTransaction } from './ledger/ledger';
import { catalogEntries } from './games/catalog';

const CHIP = 100;

export const DEFAULT_PLATFORM = {
  maxTotalExposure: 500_000_000 * CHIP,
  minHouseReserve: 100_000_000 * CHIP,
  maxPlayerBalance: 100_000_000 * CHIP,
  signupBonus: 10_000 * CHIP,
  dailyBonus: 1_000 * CHIP,
  dailyBonusMaxBalance: 5_000 * CHIP,
};

export const INITIAL_HOUSE_FUNDING = 1_000_000_000 * CHIP;

export async function bootstrap(): Promise<void> {
  await withTransaction(async (tx: Tx) => {
    const ids = await ensureSystemAccounts(tx);

    await tx
      .insert(platformSettings)
      .values({ id: 1, ...DEFAULT_PLATFORM })
      .onConflictDoNothing({ target: platformSettings.id });

    for (const entry of catalogEntries()) {
      const mod = getGameModule(entry.id);
      await tx
        .insert(games)
        .values({
          id: entry.id,
          name: mod.name,
          interactive: mod.interactive,
          status: entry.initialStatus,
          sortOrder: entry.sortOrder,
        })
        .onConflictDoNothing({ target: games.id });
      const [hasConfig] = await tx
        .select({ id: gameConfigurations.id })
        .from(gameConfigurations)
        .where(eq(gameConfigurations.gameId, entry.id))
        .limit(1);
      if (!hasConfig) {
        await tx.insert(gameConfigurations).values({
          gameId: entry.id,
          version: 1,
          config: mod.configSchema.parse(mod.defaultConfig),
          isActive: true,
        });
      }
      await tx
        .insert(riskLimits)
        .values({ gameId: entry.id, ...entry.limits })
        .onConflictDoNothing({ target: riskLimits.gameId });
    }

    const [funded] = await tx
      .select({ id: ledgerTransactions.id })
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.idempotencyKey, 'house-funding:initial'));
    if (!funded) {
      await postTransaction(tx, {
        type: 'HOUSE_FUNDING',
        idempotencyKey: 'house-funding:initial',
        description: 'Initial virtual house bankroll',
        postings: [
          { accountId: ids.ISSUANCE, amount: -INITIAL_HOUSE_FUNDING },
          { accountId: ids.HOUSE_BANKROLL, amount: INITIAL_HOUSE_FUNDING },
        ],
      });
    }
  });
}
