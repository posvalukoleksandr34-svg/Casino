'use client';

import { useState } from 'react';
import { formatChips } from '@/engine/money';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useSession } from '../layout/session-provider';
import { Button } from '../ui/button';
import { useToast } from '../ui/toast';

export interface Offer {
  id: number;
  name: string;
  description: string;
  amount: number;
  wageringMultiplier: number;
  expiresAfterDays: number;
  endsAt: string | null;
  eligible: boolean;
  reason: string | null;
}
export interface ClaimRow {
  id: number;
  campaign: string;
  amount: number;
  wageringRequired: number;
  wageringProgress: number;
  status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'FORFEITED';
  expiresAt: string;
  claimedAt: string;
  closedAt: string | null;
}
export interface Overview {
  offers: Offer[];
  active: ClaimRow | null;
  claims: ClaimRow[];
  grants: { type: string; amount: number; createdAt: string }[];
}

const STATUS: Record<ClaimRow['status'], [string, string]> = {
  ACTIVE: ['In progress', 'border-gold-400/50 text-gold-200'],
  COMPLETED: ['Released', 'border-positive/50 text-positive'],
  EXPIRED: ['Expired', 'border-white/15 text-ink-400'],
  FORFEITED: ['Forfeited', 'border-white/15 text-ink-400'],
};

/** The player's bonus dashboard. Every number comes from the server; the page only asks it to act. */
export function BonusDashboard({ initial }: { initial: Overview }) {
  const toast = useToast();
  const { refresh } = useSession();
  const [data, setData] = useState(initial);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);

  async function reload() {
    setData(await api<Overview>('/api/promotions'));
    await refresh();
  }

  async function claim(body: { campaignId: number } | { code: string }, label: string) {
    setBusy(label);
    setCodeError(null);
    try {
      const res = await api<{ amount: number; wageringRequired: number; released: boolean }>('/api/promotions/claim', { method: 'POST', body });
      toast.push({
        tone: 'positive',
        title: `${formatChips(res.amount)} bonus credits ${res.released ? 'added to your wallet' : 'claimed'}`,
        body: res.released ? 'No wagering needed.' : `Wager ${formatChips(res.wageringRequired)} credits to release them.`,
      });
      setCode('');
      await reload();
    } catch (err) {
      if ('code' in body) setCodeError(errorMessage(err));
      else toast.push({ tone: 'negative', title: 'Could not claim the offer', body: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  async function forfeit(id: number) {
    if (!window.confirm('Forfeit this bonus? Its locked credits will not be released, and the offer cannot be claimed again.')) return;
    setBusy('forfeit');
    try {
      await api('/api/promotions/forfeit', { method: 'POST', body: { claimId: id } });
      toast.push({ tone: 'info', title: 'Bonus forfeited' });
      await reload();
    } catch (err) {
      toast.push({ tone: 'negative', title: 'Could not forfeit the bonus', body: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  const a = data.active;
  const pct = a ? (a.wageringRequired > 0 ? Math.min(100, (a.wageringProgress / a.wageringRequired) * 100) : 100) : 0;

  return (
    <div className="space-y-6">
      {a && (
        <section aria-labelledby="active-h" className="surface relative overflow-hidden p-6" data-testid="active-bonus">
          <div className="pointer-events-none absolute -left-10 -top-24 size-72 rounded-full bg-gold-400/10 blur-3xl" aria-hidden="true" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-300">Bonus in progress</div>
              <h2 id="active-h" className="mt-1 font-display text-3xl font-semibold text-ink-100">
                {a.campaign}
              </h2>
              <p className="mt-1 text-sm text-ink-300">
                <span className="num font-semibold text-gold-200">{formatChips(a.amount)}</span> credits locked until you have wagered{' '}
                <span className="num">{formatChips(a.wageringRequired)}</span>. Expires {new Date(a.expiresAt).toLocaleDateString()}.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => forfeit(a.id)} loading={busy === 'forfeit'} data-testid="forfeit-bonus">
              Forfeit
            </Button>
          </div>
          <div className="relative mt-5">
            <div className="h-3 overflow-hidden rounded-full bg-white/[0.07]" role="progressbar" aria-label="Wagering progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
              <div className="h-full rounded-full bg-gradient-to-r from-gold-600 via-gold-400 to-gold-200 transition-[width] duration-700" style={{ width: `${pct}%` }} />
            </div>
            <div className="num mt-2 flex justify-between text-xs text-ink-400" data-testid="wagering-progress">
              <span>
                {formatChips(a.wageringProgress)} of {formatChips(a.wageringRequired)} wagered
              </span>
              <span>{pct.toFixed(0)}%</span>
            </div>
            <p className="mt-2 text-xs text-ink-400">Every settled casino stake counts. Predictions do not. Locked credits cannot be wagered themselves.</p>
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="offers-h" className="space-y-4">
          <h2 id="offers-h" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-400">
            Offers for you
          </h2>
          {data.offers.length === 0 && <p className="text-sm text-ink-400">No offers right now. Promo codes can still be entered.</p>}
          {data.offers.map((o) => (
            <article key={o.id} className="surface sheen relative overflow-hidden p-6" data-testid="offer">
              <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(60%_80%_at_100%_50%,rgb(199_163_91/0.16),transparent_70%)]" aria-hidden="true" />
              <div className="relative">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-300">Welcome offer</div>
                <h3 className="mt-1 font-display text-3xl font-semibold text-ink-100">{o.name}</h3>
                <div className="num mt-2 text-4xl font-semibold text-gold-200">+{formatChips(o.amount)}</div>
                <div className="text-xs text-ink-400">bonus credits</div>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-300">{o.description}</p>
                <ul className="mt-3 flex flex-wrap gap-2 text-[11px] text-ink-300">
                  <li className="rounded-full border border-white/10 px-2.5 py-1">Wager ×{o.wageringMultiplier}</li>
                  <li className="rounded-full border border-white/10 px-2.5 py-1">{o.expiresAfterDays} days to complete</li>
                  <li className="rounded-full border border-white/10 px-2.5 py-1">Once per account</li>
                </ul>
                <div className="mt-5">
                  <Button variant="primary" disabled={!o.eligible || Boolean(a)} loading={busy === `offer-${o.id}`} onClick={() => claim({ campaignId: o.id }, `offer-${o.id}`)} data-testid="claim-offer">
                    {o.eligible ? (a ? 'Finish your current bonus first' : 'Claim bonus') : 'Not available'}
                  </Button>
                  {o.reason && <p className="mt-2 text-xs text-ink-400">{o.reason}</p>}
                </div>
              </div>
            </article>
          ))}
        </section>

        <section aria-labelledby="code-h" className="surface h-fit p-6">
          <h2 id="code-h" className="text-lg font-semibold text-ink-100">
            Promo code
          </h2>
          <p className="mt-1 text-sm text-ink-400">Codes give bonus credits only. They are never sold, and nothing is paid.</p>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) void claim({ code: code.trim() }, 'code');
            }}
          >
            <label htmlFor="promo-code" className="sr-only">
              Promo code
            </label>
            <input
              id="promo-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20))}
              placeholder="ENTER CODE"
              autoComplete="off"
              className="num h-11 min-w-0 flex-1 rounded-xl border border-white/12 bg-white/[0.05] px-3.5 tracking-[0.2em] text-ink-100 outline-none focus:border-gold-500"
              aria-invalid={codeError ? true : undefined}
              aria-describedby={codeError ? 'promo-code-err' : undefined}
            />
            <Button type="submit" variant="secondary" loading={busy === 'code'} disabled={code.length < 4} data-testid="redeem-code">
              Apply
            </Button>
          </form>
          {codeError && (
            <p id="promo-code-err" className="mt-2 text-sm text-negative" role="alert">
              {codeError}
            </p>
          )}
        </section>
      </div>

      <section aria-labelledby="history-h" className="surface p-6">
        <h2 id="history-h" className="text-lg font-semibold text-ink-100">
          Bonus history
        </h2>
        {data.claims.length === 0 && data.grants.length === 0 ? (
          <p className="mt-2 text-sm text-ink-400">Nothing yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-white/[0.06] text-sm" data-testid="bonus-history">
            {data.claims.map((c) => (
              <li key={`c${c.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span>
                  <span className="text-ink-100">{c.campaign}</span>
                  <span className="block text-xs text-ink-400">
                    Claimed {new Date(c.claimedAt).toLocaleDateString()} · wagered {formatChips(c.wageringProgress)} of {formatChips(c.wageringRequired)}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="num font-semibold text-ink-100">{formatChips(c.amount)}</span>
                  <span className={cn('rounded-full border px-2.5 py-0.5 text-[11px]', STATUS[c.status][1])}>{STATUS[c.status][0]}</span>
                </span>
              </li>
            ))}
            {data.grants.map((g, i) => (
              <li key={`g${i}`} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span>
                  <span className="text-ink-100">{g.type === 'SIGNUP' ? 'Starting credits' : 'Free daily top-up'}</span>
                  <span className="block text-xs text-ink-400">{new Date(g.createdAt).toLocaleDateString()} · no wagering</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="num font-semibold text-ink-100">{formatChips(g.amount)}</span>
                  <span className="rounded-full border border-positive/50 px-2.5 py-0.5 text-[11px] text-positive">Added</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
