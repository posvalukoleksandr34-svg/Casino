/**
 * Development seed: staff accounts for each role plus a demo player.
 * Refuses to run with NODE_ENV=production.
 */
import './load-env';
import { eq } from 'drizzle-orm';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo accounts in production');
  const { getDb, closeDb } = await import('../src/server/db/client');
  const { users } = await import('../src/server/db/schema');
  const { register } = await import('../src/server/users/accounts');
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'Velvet-Table-Seed-2026';
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const accounts = [
    { email: adminEmail, username: 'admin', role: 'ADMIN' as const },
    { email: 'risk@example.com', username: 'risk_manager', role: 'RISK_MANAGER' as const },
    { email: 'auditor@example.com', username: 'auditor', role: 'AUDITOR' as const },
    { email: 'support@example.com', username: 'support', role: 'SUPPORT' as const },
    { email: 'player@example.com', username: 'demo_player', role: 'PLAYER' as const },
  ];
  const db = getDb();
  for (const a of accounts) {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, a.email));
    if (existing) {
      console.log(`exists: ${a.email}`);
      continue;
    }
    const res = await register(
      { email: a.email, username: a.username, password, ageConfirmed: true, termsAccepted: true },
      { ipHash: null, userAgent: 'seed' },
    );
    if (a.role !== 'PLAYER') await db.update(users).set({ role: a.role }).where(eq(users.id, res.user.id));
    console.log(`created: ${a.email} (${a.role})`);
  }
  console.log(`All seeded accounts use the password from SEED_ADMIN_PASSWORD.`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
