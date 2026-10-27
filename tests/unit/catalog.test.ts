import { describe, expect, it } from 'vitest';
import { getGameModule } from '@/engine/games/registry';
import { GAME_CONTENT } from '@/content/games';
import { CATALOG, catalogEntries, GAME_CATEGORIES, isNewGame } from '@/server/games/catalog';

describe('catalogue', () => {
  it('every entry has a registered engine, published rules, known categories and a valid date', () => {
    for (const e of catalogEntries()) {
      expect(getGameModule(e.id).id).toBe(e.id);
      expect(GAME_CONTENT[e.id], `rules for ${e.id}`).toBeDefined();
      expect(e.categories.length).toBeGreaterThan(0);
      for (const c of e.categories) expect(Object.keys(GAME_CATEGORIES)).toContain(c);
      expect(Number.isNaN(Date.parse(e.addedOn))).toBe(false);
      expect(e.limits.minStake).toBeLessThanOrEqual(e.limits.maxStake);
    }
  });

  it('"new" means added after the launch catalogue, for 60 days', () => {
    const launch = CATALOG.dice!;
    const added = CATALOG.keno!;
    expect(isNewGame(launch, new Date('2026-10-27T12:00:00Z'))).toBe(false);
    expect(isNewGame(added, new Date('2026-10-27T12:00:00Z'))).toBe(true);
    expect(isNewGame(added, new Date('2026-12-25T00:00:00Z'))).toBe(true);
    expect(isNewGame(added, new Date('2026-12-27T00:00:01Z'))).toBe(false);
  });
});
