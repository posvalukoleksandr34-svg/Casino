/**
 * Pre-match 1X2 prices from The Odds API (v4, `GET /v4/sports/{sport}/odds`,
 * markets=h2h, decimal odds). The key is sent as the `apiKey` query parameter
 * as the provider requires; it never appears in logs or errors (see http.ts).
 * Each request costs quota; the remaining quota is reported to operators.
 */
import { z } from 'zod';
import { fetchJson, oddsToE2 } from './http';
import type { OddsProvider, ProviderOdds } from './types';

const BASE = 'https://api.the-odds-api.com/v4';

const outcome = z.object({ name: z.string().min(1).max(120), price: z.number().positive() });
const eventSchema = z.object({
  id: z.string().min(1).max(100),
  commence_time: z.iso.datetime({ offset: true }),
  home_team: z.string().min(1).max(120),
  away_team: z.string().min(1).max(120),
  bookmakers: z.array(
    z.object({
      key: z.string().max(60),
      title: z.string().max(80),
      last_update: z.iso.datetime({ offset: true }),
      markets: z.array(z.object({ key: z.string(), last_update: z.iso.datetime({ offset: true }).nullish(), outcomes: z.array(outcome) })),
    }),
  ),
});
export const oddsApiResponse = z.array(eventSchema);

/** Picks the configured bookmaker (or the first one with an h2h market) and maps its prices. */
export function mapOdds(payload: z.infer<typeof oddsApiResponse>, bookmaker?: string): ProviderOdds[] {
  const out: ProviderOdds[] = [];
  for (const e of payload) {
    const candidates = e.bookmakers.filter((b) => b.markets.some((m) => m.key === 'h2h'));
    const book = bookmaker ? candidates.find((b) => b.key === bookmaker) : candidates[0];
    if (!book) continue;
    const market = book.markets.find((m) => m.key === 'h2h')!;
    const price = (name: string) => {
      const o = market.outcomes.find((x) => x.name === name);
      return o ? oddsToE2(o.price) : null;
    };
    out.push({
      externalId: e.id,
      homeName: e.home_team,
      awayName: e.away_team,
      kickoffAt: new Date(e.commence_time),
      bookmaker: book.title,
      updatedAt: new Date(market.last_update ?? book.last_update),
      odds: { HOME: price(e.home_team), DRAW: price('Draw'), AWAY: price(e.away_team) },
    });
  }
  return out;
}

export function theOddsApiProvider(opts: {
  apiKey: string;
  sports: string;
  regions: string;
  bookmaker?: string;
  fetchImpl?: typeof fetch;
  onQuota?: (remaining: number | null) => void;
}): OddsProvider {
  return {
    name: 'the-odds-api',
    async fetchOdds() {
      const all: ProviderOdds[] = [];
      for (const sport of opts.sports.split(',')) {
        const url = new URL(`${BASE}/sports/${encodeURIComponent(sport)}/odds`);
        url.searchParams.set('apiKey', opts.apiKey);
        url.searchParams.set('regions', opts.regions);
        url.searchParams.set('markets', 'h2h');
        url.searchParams.set('oddsFormat', 'decimal');
        url.searchParams.set('dateFormat', 'iso');
        const { data, headers } = await fetchJson({ provider: 'the-odds-api', url, schema: oddsApiResponse, minIntervalMs: 1_000, fetchImpl: opts.fetchImpl });
        const remaining = Number(headers.get('x-requests-remaining'));
        opts.onQuota?.(Number.isFinite(remaining) ? remaining : null);
        all.push(...mapOdds(data, opts.bookmaker));
      }
      return all;
    },
  };
}
