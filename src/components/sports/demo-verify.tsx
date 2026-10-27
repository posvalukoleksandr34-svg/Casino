'use client';

import { useMemo } from 'react';
import { createRandomStream, hashServerSeed } from '@/engine/rng/provably-fair';
import { demoClientSeed, drawScore, validateScoreModel, type ScoreModel } from '@/engine/sports/model';
import { Callout, Mono } from '../ui/misc';

/** Recomputes a demo result in the browser from the revealed seed and the published model. */
export function DemoVerify({ eventId, seedHash, seed, model, score }: { eventId: string; seedHash: string; seed: string; model: ScoreModel; score: { home: number; away: number } | null }) {
  const check = useMemo(() => {
    try {
      validateScoreModel(model);
      const hashOk = hashServerSeed(seed) === seedHash;
      const recomputed = drawScore(model, createRandomStream({ serverSeed: seed, clientSeed: demoClientSeed(eventId), nonce: 0 }));
      return { ok: true as const, hashOk, recomputed, matches: score !== null && recomputed.home === score.home && recomputed.away === score.away };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  }, [eventId, seedHash, seed, model, score]);
  if (!check.ok) return <Callout tone="negative">{check.error}</Callout>;
  return (
    <div className="space-y-2 text-sm" data-testid="demo-verify">
      <div className={check.hashOk ? 'text-positive' : 'text-negative'}>{check.hashOk ? '✓ SHA-256 of the revealed seed matches the published hash' : '✗ The revealed seed does not match the published hash'}</div>
      <div className={check.matches ? 'text-positive' : 'text-negative'}>
        Recomputed in your browser: <Mono>{`${check.recomputed.home} – ${check.recomputed.away}`}</Mono>{' '}
        {check.matches ? '✓ matches the recorded result' : '✗ differs from the recorded result'}
      </div>
    </div>
  );
}
