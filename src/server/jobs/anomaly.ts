/**
 * Statistical anomaly detection. Flags games whose realised payouts deviate
 * from theory by more than `anomaly_z_threshold` standard deviations (default
 * 4, i.e. roughly a 1-in-15,000 event under correct operation), with a
 * minimum sample size so small samples do not trigger noise. Also flags
 * exposure close to limits and a thin house reserve.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { alerts } from '../db/schema';
import { gameMetrics, exposureByGame } from '../analytics/analytics';
import { getPlatformSettings, openExposure } from '../risk/risk-service';
import { accountBalance, systemAccountIds } from '../ledger/accounts';
import { logger } from '../observability/logger';

const MIN_ROUNDS = 200;

async function raise(alert: typeof alerts.$inferInsert): Promise<boolean> {
  const res = await getDb().insert(alerts).values(alert).onConflictDoNothing().returning({ id: alerts.id });
  if (res.length) logger.warn('alert raised', { kind: alert.kind, severity: alert.severity, gameId: alert.gameId });
  return res.length > 0;
}

export async function detectAnomalies(now = new Date()): Promise<number> {
  const db = getDb();
  const settings = await getPlatformSettings(db);
  const threshold = settings.anomalyZThreshold;
  const day = now.toISOString().slice(0, 10);
  const hour = now.toISOString().slice(0, 13);
  let raised = 0;

  const windows: { name: string; from?: Date }[] = [
    { name: '24h', from: new Date(now.getTime() - 86400_000) },
    { name: 'all-time' },
  ];
  for (const w of windows) {
    for (const g of await gameMetrics({ from: w.from })) {
      if (g.rounds < MIN_ROUNDS || g.zScore === null || Math.abs(g.zScore) < threshold) continue;
      const direction = g.zScore > 0 ? 'above' : 'below';
      if (
        await raise({
          kind: 'RTP_DEVIATION',
          severity: Math.abs(g.zScore) >= threshold * 1.5 ? 'CRITICAL' : 'WARNING',
          gameId: g.gameId,
          message: `${g.gameId}: payouts ${direction} theory by ${Math.abs(g.zScore).toFixed(1)}σ over ${w.name} (${g.rounds} rounds)`,
          details: {
            window: w.name,
            rounds: g.rounds,
            zScore: g.zScore,
            pValue: g.pValue,
            actualRtp: g.actualRtp,
            theoreticalRtp: g.theoreticalRtp,
          },
          dedupeKey: `rtp:${g.gameId}:${w.name}:${day}`,
        })
      )
        raised += 1;
    }
  }

  for (const e of await exposureByGame()) {
    if (e.limit > 0 && e.netExposure / e.limit >= 0.8) {
      if (
        await raise({
          kind: 'EXPOSURE_HIGH',
          severity: 'WARNING',
          gameId: e.gameId,
          message: `${e.gameId}: open exposure at ${((e.netExposure / e.limit) * 100).toFixed(0)}% of its limit`,
          details: { ...e },
          dedupeKey: `exposure:${e.gameId}:${hour}`,
        })
      )
        raised += 1;
    }
  }

  const ids = await systemAccountIds(db);
  const house = await accountBalance(db, ids.HOUSE_BANKROLL);
  const exposure = await openExposure(db);
  const headroom = house - exposure - settings.minHouseReserve;
  if (headroom < settings.minHouseReserve * 0.25) {
    if (
      await raise({
        kind: 'RESERVE_LOW',
        severity: headroom < 0 ? 'CRITICAL' : 'WARNING',
        message: `House reserve headroom is low (${headroom} minor units above the minimum)`,
        details: { house, exposure, minReserve: settings.minHouseReserve },
        dedupeKey: `reserve:${hour}`,
      })
    )
      raised += 1;
  }
  return raised;
}

export async function cleanupExpired(): Promise<void> {
  const db = getDb();
  await db.execute(sql`DELETE FROM idempotency_keys WHERE created_at < now() - interval '2 days'`);
  await db.execute(sql`DELETE FROM rate_limit_buckets WHERE window_start < now() - interval '1 day'`);
  await db.execute(sql`DELETE FROM sessions WHERE expires_at < now() - interval '30 days'`);
}
