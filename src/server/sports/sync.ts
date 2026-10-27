/**
 * Sports data sync (background job, every minute).
 *
 * Demo mode: keeps a rolling schedule of fictional fixtures (one every 20
 * minutes, 24 hours ahead). Each fixture gets a fresh secret seed whose
 * SHA-256 is published before betting, the published score model and the
 * house-model prices. Ten minutes after kick-off the result is drawn from the
 * committed seed, recorded, the seed revealed and tickets settled.
 *
 * Live mode: fixtures/results from football-data.org and 1X2 prices from The
 * Odds API, refreshed every SPORTS_SYNC_MINUTES. Odds events are mapped onto
 * fixtures by team names and kick-off time; unmatched prices are ignored.
 * Results settle tickets; cancellations void them; postponements suspend them
 * (and void after 48 hours).
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, gte, inArray, lte, sql } from 'drizzle-orm';
import { buildScoreModel, demoClientSeed, demoPrices, drawScore, OUTCOMES, validateScoreModel, type ScoreModel } from '@/engine/sports/model';
import { DEMO_COMPETITIONS, DEMO_TEAMS, demoExpectedGoals } from '@/engine/sports/demo-data';
import { createRandomStream } from '@/engine/rng/provably-fair';
import { decryptSecret, encryptSecret } from '../crypto';
import { getDb, withTransaction, type Tx } from '../db/client';
import {
  sportsCompetitions,
  sportsEvents,
  sportsExternalRefs,
  sportsMarkets,
  sportsOddsHistory,
  sportsProviderStatus,
  sportsSelections,
  sportsTeams,
} from '../db/schema';
import { env } from '../env';
import { logger } from '../observability/logger';
import { DEMO_SCHEDULE, POSTPONEMENT_VOID_HOURS, sportsConfig } from './config';
import { footballDataProvider } from './providers/football-data';
import { ProviderError } from './providers/http';
import { theOddsApiProvider } from './providers/the-odds-api';
import type { FixturesProvider, OddsProvider, ProviderFixture, ProviderOdds } from './providers/types';
import { closeStartedMarkets, recordEventResult, setEventSuspended, settleEventTickets, settleOutstanding } from './settlement';

export const DEMO_SOURCE = 'demo';
export const DEMO_ODDS_SOURCE = 'Demo house model (6% margin)';

// ---------------------------------------------------------------------------
// Demo
// ---------------------------------------------------------------------------

export async function ensureDemoCatalog(db: Tx | ReturnType<typeof getDb> = getDb()): Promise<void> {
  for (const c of DEMO_COMPETITIONS) {
    await db.insert(sportsCompetitions).values({ id: c.id, name: c.name, country: null, source: DEMO_SOURCE, isDemo: true }).onConflictDoNothing();
  }
  for (const t of DEMO_TEAMS) {
    await db.insert(sportsTeams).values({ id: t.id, name: t.name, shortName: t.shortName, source: DEMO_SOURCE, isDemo: true }).onConflictDoNothing();
  }
}

/** Deterministic pairing for a slot (any instance creates the same fixture; the unique key prevents duplicates). */
export function demoFixtureForSlot(slot: Date): { externalId: string; competitionId: string; homeId: string; awayId: string } {
  const iso = slot.toISOString();
  const n = Math.floor(slot.getTime() / (DEMO_SCHEDULE.slotMinutes * 60_000));
  const comp = DEMO_COMPETITIONS[n % DEMO_COMPETITIONS.length]!;
  const h = createHash('sha256').update(`demo-fixture:${iso}`).digest();
  const size = comp.teams.length;
  const home = h[0]! % size;
  const away = (home + 1 + (h[1]! % (size - 1))) % size;
  return { externalId: `demo:${iso}`, competitionId: comp.id, homeId: comp.teams[home]!, awayId: comp.teams[away]! };
}

export async function createDemoEvent(tx: Tx, f: ReturnType<typeof demoFixtureForSlot>, kickoff: Date, now: Date): Promise<boolean> {
  const g = demoExpectedGoals(f.homeId, f.awayId);
  const model = buildScoreModel(g.homeE3, g.awayE3);
  const seed = randomBytes(32).toString('hex');
  const [ev] = await tx
    .insert(sportsEvents)
    .values({
      source: DEMO_SOURCE,
      externalId: f.externalId,
      competitionId: f.competitionId,
      homeTeamId: f.homeId,
      awayTeamId: f.awayId,
      kickoffAt: kickoff,
      status: 'SCHEDULED',
      isDemo: true,
      seedHash: createHash('sha256').update(seed).digest('hex'),
      seedEnc: encryptSecret(seed),
      model: model as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing()
    .returning();
  if (!ev) return false;
  const prices = demoPrices(model);
  const [market] = await tx
    .insert(sportsMarkets)
    .values({ eventId: ev.id, type: '1X2', status: 'OPEN', oddsSource: DEMO_ODDS_SOURCE, oddsUpdatedAt: now })
    .returning();
  const sel = await tx
    .insert(sportsSelections)
    .values(OUTCOMES.map((code) => ({ marketId: market!.id, code, oddsE2: prices[code] })))
    .returning();
  await tx.insert(sportsOddsHistory).values(sel.map((s) => ({ selectionId: s.id, marketVersion: 1, oddsE2: s.oddsE2, source: DEMO_ODDS_SOURCE })));
  return true;
}

export async function ensureDemoFixtures(now = new Date()): Promise<number> {
  const slotMs = DEMO_SCHEDULE.slotMinutes * 60_000;
  const first = Math.ceil(now.getTime() / slotMs) * slotMs;
  const last = now.getTime() + DEMO_SCHEDULE.horizonHours * 3_600_000;
  const slots: Date[] = [];
  for (let t = first; t <= last; t += slotMs) slots.push(new Date(t));
  if (slots.length === 0) return 0;
  const existing = await getDb()
    .select({ externalId: sportsEvents.externalId })
    .from(sportsEvents)
    .where(and(eq(sportsEvents.source, DEMO_SOURCE), gte(sportsEvents.kickoffAt, slots[0]!), lte(sportsEvents.kickoffAt, slots.at(-1)!)));
  const have = new Set(existing.map((e) => e.externalId));
  const missing = slots.filter((s) => !have.has(demoFixtureForSlot(s).externalId));
  if (missing.length === 0) return 0;
  await ensureDemoCatalog();
  let created = 0;
  await withTransaction(async (tx) => {
    for (const s of missing) if (await createDemoEvent(tx, demoFixtureForSlot(s), s, now)) created += 1;
  });
  return created;
}

/** The demo result for an event: recomputable by anyone from the revealed seed and the published model. */
export function demoResult(seed: string, eventId: string, model: ScoreModel): { home: number; away: number } {
  return drawScore(model, createRandomStream({ serverSeed: seed, clientSeed: demoClientSeed(eventId), nonce: 0 }));
}

export async function settleDueDemoEvents(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DEMO_SCHEDULE.resultDelayMinutes * 60_000);
  const due = await getDb()
    .select()
    .from(sportsEvents)
    .where(and(eq(sportsEvents.isDemo, true), eq(sportsEvents.resultVersion, 0), inArray(sportsEvents.status, ['SCHEDULED', 'LIVE']), lte(sportsEvents.kickoffAt, cutoff)))
    .limit(100);
  let n = 0;
  for (const ev of due) {
    const model = ev.model as unknown as ScoreModel;
    validateScoreModel(model);
    const seed = decryptSecret(ev.seedEnc!);
    const score = demoResult(seed, ev.id, model);
    await recordEventResult(ev.id, { kind: 'RESULT', ...score }, { source: 'demo simulation', reason: 'Simulated full-time result from the committed seed', revealSeed: seed });
    await settleEventTickets(ev.id);
    n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Live providers
// ---------------------------------------------------------------------------

export function normalizeTeam(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(fc|cf|afc|sc|ac|cd|ud|the|club|calcio|de)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function sameTeam(a: string, b: string): boolean {
  const x = normalizeTeam(a);
  const y = normalizeTeam(b);
  if (!x || !y) return false;
  return x === y || (x.length >= 5 && y.includes(x)) || (y.length >= 5 && x.includes(y));
}

async function providerStatus(provider: string, ok: boolean, detail: { error?: unknown; remaining?: number | null } = {}) {
  const now = new Date();
  const message = detail.error instanceof ProviderError ? detail.error.message : detail.error ? 'unexpected error (see server logs)' : null;
  await getDb()
    .insert(sportsProviderStatus)
    .values({ provider, lastSuccessAt: ok ? now : null, lastErrorAt: ok ? null : now, lastError: message, requestsRemaining: detail.remaining ?? null, updatedAt: now })
    .onConflictDoUpdate({
      target: sportsProviderStatus.provider,
      set: ok
        ? { lastSuccessAt: now, updatedAt: now, ...(detail.remaining !== undefined ? { requestsRemaining: detail.remaining } : {}) }
        : { lastErrorAt: now, lastError: message, updatedAt: now },
    });
}

async function due(provider: string, intervalMs: number, now: Date): Promise<boolean> {
  const [row] = await getDb().select({ updatedAt: sportsProviderStatus.updatedAt }).from(sportsProviderStatus).where(eq(sportsProviderStatus.provider, provider));
  return !row || now.getTime() - row.updatedAt.getTime() >= intervalMs;
}

/** Applies provider fixtures: upserts catalogue rows and events, then results, voids and suspensions. */
export async function applyFixtures(fixtures: ProviderFixture[], source: string, now = new Date()): Promise<void> {
  for (const f of fixtures) {
    const compId = `${source}:${f.competition.id}`;
    const homeId = `${source}:${f.home.id}`;
    const awayId = `${source}:${f.away.id}`;
    if (homeId === awayId) continue;
    const event = await withTransaction(async (tx) => {
      await tx.insert(sportsCompetitions).values({ id: compId, name: f.competition.name, country: f.competition.country, source, isDemo: false }).onConflictDoNothing();
      for (const t of [{ ...f.home, id: homeId }, { ...f.away, id: awayId }]) {
        await tx.insert(sportsTeams).values({ id: t.id, name: t.name, shortName: t.shortName, source, isDemo: false }).onConflictDoNothing();
      }
      const [row] = await tx
        .insert(sportsEvents)
        .values({ source, externalId: f.externalId, competitionId: compId, homeTeamId: homeId, awayTeamId: awayId, kickoffAt: f.kickoffAt, isDemo: false, providerUpdatedAt: f.updatedAt })
        .onConflictDoUpdate({
          target: [sportsEvents.source, sportsEvents.externalId],
          // Kick-off moves only before a result exists.
          set: { kickoffAt: sql`CASE WHEN sports_events.result_version = 0 THEN excluded.kickoff_at ELSE sports_events.kickoff_at END`, providerUpdatedAt: f.updatedAt, updatedAt: now },
        })
        .returning();
      return row!;
    });
    if (f.status === 'FINISHED' && f.score) {
      const res = await recordEventResult(event.id, { kind: 'RESULT', ...f.score }, { source, reason: event.resultVersion === 0 ? 'Final regular-time score from the provider' : 'Provider corrected the result' });
      if (res.changed) await settleEventTickets(event.id);
    } else if (f.status === 'CANCELLED') {
      const res = await recordEventResult(event.id, { kind: 'VOID' }, { source, reason: 'Match cancelled or awarded' });
      if (res.changed) await settleEventTickets(event.id);
    } else if (f.status === 'POSTPONED' || f.status === 'SUSPENDED') {
      if (event.resultVersion === 0 && f.status === 'POSTPONED' && now.getTime() - f.kickoffAt.getTime() > POSTPONEMENT_VOID_HOURS * 3_600_000) {
        await recordEventResult(event.id, { kind: 'VOID' }, { source, reason: `Postponed for more than ${POSTPONEMENT_VOID_HOURS} hours` });
        await settleEventTickets(event.id);
      } else {
        await setEventSuspended(event.id, true, f.status === 'POSTPONED' ? 'Match postponed' : 'Match suspended');
      }
    } else if (f.status === 'SCHEDULED' && (event.status === 'SUSPENDED' || event.status === 'POSTPONED') && f.kickoffAt > now) {
      await setEventSuspended(event.id, false, 'Rescheduled');
    }
  }
}

/** Maps provider prices onto events and stores changed prices as a new market version. */
export async function applyOdds(items: ProviderOdds[], provider: string, now = new Date()): Promise<{ matched: number; unmatched: number }> {
  let matched = 0;
  let unmatched = 0;
  for (const o of items) {
    let [ref] = await getDb().select().from(sportsExternalRefs).where(and(eq(sportsExternalRefs.provider, provider), eq(sportsExternalRefs.externalId, o.externalId)));
    if (!ref) {
      const window = 3 * 3_600_000;
      const candidates = await getDb()
        .select({ id: sportsEvents.id, home: sportsTeams.name, kickoffAt: sportsEvents.kickoffAt, awayTeamId: sportsEvents.awayTeamId })
        .from(sportsEvents)
        .innerJoin(sportsTeams, eq(sportsTeams.id, sportsEvents.homeTeamId))
        .where(and(eq(sportsEvents.isDemo, false), gt(sportsEvents.kickoffAt, new Date(o.kickoffAt.getTime() - window)), lte(sportsEvents.kickoffAt, new Date(o.kickoffAt.getTime() + window))));
      const awayNames = new Map(
        (await getDb().select({ id: sportsTeams.id, name: sportsTeams.name }).from(sportsTeams).where(inArray(sportsTeams.id, candidates.map((c) => c.awayTeamId).concat(['-'])))).map((t) => [t.id, t.name]),
      );
      const hit = candidates.filter((c) => sameTeam(c.home, o.homeName) && sameTeam(awayNames.get(c.awayTeamId) ?? '', o.awayName));
      if (hit.length !== 1) {
        unmatched += 1;
        continue;
      }
      [ref] = await getDb().insert(sportsExternalRefs).values({ provider, externalId: o.externalId, eventId: hit[0]!.id }).onConflictDoNothing().returning();
      if (!ref) continue;
    }
    matched += 1;
    const source = `${o.bookmaker} via The Odds API`;
    await withTransaction(async (tx) => {
      const [ev] = await tx.select().from(sportsEvents).where(eq(sportsEvents.id, ref!.eventId));
      if (!ev || ev.resultVersion > 0 || ev.kickoffAt <= now) return;
      let [market] = await tx.select().from(sportsMarkets).where(and(eq(sportsMarkets.eventId, ev.id), eq(sportsMarkets.type, '1X2'))).for('update');
      if (!market) {
        [market] = await tx
          .insert(sportsMarkets)
          .values({ eventId: ev.id, type: '1X2', status: ev.status === 'SCHEDULED' ? 'OPEN' : 'SUSPENDED', oddsSource: source, oddsUpdatedAt: now })
          .returning();
        const sel = await tx.insert(sportsSelections).values(OUTCOMES.map((code) => ({ marketId: market!.id, code, oddsE2: o.odds[code] }))).returning();
        await tx.insert(sportsOddsHistory).values(sel.map((s) => ({ selectionId: s.id, marketVersion: 1, oddsE2: s.oddsE2, source })));
        return;
      }
      if (market.status === 'SETTLED' || market.status === 'VOIDED' || market.status === 'CLOSED') return;
      const sel = await tx.select().from(sportsSelections).where(eq(sportsSelections.marketId, market.id));
      const changed = sel.filter((s) => s.oddsE2 !== o.odds[s.code]);
      if (changed.length === 0) {
        await tx.update(sportsMarkets).set({ oddsUpdatedAt: now, oddsSource: source, updatedAt: now }).where(eq(sportsMarkets.id, market.id));
        return;
      }
      const version = market.version + 1;
      for (const s of changed) {
        await tx.update(sportsSelections).set({ oddsE2: o.odds[s.code] }).where(eq(sportsSelections.id, s.id));
        await tx.insert(sportsOddsHistory).values({ selectionId: s.id, marketVersion: version, oddsE2: o.odds[s.code], source });
      }
      await tx.update(sportsMarkets).set({ version, oddsUpdatedAt: now, oddsSource: source, updatedAt: now }).where(eq(sportsMarkets.id, market.id));
    });
  }
  return { matched, unmatched };
}

function liveProviders(): { fixtures: FixturesProvider; odds: OddsProvider } {
  const e = env();
  return {
    fixtures: footballDataProvider({ apiKey: e.FOOTBALL_DATA_API_KEY!, competitions: e.FOOTBALL_DATA_COMPETITIONS }),
    odds: theOddsApiProvider({
      apiKey: e.THE_ODDS_API_KEY!,
      sports: e.THE_ODDS_API_SPORTS,
      regions: e.THE_ODDS_API_REGIONS,
      bookmaker: e.THE_ODDS_API_BOOKMAKER || undefined,
    }),
  };
}

async function syncLive(now: Date, providers = liveProviders()): Promise<void> {
  const interval = sportsConfig().syncIntervalMs;
  if (await due(providers.fixtures.name, interval, now)) {
    try {
      const fixtures = await providers.fixtures.fetchFixtures(new Date(now.getTime() - 3 * 86_400_000), new Date(now.getTime() + 7 * 86_400_000));
      await applyFixtures(fixtures, providers.fixtures.name, now);
      await providerStatus(providers.fixtures.name, true);
    } catch (err) {
      await providerStatus(providers.fixtures.name, false, { error: err });
      logger.warn('sports fixtures sync failed', { provider: providers.fixtures.name, error: err instanceof ProviderError ? err.message : 'unexpected' });
    }
  }
  if (await due(providers.odds.name, interval, now)) {
    try {
      const items = await providers.odds.fetchOdds();
      const r = await applyOdds(items, providers.odds.name, now);
      await providerStatus(providers.odds.name, true);
      logger.info('sports odds synced', { provider: providers.odds.name, ...r });
    } catch (err) {
      await providerStatus(providers.odds.name, false, { error: err });
      logger.warn('sports odds sync failed', { provider: providers.odds.name, error: err instanceof ProviderError ? err.message : 'unexpected' });
    }
  }
}

/** One scheduler tick. */
export async function syncSports(now = new Date()): Promise<void> {
  const cfg = sportsConfig();
  if (cfg.mode === 'off') return;
  if (cfg.mode === 'demo') {
    await ensureDemoFixtures(now);
    await closeStartedMarkets(now);
    await settleDueDemoEvents(now);
  } else if (!cfg.misconfigured) {
    await syncLive(now);
    await closeStartedMarkets(now);
  }
  await settleOutstanding();
}
