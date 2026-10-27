/**
 * Fixtures and results from football-data.org (API v4, `GET /v4/matches`,
 * header `X-Auth-Token`). Mapping follows the provider's published v4
 * documentation; check it against a real response before enabling live mode.
 *
 * 1X2 settles on the regular-time score: `score.regularTime` when the match
 * went to extra time or penalties, otherwise `score.fullTime`.
 */
import { z } from 'zod';
import { fetchJson, ProviderError } from './http';
import type { FixturesProvider, ProviderEventStatus, ProviderFixture } from './types';

const BASE = 'https://api.football-data.org/v4';
/** Free tier: 10 requests per minute. */
const MIN_INTERVAL_MS = 6_500;
/** The API accepts at most a 10-day window per request. */
const MAX_WINDOW_DAYS = 10;

const goals = z.object({ home: z.number().int().nonnegative().nullable(), away: z.number().int().nonnegative().nullable() });
const team = z.object({ id: z.number().int(), name: z.string().min(1).max(120), shortName: z.string().max(80).nullish(), tla: z.string().max(10).nullish() });
const matchSchema = z.object({
  id: z.number().int(),
  utcDate: z.iso.datetime({ offset: true }),
  status: z.string(),
  lastUpdated: z.iso.datetime({ offset: true }).nullish(),
  competition: z.object({ id: z.number().int(), name: z.string().min(1).max(120), code: z.string().max(10).nullish() }),
  area: z.object({ name: z.string().max(80) }).nullish(),
  homeTeam: team,
  awayTeam: team,
  score: z.object({ duration: z.string().nullish(), fullTime: goals, regularTime: goals.nullish() }),
});
export const footballDataResponse = z.object({ matches: z.array(matchSchema) });

export function mapStatus(status: string): ProviderEventStatus {
  switch (status) {
    case 'SCHEDULED':
    case 'TIMED':
      return 'SCHEDULED';
    case 'IN_PLAY':
    case 'PAUSED':
    case 'LIVE':
      return 'LIVE';
    case 'FINISHED':
      return 'FINISHED';
    case 'POSTPONED':
      return 'POSTPONED';
    case 'SUSPENDED':
      return 'SUSPENDED';
    // AWARDED (result decided off the pitch) is treated like a cancellation: predictions are voided.
    case 'CANCELLED':
    case 'AWARDED':
      return 'CANCELLED';
    default:
      return 'SUSPENDED';
  }
}

export function mapMatches(payload: z.infer<typeof footballDataResponse>): ProviderFixture[] {
  return payload.matches.map((m) => {
    const status = mapStatus(m.status);
    const regular = m.score.duration && m.score.duration !== 'REGULAR' ? m.score.regularTime : m.score.fullTime;
    const score = status === 'FINISHED' && regular && regular.home !== null && regular.away !== null ? { home: regular.home, away: regular.away } : null;
    return {
      externalId: String(m.id),
      competition: { id: String(m.competition.id), name: m.competition.name, country: m.area?.name ?? null },
      home: { id: String(m.homeTeam.id), name: m.homeTeam.name, shortName: m.homeTeam.tla ?? m.homeTeam.shortName ?? null },
      away: { id: String(m.awayTeam.id), name: m.awayTeam.name, shortName: m.awayTeam.tla ?? m.awayTeam.shortName ?? null },
      kickoffAt: new Date(m.utcDate),
      // A finished match without a usable regular-time score cannot be settled yet.
      status: status === 'FINISHED' && !score ? 'SUSPENDED' : status,
      score,
      updatedAt: m.lastUpdated ? new Date(m.lastUpdated) : null,
    };
  });
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function footballDataProvider(opts: { apiKey: string; competitions: string; fetchImpl?: typeof fetch }): FixturesProvider {
  return {
    name: 'football-data',
    async fetchFixtures(from, to) {
      if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * 86_400_000) throw new ProviderError('football-data', 'window longer than 10 days');
      const url = new URL(`${BASE}/matches`);
      url.searchParams.set('competitions', opts.competitions);
      url.searchParams.set('dateFrom', isoDate(from));
      url.searchParams.set('dateTo', isoDate(to));
      const { data } = await fetchJson({
        provider: 'football-data',
        url,
        headers: { 'X-Auth-Token': opts.apiKey },
        schema: footballDataResponse,
        minIntervalMs: MIN_INTERVAL_MS,
        fetchImpl: opts.fetchImpl,
      });
      return mapMatches(data);
    },
  };
}
