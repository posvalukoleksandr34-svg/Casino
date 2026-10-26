'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { hashServerSeed } from '@/engine/rng/provably-fair';
import { verifiableGames, verifyOutcome } from '@/engine/verify';
import { api, errorMessage } from '@/lib/api';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Field, Input, Select } from '../ui/form';
import { Callout, Mono } from '../ui/misc';
import { useToast } from '../ui/toast';
import { GAME_NAMES } from './labels';

interface Overview {
  active: { serverSeedHash: string; clientSeed: string; nextNonce: number } | null;
  revealed: { serverSeedHash: string; serverSeed: string | null; clientSeed: string; nonceCount: number; revealedAt: string | Date | null }[];
}

export function SeedManager({ initial }: { initial: Overview }) {
  const router = useRouter();
  const toast = useToast();
  const [clientSeed, setClientSeed] = useState('');
  const [busy, setBusy] = useState(false);
  async function rotate() {
    setBusy(true);
    try {
      await api('/api/fairness/rotate', { method: 'POST', body: clientSeed ? { clientSeed } : {} });
      setClientSeed('');
      toast.push({ tone: 'positive', title: 'Seed rotated', body: 'Your previous server seed is now revealed below.' });
      router.refresh();
    } catch (err) {
      toast.push({ tone: 'negative', title: 'Could not rotate seed', body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Active seed pair" subtitle="Used for your next rounds. The server seed stays secret until you rotate." />
        <CardBody className="space-y-4 text-sm">
          {initial.active ? (
            <>
              <div>
                <div className="text-xs text-ink-500">Server seed commitment (SHA-256)</div>
                <Mono>{initial.active.serverSeedHash}</Mono>
              </div>
              <div className="flex flex-wrap gap-6">
                <div>
                  <div className="text-xs text-ink-500">Client seed</div>
                  <Mono>{initial.active.clientSeed}</Mono>
                </div>
                <div>
                  <div className="text-xs text-ink-500">Next nonce</div>
                  <Mono>{initial.active.nextNonce}</Mono>
                </div>
              </div>
            </>
          ) : (
            <p className="text-ink-400">A seed pair is created with your first round.</p>
          )}
          <div className="hairline" />
          <Field label="New client seed (optional)" hint="Up to 64 printable characters, no spaces. Leave blank for a random one.">
            {(p) => <Input {...p} value={clientSeed} maxLength={64} onChange={(e) => setClientSeed(e.target.value.replace(/\s/g, ''))} />}
          </Field>
          <Button variant="primary" onClick={rotate} loading={busy}>
            Rotate & reveal current seed
          </Button>
          <p className="text-xs text-ink-500">Rotation is unavailable while a round using the current seed is still open, because revealing the seed would expose its outcome.</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Revealed seeds" subtitle="Check each seed against the commitment you were shown before playing." />
        <CardBody>
          {initial.revealed.length === 0 ? (
            <p className="text-sm text-ink-400">No seeds revealed yet.</p>
          ) : (
            <ul className="space-y-4 text-xs">
              {initial.revealed.map((r) => (
                <li key={r.serverSeedHash} className="space-y-1.5 rounded-xl border border-ink-700 p-3">
                  <div>
                    <span className="text-ink-500">Seed </span>
                    <Mono>{r.serverSeed}</Mono>
                  </div>
                  <div>
                    <span className="text-ink-500">Commitment </span>
                    <Mono>{r.serverSeedHash}</Mono>
                  </div>
                  <div className="flex flex-wrap gap-4 text-ink-400">
                    <span>client seed {r.clientSeed}</span>
                    <span>nonces 0–{Math.max(0, r.nonceCount - 1)}</span>
                    <span className={r.serverSeed && hashServerSeed(r.serverSeed) === r.serverSeedHash ? 'text-positive' : 'text-negative'}>
                      {r.serverSeed && hashServerSeed(r.serverSeed) === r.serverSeedHash ? '✓ matches commitment' : '✗ mismatch'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export function Verifier() {
  const params = useSearchParams();
  const games = verifiableGames();
  const [game, setGame] = useState(params.get('game') ?? 'dice');
  const [serverSeed, setServerSeed] = useState(params.get('serverSeed') ?? '');
  const [clientSeed, setClientSeed] = useState(params.get('clientSeed') ?? '');
  const [nonce, setNonce] = useState(params.get('nonce') ?? '0');
  const [commitment, setCommitment] = useState('');
  const [extra, setExtra] = useState<Record<string, string>>(() => ({ mines: params.get('mines') ?? '3', decks: params.get('decks') ?? '6' }));

  useEffect(() => {
    if (params.get('game')) document.getElementById('verify')?.scrollIntoView();
  }, [params]);

  const result = useMemo(() => {
    if (!serverSeed || !clientSeed) return null;
    try {
      return { ok: true as const, value: verifyOutcome(game, { serverSeed, clientSeed, nonce: Number(nonce) }, { mines: Number(extra.mines), decks: Number(extra.decks) }) };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  }, [game, serverSeed, clientSeed, nonce, extra]);

  return (
    <Card id="verify">
      <CardHeader title="Verify a round" subtitle="Computed entirely in your browser with the same open code the server runs — nothing is sent to Aurovane." />
      <CardBody className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          <Field label="Game">
            {(p) => (
              <Select {...p} value={game} onChange={(e) => setGame(e.target.value)}>
                {games.map((g) => (
                  <option key={g} value={g}>
                    {GAME_NAMES[g] ?? g}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Server seed (revealed)">{(p) => <Input {...p} className="font-mono text-xs" value={serverSeed} onChange={(e) => setServerSeed(e.target.value.trim())} />}</Field>
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <Field label="Client seed">{(p) => <Input {...p} className="font-mono text-xs" value={clientSeed} onChange={(e) => setClientSeed(e.target.value.trim())} />}</Field>
            <Field label="Nonce">{(p) => <Input {...p} inputMode="numeric" value={nonce} onChange={(e) => setNonce(e.target.value.replace(/\D/g, ''))} />}</Field>
          </div>
          {game === 'mines' && (
            <Field label="Number of mines">{(p) => <Input {...p} inputMode="numeric" value={extra.mines} onChange={(e) => setExtra((x) => ({ ...x, mines: e.target.value }))} />}</Field>
          )}
          {game === 'blackjack' && (
            <Field label="Decks in the shoe">
              {(p) => (
                <Select {...p} value={extra.decks} onChange={(e) => setExtra((x) => ({ ...x, decks: e.target.value }))}>
                  <option value="6">6</option>
                  <option value="8">8</option>
                </Select>
              )}
            </Field>
          )}
          <Field label="Commitment shown before play (optional)" hint="Paste the SHA-256 hash to check the seed was not changed.">
            {(p) => <Input {...p} className="font-mono text-xs" value={commitment} onChange={(e) => setCommitment(e.target.value.trim())} />}
          </Field>
        </div>
        <div className="space-y-4">
          {!result && <p className="text-sm text-ink-400">Enter a revealed server seed and a client seed to recompute the outcome.</p>}
          {result && !result.ok && <Callout tone="negative">{result.error}</Callout>}
          {result && result.ok && (
            <>
              <div className="surface-raised p-5">
                <div className="text-[11px] uppercase tracking-[0.14em] text-ink-400">Recomputed outcome</div>
                <div className="mt-2 font-display text-3xl text-gold-200" data-testid="verify-outcome">
                  {result.value.description}
                </div>
              </div>
              <div className="text-xs">
                <div className="text-ink-500">SHA-256(server seed)</div>
                <Mono>{result.value.serverSeedHash}</Mono>
                {commitment && (
                  <div className={result.value.serverSeedHash === commitment.toLowerCase() ? 'mt-2 text-positive' : 'mt-2 text-negative'}>
                    {result.value.serverSeedHash === commitment.toLowerCase() ? '✓ Matches the commitment' : '✗ Does not match the commitment'}
                  </div>
                )}
              </div>
              <pre className="overflow-x-auto rounded-lg bg-ink-900 p-3 text-xs text-ink-300">{JSON.stringify(result.value.outcome, null, 2)}</pre>
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
