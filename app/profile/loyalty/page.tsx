'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Flame, Trophy, Gift, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import {
  fetchLoyaltyAccount,
  TIER_META,
  nextTier,
  pointsToEurValue,
  POINTS_REDEEM_RATE,
  type LoyaltyAccount,
} from '@/lib/loyalty';

type Tx = { id: string; delta: number; reason: string; created_at: string };

const REASON_LABEL: Record<string, string> = {
  signup_bonus:     'Bonus iscrizione',
  first_order:      'Primo ordine',
  order_completed:  'Ordine completato',
  streak_7_days:    'Streak 7 giorni',
  streak_30_days:   'Streak 30 giorni',
  streak_100_days:  'Streak 100 giorni',
  referral_bonus:   'Referral amico',
  redeem:           'Sconto applicato',
};

export default function LoyaltyPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.push('/sign-in?returnTo=/profile/loyalty');
        return;
      }
      setUserId(data.user.id);
    });
  }, [router]);

  const { data: account } = useQuery<LoyaltyAccount | null>({
    queryKey: ['loyalty-account', userId],
    enabled: !!userId,
    queryFn: () => fetchLoyaltyAccount(),
  });

  const { data: txs = [] } = useQuery<Tx[]>({
    queryKey: ['loyalty-txs', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from('loyalty_transactions')
        .select('id, delta, reason, created_at')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false })
        .limit(20);
      return (data ?? []) as Tx[];
    },
  });

  if (!userId) return <div className="container mx-auto p-8 text-center text-ink-500">Caricamento…</div>;

  const points = account?.points_balance ?? 0;
  const lifetime = account?.lifetime_earned ?? 0;
  const tier = account?.tier ?? 'bronze';
  const streak = account?.streak_days ?? 0;
  const longest = account?.longest_streak ?? 0;
  const tierMeta = TIER_META[tier];
  const next = nextTier(lifetime, tier);
  const eurValue = pointsToEurValue(points);

  // Progress bar verso prossimo livello
  const currentThreshold = tierMeta.threshold;
  const nextThreshold = next.tier ? TIER_META[next.tier].threshold : lifetime;
  const progress = nextThreshold > currentThreshold
    ? Math.min(100, ((lifetime - currentThreshold) / (nextThreshold - currentThreshold)) * 100)
    : 100;

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-3xl space-y-6">
      <div>
        <Link href="/profile" className="text-sm text-ink-500 hover:text-ink-800">← Torna al profilo</Link>
        <h1 className="text-3xl font-serif font-bold mt-2 text-ink-900">I tuoi punti MyCity</h1>
      </div>

      {/* HERO punti + tier */}
      <div className="bg-gradient-to-br from-primary-700 to-secondary-700 text-white rounded-3xl p-8 shadow-warm-lg relative overflow-hidden">
        <div aria-hidden className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10" />
        <div aria-hidden className="absolute -bottom-16 -left-12 w-56 h-56 rounded-full bg-accent-400/20" />

        <div className="relative">
          <div className="flex items-baseline gap-2">
            <span className="text-6xl md:text-7xl font-serif font-extrabold">{points}</span>
            <span className="text-lg opacity-90">punti</span>
          </div>
          <p className="text-sm opacity-90 mt-1">
            = €{eurValue.toFixed(2)} di sconto disponibili (1 buono ogni {POINTS_REDEEM_RATE} punti)
          </p>

          <div className="mt-6 flex items-center gap-3 bg-white/15 rounded-2xl p-4 backdrop-blur">
            <span className="text-3xl">{tierMeta.emoji}</span>
            <div className="flex-1">
              <p className="text-xs uppercase tracking-wider opacity-80">Il tuo livello</p>
              <p className="text-xl font-serif font-bold">{tierMeta.label}</p>
            </div>
            {next.tier && (
              <div className="text-right">
                <p className="text-xs opacity-80">Al {TIER_META[next.tier].label}</p>
                <p className="text-sm font-bold">{next.remaining} punti</p>
              </div>
            )}
          </div>

          {next.tier && (
            <div className="mt-3">
              <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent-400 rounded-full transition-all duration-700"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Streak card */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white border border-cream-300 rounded-2xl p-5 shadow-warm">
          <div className="flex items-center gap-3 mb-2">
            <Flame size={24} className="text-primary-600" />
            <p className="text-xs uppercase tracking-wider text-ink-500 font-semibold">Streak attuale</p>
          </div>
          <p className="text-3xl font-serif font-bold text-ink-900">{streak} <span className="text-base font-medium text-ink-600">{streak === 1 ? 'giorno' : 'giorni'}</span></p>
          <p className="text-xs text-ink-500 mt-1">
            Visita ogni giorno per accumulare bonus a 7, 30, 100 giorni.
          </p>
        </div>
        <div className="bg-white border border-cream-300 rounded-2xl p-5 shadow-warm">
          <div className="flex items-center gap-3 mb-2">
            <Trophy size={24} className="text-accent-600" />
            <p className="text-xs uppercase tracking-wider text-ink-500 font-semibold">Record personale</p>
          </div>
          <p className="text-3xl font-serif font-bold text-ink-900">{longest} <span className="text-base font-medium text-ink-600">{longest === 1 ? 'giorno' : 'giorni'}</span></p>
          <p className="text-xs text-ink-500 mt-1">Il tuo streak più lungo finora.</p>
        </div>
      </div>

      {/* Come funziona */}
      <div className="bg-cream-50 border border-cream-300 rounded-2xl p-6">
        <h2 className="font-serif font-bold text-lg text-ink-900 mb-4 flex items-center gap-2">
          <Sparkles size={18} className="text-primary-600" />
          Come accumuli punti
        </h2>
        <ul className="space-y-2.5 text-sm text-ink-700">
          {[
            { n: '+1 pt', t: 'per ogni €1 speso negli ordini' },
            { n: '+20 pt', t: 'a 7 giorni di visite consecutive' },
            { n: '+100 pt', t: 'a 30 giorni di streak' },
            { n: '+500 pt', t: 'a 100 giorni di streak' },
            { n: '+50 pt', t: 'per ogni amico che si iscrive con il tuo codice referral' },
            { n: '€5', t: `puoi convertire ${POINTS_REDEEM_RATE} punti in un buono spendibile al checkout` },
          ].map((r) => (
            <li key={r.t} className="flex items-baseline gap-3">
              <span className="text-primary-700 font-bold w-20 shrink-0">{r.n}</span>
              <span>{r.t}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Storico */}
      <div>
        <h2 className="font-serif font-bold text-lg text-ink-900 mb-3">Movimenti recenti</h2>
        {txs.length === 0 ? (
          <div className="bg-white border border-cream-300 rounded-2xl p-8 text-center">
            <Gift size={32} className="mx-auto text-ink-300 mb-3" />
            <p className="text-ink-600 font-medium mb-1">Nessun movimento</p>
            <p className="text-sm text-ink-400">I punti che guadagnerai compariranno qui.</p>
            <Link href="/search" className="inline-flex items-center gap-1 mt-4 text-primary-700 hover:underline font-semibold text-sm">
              Vai allo shopping <ChevronRight size={14} />
            </Link>
          </div>
        ) : (
          <div className="bg-white border border-cream-300 rounded-2xl divide-y divide-cream-200 overflow-hidden">
            {txs.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-ink-900">{REASON_LABEL[tx.reason] ?? tx.reason}</p>
                  <p className="text-xs text-ink-400">{new Date(tx.created_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
                <span className={`font-bold ${tx.delta >= 0 ? 'text-olive-700' : 'text-primary-700'}`}>
                  {tx.delta >= 0 ? '+' : ''}{tx.delta} pt
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
