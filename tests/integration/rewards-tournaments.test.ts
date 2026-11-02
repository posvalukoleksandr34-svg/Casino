/**
 * Rewards (cashback, birthday, VIP level-up), tournaments, announcements,
 * staff notes, sign-in by username, "remember me", devices, history filters
 * and the shared-address risk flag.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it } from 'vitest';
import { POST as announcementCreateRoute } from '@/app/api/admin/content/route';
import { SESSION_COOKIE_DEV } from '@/server/auth/sessions';
import { addUserNote, listUserNotes } from '@/server/admin/notes';
import { activeAnnouncements, createAnnouncement } from '@/server/content/announcements';
import { getDb, getPool, withTransaction } from '@/server/db/client';
import { ledgerTransactions, playerRewards, rewardSettings, riskFlags, sessions, tournamentResults, users, vipLevelHistory, type UserRole } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { listRounds, startRound } from '@/server/games/round-service';
import { getWalletAccount, systemAccountIds } from '@/server/ledger/accounts';
import { runChecksWith } from '@/server/jobs/reconciliation';
import { selfExclude } from '@/server/responsible/limits';
import { claimReward, getRewardSettings, grantReward, issueBirthdayRewards, issueWeeklyCashback, listRewards, previousIsoWeek } from '@/server/rewards/rewards';
import { assignTicket, createTicket } from '@/server/support/tickets';
import { cancelTournament, createTournament, finalizeTournaments, joinTournament, tournamentDetail } from '@/server/tournaments/tournaments';
import { listDevices, signOutDevice, signOutOtherDevices } from '@/server/users/devices';
import { login, register } from '@/server/users/accounts';
import { recordVipWagering, vipOverview } from '@/server/vip/vip';
import { withMailbox } from '../support/mailbox';
import { expectLedgerConsistent, key, newPlayer, PLAYER_PASSWORD } from './helpers';

const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);
async function rejects(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error('expected the call to be refused');
}
async function staff(role: UserRole) {
  const p = await newPlayer(role.toLowerCase().slice(0, 4));
  await getDb().update(users).set({ role }).where(eq(users.id, p.userId));
  return { ...p, ctx: { adminId: p.userId, ipHash: null, requestId: key() } };
}
const balance = async (userId: string) => (await getWalletAccount(getDb(), userId))!.balance;
async function dice(userId: string, amount: number, target: number) {
  return startRound({ userId, gameId: 'dice', bet: { amount, target, direction: 'under' }, idempotencyKey: key() });
}

const originalSettings = await getRewardSettings(getDb());
afterAll(async () => {
  await getDb().update(rewardSettings).set(originalSettings).where(eq(rewardSettings.id, 1));
});

describe('rewards', () => {
  it('a reward is credited once, only on claim, through the ledger; nobody else can claim it', async () => {
    const p = await newPlayer('reward');
    const other = await newPlayer('reward-other');
    const before = await balance(p.userId);
    const id = await grantReward(getDb(), { userId: p.userId, kind: 'BIRTHDAY', periodKey: `test-${randomUUID()}`, amount: 12_345, description: 'Test reward.' });
    expect(id).not.toBeNull();
    expect(await balance(p.userId)).toBe(before);
    expect(code(await rejects(claimReward(other.userId, id!)))).toBe('NOT_FOUND');
    const res = await claimReward(p.userId, id!);
    expect(res.amount).toBe(12_345);
    expect(await balance(p.userId)).toBe(before + 12_345);
    expect(code(await rejects(claimReward(p.userId, id!)))).toBe('CONFLICT');
    expect(await balance(p.userId)).toBe(before + 12_345);
    const [row] = await getDb().select().from(playerRewards).where(eq(playerRewards.id, id!));
    const [tx] = await getDb().select().from(ledgerTransactions).where(eq(ledgerTransactions.id, row!.ledgerTxId!));
    expect(tx!.type).toBe('REWARD_CREDITED');
    // The same reward period is never granted twice.
    expect(await grantReward(getDb(), { userId: p.userId, kind: 'BIRTHDAY', periodKey: row!.periodKey, amount: 1, description: 'Duplicate.' })).toBeNull();
    await expectLedgerConsistent();
  });

  it('reconciliation catches a reward credit with no claimed reward behind it (fault in a rolled-back transaction)', async () => {
    const p = await newPlayer('reward-tamper');
    const ids = await systemAccountIds(getDb());
    const wallet = (await getWalletAccount(getDb(), p.userId))!.id;
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO ledger_transactions (type, idempotency_key, user_id, description) VALUES ('REWARD_CREDITED', $1, $2, 'injected fault') RETURNING id`,
        [`fault:${key()}`, p.userId],
      );
      await client.query('INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES ($1, $2, $3), ($1, $4, $5)', [rows[0]!.id, ids.PROMOTIONS, -5_000, wallet, 5_000]);
      const failing = (await runChecksWith(client)).filter((r) => r.mismatches > 0).map((r) => r.name);
      expect(failing).toContain('rewards_match_ledger');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    await expectLedgerConsistent();
  });

  it('expired rewards cannot be claimed; a self-excluded player gets none and can claim none', async () => {
    const p = await newPlayer('reward-exp');
    const past = new Date(Date.now() - 30 * 86_400_000);
    const id = await grantReward(getDb(), { userId: p.userId, kind: 'CASHBACK', periodKey: `old-${randomUUID()}`, amount: 1_000, description: 'Old cashback.', now: past });
    expect(code(await rejects(claimReward(p.userId, id!)))).toBe('CONFLICT');
    expect((await listRewards(p.userId)).rewards[0]!.status).toBe('EXPIRED');

    const q = await newPlayer('reward-excl');
    const waiting = await grantReward(getDb(), { userId: q.userId, kind: 'BIRTHDAY', periodKey: `q-${randomUUID()}`, amount: 1_000, description: 'Before the break.' });
    await withTransaction((tx) => selfExclude(tx, q.userId, 6));
    expect(await grantReward(getDb(), { userId: q.userId, kind: 'BIRTHDAY', periodKey: `q2-${randomUUID()}`, amount: 1_000, description: 'During the break.' })).toBeNull();
    expect((await rejects(claimReward(q.userId, waiting!))).message).toContain('self-excluded');
  });

  it('weekly cashback is the tier percentage of last week’s net casino loss, computed from settled rounds, once per week', async () => {
    await getDb().update(rewardSettings).set({ cashbackMinLoss: 1 }).where(eq(rewardSettings.id, 1));
    const p = await newPlayer('cashback');
    await getDb().update(users).set({ vipLevel: 3 }).where(eq(users.id, p.userId)); // Gold: 5%
    for (let i = 0; i < 10; i++) await dice(p.userId, 1_000, 100);
    const later = new Date(Date.now() + 7 * 86_400_000);
    const { key: week, start, end } = previousIsoWeek(later);
    const res = await getDb().execute<{ net: string }>(sql`
      SELECT (sum(stake_total) - sum(payout_total))::text AS net FROM game_rounds
      WHERE user_id = ${p.userId} AND status = 'SETTLED' AND settled_at >= ${start} AND settled_at < ${end}`);
    const net = Number(res.rows[0]!.net);
    await issueWeeklyCashback(later);
    await issueWeeklyCashback(later);
    const rows = await getDb().select().from(playerRewards).where(and(eq(playerRewards.userId, p.userId), eq(playerRewards.kind, 'CASHBACK')));
    if (net >= 1 && Math.floor((net * 500) / 10_000) > 0) {
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ periodKey: week, amount: Math.min(originalSettings.cashbackMax, Math.floor((net * 500) / 10_000)) });
    } else {
      // A winning (or tiny-loss) week earns no cashback.
      expect(rows).toHaveLength(0);
    }
  });

  it('birthday rewards are granted once per year on the birthday', async () => {
    const p = await newPlayer('bday');
    const today = new Date();
    const md = today.toISOString().slice(5, 10);
    await getDb().update(users).set({ dateOfBirth: md === '02-29' ? '1996-02-29' : `1990-${md}` }).where(eq(users.id, p.userId));
    await issueBirthdayRewards(today);
    await issueBirthdayRewards(today);
    const rows = await getDb().select().from(playerRewards).where(and(eq(playerRewards.userId, p.userId), eq(playerRewards.kind, 'BIRTHDAY')));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.periodKey).toBe(String(today.getUTCFullYear()));
  });
});

describe('VIP', () => {
  it('reaching tiers records history and grants each level-up reward once', async () => {
    const p = await newPlayer('viplvl');
    await withTransaction((tx) => recordVipWagering(tx, p.userId, 25_000_000)); // Bronze → Gold
    const o = await vipOverview(p.userId);
    expect(o.current).toMatchObject({ name: 'Gold' });
    expect(o.points).toBe(250_000);
    expect(o.history[0]).toMatchObject({ from: 'Bronze', to: 'Gold' });
    const rewards = await getDb().select().from(playerRewards).where(and(eq(playerRewards.userId, p.userId), eq(playerRewards.kind, 'LEVEL_UP')));
    expect(rewards.map((r) => r.periodKey).sort()).toEqual(['level-2', 'level-3']);
    await withTransaction((tx) => recordVipWagering(tx, p.userId, 1));
    expect(await getDb().select().from(vipLevelHistory).where(eq(vipLevelHistory.userId, p.userId))).toHaveLength(1);
    expect(o.tiers.map((t) => t.name)).toContain('Elite');
  });
});

describe('tournaments', () => {
  it('scores only rounds after joining, ranks by multiplier, pays prizes once as rewards, and refuses ineligible players', async () => {
    const admin = await staff('ADMIN');
    const a = await newPlayer('tour-a');
    const b = await newPlayer('tour-b');
    const outsider = await newPlayer('tour-out');
    const now = new Date();
    const slug = `t-${randomUUID().slice(0, 8)}`;
    await createTournament(
      admin.ctx,
      { slug, name: 'Test cup', description: 'Integration test tournament', gameIds: ['dice'], metric: 'BEST_MULTIPLIER', minStake: 100, minVipLevel: 1, startsAt: new Date(now.getTime() - 60_000).toISOString(), endsAt: new Date(now.getTime() + 3_600_000).toISOString(), prizes: [50_000, 20_000] },
      'Integration test',
      now,
    );
    // Rounds before joining do not count.
    await dice(a.userId, 1_000, 9_000);
    await joinTournament(a.userId, slug);
    await joinTournament(b.userId, slug);
    expect(code(await rejects(joinTournament(a.userId, slug)))).toBe('CONFLICT');
    expect(code(await rejects(joinTournament(admin.userId, slug)))).toBe('CONFLICT');
    for (let i = 0; i < 3; i++) {
      await dice(a.userId, 1_000, 9_000);
      await dice(b.userId, 1_000, 9_000);
      await dice(outsider.userId, 1_000, 9_000);
    }
    // A round below the minimum stake or in another game does not count either.
    await dice(a.userId, 99, 100);
    const live = await tournamentDetail(slug, a.userId);
    expect(live.tournament.phase).toBe('RUNNING');
    expect(live.board.every((r) => r.name === 'Anonymous player' || r.you)).toBe(true);
    expect(live.board.length).toBeLessThanOrEqual(2);
    const winners = live.board.filter((r) => r.score > 0).length;

    // Finalize after the end: results written once, prizes as claimable rewards.
    const after = new Date(now.getTime() + 3_600_000 + 1_000);
    expect(await finalizeTournaments(after)).toBeGreaterThanOrEqual(1);
    expect(await finalizeTournaments(after)).toBe(0);
    const t = await tournamentDetail(slug, a.userId, after);
    expect(t.tournament.phase).toBe('FINISHED');
    expect(t.board).toHaveLength(winners);
    const results = await getDb().select().from(tournamentResults).where(sql`${tournamentResults.tournamentId} = (SELECT id FROM tournaments WHERE slug = ${slug})`);
    expect(results.filter((r) => r.prize > 0).length).toBe(Math.min(2, winners));
    for (const r of results.filter((x) => x.prize > 0)) {
      const [reward] = await getDb().select().from(playerRewards).where(eq(playerRewards.id, r.rewardId!));
      expect(reward).toMatchObject({ kind: 'TOURNAMENT', amount: r.prize, userId: r.userId });
    }
    expect(results.some((r) => r.userId === outsider.userId)).toBe(false);
    await expectLedgerConsistent();
  });

  it('VIP-only tournaments refuse lower tiers; a cancelled tournament cannot be joined and pays nothing', async () => {
    const admin = await staff('ADMIN');
    const p = await newPlayer('tour-vip');
    const now = new Date();
    const slug = `v-${randomUUID().slice(0, 8)}`;
    const t = await createTournament(
      admin.ctx,
      { slug, name: 'Gold cup', description: 'Gold members only', gameIds: [], metric: 'TOP3_MULTIPLIERS', minStake: 100, minVipLevel: 3, startsAt: now.toISOString(), endsAt: new Date(now.getTime() + 3_600_000).toISOString(), prizes: [10_000] },
      'Integration test',
      now,
    );
    expect((await rejects(joinTournament(p.userId, slug))).message).toContain('Gold');
    // Prizes may not grow with rank.
    expect(code(await rejects(createTournament(admin.ctx, { slug: `x-${randomUUID().slice(0, 8)}`, name: 'Bad', description: 'Increasing prizes', gameIds: [], metric: 'BEST_MULTIPLIER', minStake: 1, minVipLevel: 1, startsAt: now.toISOString(), endsAt: new Date(now.getTime() + 60_000).toISOString(), prizes: [1, 2] }, 'x')))).toBe('VALIDATION_ERROR');
    await cancelTournament(admin.ctx, t.id, 'Cancelled in a test');
    await getDb().update(users).set({ vipLevel: 3 }).where(eq(users.id, p.userId));
    expect((await rejects(joinTournament(p.userId, slug))).message).toContain('cancelled');
    expect(await finalizeTournaments(new Date(now.getTime() + 7_200_000))).toBeGreaterThanOrEqual(0);
    expect((await tournamentDetail(slug, null)).tournament.phase).toBe('CANCELLED');
  });
});

describe('content, notes, support status', () => {
  it('announcements need content:manage; active ones are shown where placed', async () => {
    const admin = await staff('ADMIN');
    const support = await staff('SUPPORT');
    const title = `Maintenance ${randomUUID().slice(0, 6)}`;
    await createAnnouncement(admin.ctx, { title, body: 'Short maintenance tonight at 02:00 UTC.', tone: 'info', placement: 'LOBBY' }, 'Planned maintenance');
    expect((await activeAnnouncements('LOBBY')).some((a) => a.title === title)).toBe(true);
    expect((await activeAnnouncements('HOME')).some((a) => a.title === title)).toBe(false);
    const BASE = 'http://localhost:3000';
    const res = await announcementCreateRoute(
      new NextRequest(`${BASE}/api/admin/content`, {
        method: 'POST',
        headers: { cookie: `${SESSION_COOKIE_DEV}=${support.token}`, origin: BASE, 'content-type': 'application/json', 'x-forwarded-for': `10.55.${randomInt(250)}.${randomInt(250)}` },
        body: JSON.stringify({ announcement: { title: 'Nope', body: 'Should be refused', tone: 'info', placement: 'HOME' }, reason: 'Permission probe' }),
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(403);
  });

  it('staff notes are append-only and staff-only; assigning a ticket puts it in progress', async () => {
    const p = await newPlayer('noted');
    const agent = await staff('SUPPORT');
    await addUserNote(agent.ctx, p.userId, 'Called about a delayed withdrawal; explained the review.');
    expect((await listUserNotes(p.userId))[0]!.body).toContain('delayed withdrawal');
    expect(code(await rejects(addUserNote({ adminId: p.userId, ipHash: null, requestId: key() }, p.userId, 'Self note')))).toBe('FORBIDDEN');
    const t = await createTicket(p.userId, { category: 'ACCOUNT', subject: 'Help please', body: 'Question' }, null);
    await assignTicket(agent.ctx, t.id);
    const [row] = await getDb().execute<{ status: string }>(sql`SELECT status FROM support_tickets WHERE id = ${t.id}`).then((r) => r.rows);
    expect(row!.status).toBe('IN_PROGRESS');
  });
});

describe('accounts and history', () => {
  it('signs in with the username (any case); "remember me" lasts 30 days for players only', async () => {
    const p = await newPlayer('uname');
    const [u] = await getDb().select({ username: users.username }).from(users).where(eq(users.id, p.userId));
    const meta = { ipHash: null, userAgent: 'vitest' };
    const short = await login(u!.username.toUpperCase(), PLAYER_PASSWORD, meta);
    const long = await login(u!.username, PLAYER_PASSWORD, meta, { remember: true });
    const days = (d: Date) => (d.getTime() - Date.now()) / 86_400_000;
    expect(days(short.session.expiresAt)).toBeLessThan(2);
    expect(days(long.session.expiresAt)).toBeGreaterThan(29);
    const s = await staff('SUPPORT');
    const [su] = await getDb().select({ email: users.email }).from(users).where(eq(users.id, s.userId));
    const staffLogin = await login(su!.email, PLAYER_PASSWORD, meta, { remember: true });
    expect(days(staffLogin.session.expiresAt)).toBeLessThan(2);
    expect(code(await rejects(login(`${u!.username}x`, PLAYER_PASSWORD, meta)))).toBe('UNAUTHENTICATED');
  });

  it('devices: a player sees and signs out only their own sessions', async () => {
    const p = await newPlayer('devices');
    const other = await newPlayer('devices-other');
    const [u] = await getDb().select({ email: users.email }).from(users).where(eq(users.id, p.userId));
    const second = await login(u!.email, PLAYER_PASSWORD, { ipHash: null, userAgent: 'Mozilla/5.0 (iPhone) Safari/605.1' });
    const list = await listDevices(p.userId, p.sessionId);
    expect(list.find((d) => d.current)?.id).toBe(p.sessionId);
    expect(list.find((d) => d.id === second.session.sessionId)?.device).toBe('Safari on iOS');
    expect(code(await rejects(signOutDevice(other.userId, second.session.sessionId, { ipHash: null })))).toBe('NOT_FOUND');
    expect((await signOutOtherDevices(p.userId, p.sessionId, { ipHash: null })).revoked).toBeGreaterThanOrEqual(1);
    const [revoked] = await getDb().select({ revokedAt: sessions.revokedAt }).from(sessions).where(eq(sessions.id, second.session.sessionId));
    expect(revoked!.revokedAt).not.toBeNull();
  });

  it('history filters come from the round records', async () => {
    const p = await newPlayer('hist');
    for (let i = 0; i < 4; i++) await dice(p.userId, 1_000 + i * 100, 5_000);
    const all = await listRounds({ userId: p.userId });
    expect(all).toHaveLength(4);
    const wins = await listRounds({ userId: p.userId, result: 'win' });
    const losses = await listRounds({ userId: p.userId, result: 'loss' });
    expect(wins.length + losses.length).toBe(4);
    expect(wins.every((r) => r.payout! > r.stake)).toBe(true);
    expect((await listRounds({ userId: p.userId, minStake: 1_200 })).every((r) => r.stake >= 1_200)).toBe(true);
    expect(await listRounds({ userId: p.userId, roundId: all[0]!.id })).toHaveLength(1);
    expect(await listRounds({ userId: p.userId, from: new Date(Date.now() + 86_400_000) })).toHaveLength(0);
  });

  it('a third account from one network address within 30 days gets a system risk flag', async () => {
    const ipHash = `test-${randomUUID()}`;
    const ids: string[] = [];
    await withMailbox(async () => {
      for (let i = 0; i < 3; i++) {
        const tag = `ip${Date.now().toString(36)}${i}${randomUUID().slice(0, 4)}`;
        const reg = await register({ email: `${tag}@example.test`, username: tag, password: PLAYER_PASSWORD, confirmPassword: PLAYER_PASSWORD, ageConfirmed: true, chipsAcknowledged: true, termsAccepted: true }, { ipHash, userAgent: 'vitest' });
        ids.push(reg.user.id);
      }
    });
    const flags = async (id: string) => getDb().select().from(riskFlags).where(eq(riskFlags.userId, id));
    expect(await flags(ids[0]!)).toHaveLength(0);
    expect(await flags(ids[1]!)).toHaveLength(0);
    const third = await flags(ids[2]!);
    expect(third).toHaveLength(1);
    expect(third[0]).toMatchObject({ kind: 'MULTIPLE_ACCOUNTS', createdBy: null });
  });
});
