/**
 * Local development seed: one staff account per role plus a demo player.
 * Safety rules and password handling: scripts/seed-plan.ts. Generated
 * passwords are printed once to this terminal only (never to the app log).
 */
import './load-env';
import { eq } from 'drizzle-orm';
import { planSeed, UnsafeSeedError } from './seed-plan';

async function main() {
  const accounts = planSeed(process.env);
  const { getDb, closeDb } = await import('../src/server/db/client');
  const { users } = await import('../src/server/db/schema');
  const { createOperatorAccount } = await import('../src/server/users/accounts');
  const db = getDb();
  const shown: string[] = [];
  for (const a of accounts) {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, a.email));
    if (existing) {
      console.log(`exists:  ${a.email} (${a.role}) — password unchanged`);
      continue;
    }
    // Operator-created: verified by OPERATOR, exempt from the player-details step (nothing is invented).
    const res = await createOperatorAccount({ email: a.email, username: a.username, password: a.password }, { ipHash: null, userAgent: 'seed' }, { onboarding: 'exempt' });
    if (a.role !== 'PLAYER') await db.update(users).set({ role: a.role }).where(eq(users.id, res.user.id));
    console.log(`created: ${a.email} (${a.role})${a.generated ? '' : ` — password from ${a.passwordVariable}`}`);
    if (a.generated) shown.push(`  ${a.email.padEnd(24)} ${a.password}`);
  }
  if (shown.length) {
    console.log('\nGenerated passwords (shown once; store them in your password manager):');
    console.log(shown.join('\n'));
  }
  await closeDb();
}

main().catch((err) => {
  console.error(err instanceof UnsafeSeedError ? `seed refused: ${err.message}` : err);
  process.exit(1);
});
