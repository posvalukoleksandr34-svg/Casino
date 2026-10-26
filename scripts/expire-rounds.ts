/**
 * Runs one pass of the round-expiry queue (normally done every 5 s by the
 * in-process scheduler). Useful after downtime or when background jobs are
 * disabled: npm run job:expire-rounds
 */
import './load-env';
import { expireDueRounds } from '../src/server/games/round-service';
import { closeDb } from '../src/server/db/client';

async function main() {
  const settled = await expireDueRounds();
  console.log(JSON.stringify({ msg: 'expire-rounds', settled }));
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
