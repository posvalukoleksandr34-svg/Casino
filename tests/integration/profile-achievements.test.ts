import { NextRequest } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { PATCH as profileRoute } from '@/app/api/account/profile/route';
import { GET as achievementsRoute } from '@/app/api/achievements/route';
import { POST as verifyRoute } from '@/app/api/fairness/verify-round/route';
import { SESSION_COOKIE_DEV } from '@/server/auth/sessions';
import { evaluateAchievements, listAchievements, outcomeMatches, verifyRoundOnServer } from '@/server/achievements/achievements';
import { getDb, getPool, withTransaction } from '@/server/db/client';
import { auditLogs, userAchievements, users } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { rotateSeed } from '@/server/fairness/seeds';
import { addFavorite } from '@/server/games/favorites';
import { actOnRound, expireRoundIfDue, startRound } from '@/server/games/round-service';
import { updateLimits } from '@/server/responsible/limits';
import { deleteAccount, exportUserData } from '@/server/users/accounts';
import { playerStats } from '@/server/users/stats';
import { expectDbError, key, newPlayer } from './helpers';

const BASE = 'http://localhost:3000';
const code = (e: unknown) => (e instanceof AppError ? e.code : String(e));

function req(path: string, opts: { method?: string; token?: string; body?: unknown; origin?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.cookie = `${SESSION_COOKIE_DEV}=${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.method && opts.method !== 'GET') headers.origin = opts.origin ?? BASE;
  return new NextRequest(`${BASE}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}
const params = <T>(p: T) => ({ params: Promise.resolve(p) });
const earned = async (userId: string) => (await listAchievements(userId)).filter((a) => a.earned).map((a) => a.id).sort();

describe('profile', () => {
  it('validates and saves display name and avatar, audits the change, and is the player’s own', async () => {
    const p = await newPlayer('prof');
    const patch = (body: unknown, token: string | null = p.token) => profileRoute(req('/api/account/profile', { method: 'PATCH', token: token ?? undefined, body }), params({}));
    expect((await patch({ displayName: 'Ann' }, null)).status).toBe(401);
    for (const bad of [{ displayName: '<b>x</b>' }, { displayName: 'a' }, { displayName: 'x'.repeat(33) }, { displayName: 'bell\u0007x' }, { avatar: 'uploaded.png' }, { role: 'ADMIN' }]) {
      expect((await patch(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    // Runs of whitespace (tabs included) are normalised to one space.
    expect((await (await patch({ displayName: 'tab\there' })).json()).profile.displayName).toBe('tab here');
    const ok = await patch({ displayName: '  Lucky   Star  ', avatar: 'jade-circle' });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.profile).toEqual({ displayName: 'Lucky Star', avatar: 'jade-circle' });
    expect(body.achievements.find((a: { id: string }) => a.id === 'profile-set').earned).toBe(true);
    const [row] = await getDb().select({ displayName: users.displayName, avatar: users.avatar, role: users.role }).from(users).where(eq(users.id, p.userId));
    expect(row).toEqual({ displayName: 'Lucky Star', avatar: 'jade-circle', role: 'PLAYER' });
    const audits = await getDb().select().from(auditLogs).where(eq(auditLogs.actorId, p.userId));
    expect(audits.some((a) => a.action === 'user.profile_updated')).toBe(true);
    // Clearing the name keeps the badge (awards are never withdrawn) and shows the username again.
    expect((await (await patch({ displayName: '' })).json()).profile.displayName).toBeNull();
    expect(await earned(p.userId)).toContain('profile-set');
  });

  it('the database refuses malformed profile values even if the application were bypassed', async () => {
    const p = await newPlayer('profdb');
    await expectDbError(getDb().update(users).set({ displayName: ' padded ' }).where(eq(users.id, p.userId)), /users_display_name_shape/);
    await expectDbError(getDb().update(users).set({ avatar: '../x' }).where(eq(users.id, p.userId)), /users_avatar_shape/);
  });
});

describe('achievements', () => {
  it('are derived from recorded facts, idempotent, and cannot be edited or removed', async () => {
    const p = await newPlayer('ach');
    expect(await earned(p.userId)).toEqual([]);
    await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 100, target: 5000, direction: 'under' }, idempotencyKey: key() });
    await withTransaction((tx) => updateLimits(tx, p.userId, { dailyLossLimit: 50_000 }));
    await withTransaction((tx) => rotateSeed(tx, p.userId));
    await evaluateAchievements(p.userId);
    await evaluateAchievements(p.userId);
    const res = await achievementsRoute(req('/api/achievements', { token: p.token }), params({}));
    const list = (await res.json()).achievements as { id: string; earned: boolean }[];
    expect(list.filter((a) => a.earned).map((a) => a.id).sort()).toEqual(['first-round', 'limits-set', 'seed-rotated']);
    const rows = await getDb().select().from(userAchievements).where(eq(userAchievements.userId, p.userId));
    expect(rows).toHaveLength(3);
    await expectDbError(getDb().delete(userAchievements).where(eq(userAchievements.userId, p.userId)), /append-only|cannot|not allowed|forbid/i);
    await expectDbError(
      getDb().update(userAchievements).set({ achievementId: 'something-else' }).where(eq(userAchievements.userId, p.userId)),
      /append-only|cannot|not allowed|forbid/i,
    );
    await expectDbError(getPool().query(`INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, 'Bad Id!')`, [p.userId]), /check/i);
  });

  it('a reality-check reminder alone is not a limit', async () => {
    const p = await newPlayer('achrc');
    await withTransaction((tx) => updateLimits(tx, p.userId, { realityCheckMinutes: 30 }));
    expect(await evaluateAchievements(p.userId).then((l) => l.find((a) => a.id === 'limits-set')!.earned)).toBe(false);
  });
});

describe('server-side round verification', () => {
  async function settledRounds(userId: string) {
    const ids: string[] = [];
    const start = async (gameId: string, bet: unknown) => (await startRound({ userId, gameId, bet, idempotencyKey: key() })).body.round;
    ids.push((await start('roulette', { bets: [{ type: 'red', amount: 100 }] })).id);
    ids.push((await start('dice', { amount: 100, target: 5000, direction: 'under' })).id);
    ids.push((await start('limbo', { amount: 100, targetE2: 300 })).id);
    ids.push((await start('keno', { amount: 100, picks: [4, 8, 15, 16, 23, 40] })).id);
    ids.push((await start('plinko', { amount: 100, rows: 12, risk: 'high' })).id);
    const crash = await start('crash', { amount: 100, autoCashoutE2: 150 });
    if (crash.status === 'OPEN') await expireRoundIfDue(crash.id, new Date(Date.now() + 3_600_000));
    ids.push(crash.id);
    let mines = await start('mines', { amount: 100, mines: 3 });
    if (mines.status === 'OPEN') mines = (await actOnRound({ userId, roundId: mines.id, action: { type: 'reveal', tile: 0 }, idempotencyKey: key() })).body.round;
    if (mines.status === 'OPEN') await actOnRound({ userId, roundId: mines.id, action: { type: 'cashout' }, idempotencyKey: key() });
    ids.push(mines.id);
    let hilo = await start('hilo', { amount: 100 });
    for (let i = 0; i < 5 && hilo.status === 'OPEN'; i += 1) {
      const v = hilo.state as { higher: { probability: number } | null; lower: { probability: number } | null };
      const dir = (v.higher?.probability ?? 0) >= (v.lower?.probability ?? 0) ? 'higher' : 'lower';
      hilo = (await actOnRound({ userId, roundId: hilo.id, action: i === 0 ? { type: 'skip' } : { type: 'guess', direction: dir }, idempotencyKey: key() })).body.round;
    }
    if (hilo.status === 'OPEN') await actOnRound({ userId, roundId: hilo.id, action: { type: 'cashout' }, idempotencyKey: key() });
    ids.push(hilo.id);
    let bj = await start('blackjack', { amount: 100 });
    for (let i = 0; i < 10 && bj.status === 'OPEN'; i += 1) {
      const phase = (bj.state as { phase: string }).phase;
      bj = (await actOnRound({ userId, roundId: bj.id, action: phase === 'insurance' ? { type: 'insurance', take: false } : { type: 'stand' }, idempotencyKey: key() })).body.round;
    }
    ids.push(bj.id);
    return ids;
  }

  it('recomputes every game from the revealed seed, matches the stored result and awards the badge once', async () => {
    const p = await newPlayer('sv');
    const ids = await settledRounds(p.userId);
    // Before rotation the seed is secret.
    await expect(verifyRoundOnServer(p.userId, ids[0]!)).rejects.toSatisfy((e) => code(e) === 'CONFLICT');
    await withTransaction((tx) => rotateSeed(tx, p.userId));
    for (const id of ids) {
      const v = await verifyRoundOnServer(p.userId, id);
      expect(v.matches, `${v.gameId}: ${v.description}`).toBe(true);
    }
    const rows = await getDb().select().from(userAchievements).where(eq(userAchievements.userId, p.userId));
    expect(rows.filter((r) => r.achievementId === 'fairness-verified')).toHaveLength(1);
    expect(rows.find((r) => r.achievementId === 'fairness-verified')!.evidence).toEqual({ roundId: ids[0] });

    // Through the API; another player's round is not found.
    const ok = await verifyRoute(req('/api/fairness/verify-round', { method: 'POST', token: p.token, body: { roundId: ids[1] } }), params({}));
    expect((await ok.json()).verification.matches).toBe(true);
    const other = await newPlayer('svother');
    const nf = await verifyRoute(req('/api/fairness/verify-round', { method: 'POST', token: other.token, body: { roundId: ids[1] } }), params({}));
    expect(nf.status).toBe(404);
    const bad = await verifyRoute(req('/api/fairness/verify-round', { method: 'POST', token: p.token, body: { roundId: 'nope' } }), params({}));
    expect(bad.status).toBe(400);
  });

  it('a stored result that differs from the recomputation is reported as a mismatch', () => {
    expect(outcomeMatches('dice', { roll: 1234 }, { roll: 1234 }, 0)).toBe(true);
    expect(outcomeMatches('dice', { roll: 1234 }, { roll: 1235 }, 0)).toBe(false);
    expect(outcomeMatches('mines', { mines: [1, 5, 9] }, { mines: [9, 1, 5] }, 0)).toBe(true);
    expect(outcomeMatches('mines', { mines: [1, 5, 9] }, { mines: [1, 5, 10] }, 0)).toBe(false);
    expect(outcomeMatches('plinko', { path: 'LRL' }, { path: [0, 1, 1] }, 0)).toBe(false);
  });
});

describe('statistics, export and deletion', () => {
  it('wins, losses and pushes add up to the rounds; turnover and returns are reported separately', async () => {
    const p = await newPlayer('wld');
    for (let i = 0; i < 6; i += 1) await startRound({ userId: p.userId, gameId: 'plinko', bet: { amount: 100, rows: 8, risk: 'low' }, idempotencyKey: key() });
    const { totals } = await playerStats(p.userId);
    expect(totals.wins + totals.losses + totals.draws).toBe(totals.rounds);
    expect(totals.wagered).toBe(600);
    expect(totals.net).toBe(totals.paidOut - totals.wagered);
  });

  it('the data export includes profile, favourites and achievements; deletion erases profile and favourites', async () => {
    const p = await newPlayer('expdel');
    await profileRoute(req('/api/account/profile', { method: 'PATCH', token: p.token, body: { displayName: 'Exporter', avatar: 'onyx-moon' } }), params({}));
    await addFavorite(p.userId, 'hilo');
    const data = await exportUserData(p.userId);
    expect(data.user).toMatchObject({ displayName: 'Exporter', avatar: 'onyx-moon' });
    expect(data.favorites.map((f) => f.gameId)).toEqual(['hilo']);
    expect(data.achievements.map((a) => a.achievementId)).toContain('profile-set');
    await deleteAccount(p.userId, 'correct horse battery staple', { ipHash: null, userAgent: null });
    const [row] = await getDb().select({ displayName: users.displayName, avatar: users.avatar }).from(users).where(eq(users.id, p.userId));
    expect(row).toEqual({ displayName: null, avatar: null });
    const fav = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM user_favorites WHERE user_id = ${p.userId}`);
    expect(fav.rows[0]!.n).toBe(0);
  });
});
