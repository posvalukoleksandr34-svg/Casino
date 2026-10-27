/**
 * Development helper: plays rounds as demo players through the same service
 * layer the API uses, so dashboards have data. Refuses to run in production.
 * Usage: npx tsx scripts/demo-activity.ts [rounds=2000]
 */
import './load-env';
import { randomUUID } from 'node:crypto';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('demo activity is for development only');
  const n = Number(process.argv[2] ?? 2000);
  const { createOperatorAccount } = await import('../src/server/users/accounts');
  const { startRound } = await import('../src/server/games/round-service');
  const { closeDb } = await import('../src/server/db/client');
  const players: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const tag = `demo${Date.now().toString(36)}${i}`;
    const res = await createOperatorAccount({ email: `${tag}@example.test`, username: tag, password: 'demo activity password' }, { ipHash: null, userAgent: 'demo' }, { onboarding: 'exempt' });
    players.push(res.user.id);
  }
  let done = 0;
  let rejected = 0;
  for (let i = 0; i < n; i += 1) {
    const userId = players[i % players.length]!;
    const pick = i % 5;
    const bet =
      pick === 0
        ? { gameId: 'roulette', bet: { bets: [{ type: 'red', amount: 500 }, { type: 'straight', number: i % 37, amount: 100 }] } }
        : pick === 1
          ? { gameId: 'roulette', bet: { bets: [{ type: 'dozen', index: (i % 3) + 1, amount: 300 }] } }
          : { gameId: 'dice', bet: { amount: 200 + (i % 7) * 100, target: [4950, 2000, 9000, 1000][i % 4]!, direction: i % 2 ? 'under' : 'over' } };
    try {
      await startRound({ userId, gameId: bet.gameId, bet: bet.bet, idempotencyKey: randomUUID() });
      done += 1;
    } catch {
      rejected += 1;
    }
  }
  console.log(JSON.stringify({ rounds: done, rejected }));
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
