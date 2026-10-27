/** Normalised provider data. Every provider adapter maps its own payloads to these shapes. */
export type ProviderEventStatus = 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'CANCELLED' | 'SUSPENDED';

export interface ProviderFixture {
  /** Provider-scoped match id. */
  externalId: string;
  competition: { id: string; name: string; country: string | null };
  home: { id: string; name: string; shortName: string | null };
  away: { id: string; name: string; shortName: string | null };
  kickoffAt: Date;
  status: ProviderEventStatus;
  /** Regular-time score (1X2 settles on 90 minutes plus stoppage time), only when FINISHED. */
  score: { home: number; away: number } | null;
  updatedAt: Date | null;
}

export interface ProviderOdds {
  /** Odds-provider event id (mapped onto a fixture by teams and kick-off time). */
  externalId: string;
  homeName: string;
  awayName: string;
  kickoffAt: Date;
  /** Human-readable bookmaker name, shown with the prices. */
  bookmaker: string;
  updatedAt: Date;
  /** Decimal odds ×100, or null when the bookmaker offers no price. */
  odds: { HOME: number | null; DRAW: number | null; AWAY: number | null };
}

export interface FixturesProvider {
  readonly name: string;
  fetchFixtures(from: Date, to: Date): Promise<ProviderFixture[]>;
}

export interface OddsProvider {
  readonly name: string;
  fetchOdds(): Promise<ProviderOdds[]>;
}
