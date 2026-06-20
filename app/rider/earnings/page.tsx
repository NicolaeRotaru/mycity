'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Landmark, TrendingUp, Zap, Check, Banknote } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { LoadingState } from '@/components/ui/LoadingState';
import { Card } from '@/components/ui/Card';
import { queryKeys } from '@/lib/queries/keys';
import RiderConnectButton from '@/components/rider/RiderConnectButton';

type PeriodKey = 'today' | '7d' | '30d' | 'all';
const PERIODS: { key: PeriodKey; label: string; days: number | null }[] = [
  { key: 'today', label: 'Oggi',       days: 0 },
  { key: '7d',    label: '7 giorni',   days: 7 },
  { key: '30d',   label: '30 giorni',  days: 30 },
  { key: 'all',   label: 'Tutto',      days: null },
];

const DAILY_GOAL = 5; // consegne/giorno per il bonus

export default function RiderEarningsPage() {
  const [period, setPeriod] = useState<PeriodKey>('7d');

  const { data: orders = [], isLoading } = useQuery({
    queryKey: queryKeys.rider.earnings,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('orders')
        .select('id, shipping_cost, delivered_at, rider_payout_status, payment_method, delivery_city, delivery_address')
        .eq('rider_id', user.id)
        .eq('delivery_status', 'DELIVERED')
        .order('delivered_at', { ascending: false });
      if (error) throw error;
      type EarningOrder = {
        id: string; shipping_cost: number | null; delivered_at: string | null;
        rider_payout_status: string | null; payment_method: string | null;
        delivery_city: string | null; delivery_address: string | null;
      };
      return (data ?? []) as EarningOrder[];
    },
  });

  const filtered = useMemo(() => {
    const conf = PERIODS.find((p) => p.key === period)!;
    if (conf.days === null) return orders;
    if (conf.days === 0) {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      return orders.filter((o) => o.delivered_at && new Date(o.delivered_at) >= startOfToday);
    }
    const cutoff = Date.now() - conf.days * 86400000;
    return orders.filter((o) => o.delivered_at && new Date(o.delivered_at).getTime() >= cutoff);
  }, [orders, period]);

  const totalEarned = filtered.reduce((s, o) => s + Number(o.shipping_cost || 0), 0);
  const avgPerDelivery = filtered.length > 0 ? totalEarned / filtered.length : 0;
  const paid = filtered.filter((o) => o.rider_payout_status === 'TRANSFERRED').reduce((s, o) => s + Number(o.shipping_cost || 0), 0);
  const pending = filtered.filter((o) => o.payment_method === 'card' && o.rider_payout_status !== 'TRANSFERRED').reduce((s, o) => s + Number(o.shipping_cost || 0), 0);

  // Consegne di oggi per il bonus giornaliero.
  const todayCount = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return orders.filter((o) => o.delivered_at && new Date(o.delivered_at) >= startOfToday).length;
  }, [orders]);
  const bonusPct = Math.min(100, (todayCount / DAILY_GOAL) * 100);
  const bonusLeft = Math.max(0, DAILY_GOAL - todayCount);
  const bonusReached = todayCount >= DAILY_GOAL;

  // Mini-grafico ultimi 7 giorni
  const daily = useMemo(() => {
    const days: Record<string, { total: number; count: number }> = {};
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      days[d.toISOString().slice(0, 10)] = { total: 0, count: 0 };
    }
    for (const o of orders) {
      const k = (o.delivered_at ?? '').slice(0, 10);
      if (k in days) {
        days[k].total += Number(o.shipping_cost || 0);
        days[k].count += 1;
      }
    }
    return Object.entries(days);
  }, [orders]);
  const maxDaily = Math.max(...daily.map(([, v]) => v.total), 1);

  if (isLoading) return <LoadingState />;

  return (
    <div className="pb-5">
      {/* ScreenHead */}
      <div className="px-5 pb-2 pt-4">
        <h1 className="font-serif text-[26px] font-extrabold text-ink-900">Guadagni</h1>
        <p className="mt-0.5 text-[13px] text-ink-500">Tutto quello che hai incassato</p>
      </div>

      {/* Period switcher */}
      <div className="flex gap-1.5 overflow-x-auto px-4 pb-3.5">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriod(p.key)}
            className={`shrink-0 rounded-full px-3.5 py-[7px] text-[13px] font-semibold transition-colors ${
              period === p.key
                ? 'bg-accent-500 text-ink-900'
                : 'bg-surface-0 text-ink-600 ring-1 ring-inset ring-cream-300'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Big number */}
      <div className="px-4 pb-4">
        <div className="rounded-2xl border border-accent-200 bg-gradient-to-br from-accent-100 to-cream-200 p-[22px]">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-accent-800">Hai guadagnato</p>
          <p className="mt-1 font-serif text-[46px] font-extrabold leading-none text-ink-900">{formatPrice(totalEarned)}</p>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <div className="rounded-md bg-white/60 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase text-ink-500">Consegne</p>
              <p className="font-serif text-xl font-extrabold text-ink-900">{filtered.length}</p>
            </div>
            <div className="rounded-md bg-white/60 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase text-ink-500">Media/consegna</p>
              <p className="font-serif text-xl font-extrabold text-ink-900">{formatPrice(avgPerDelivery)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Bonus giornaliero */}
      <div className="px-4 pb-4">
        <Card variant="bordered" padding="md">
          <div className="mb-2.5 flex items-center gap-2">
            <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${bonusReached ? 'bg-olive-100' : 'bg-accent-100'}`}>
              {bonusReached
                ? <Check size={16} className="text-olive-700" strokeWidth={2.4} aria-hidden />
                : <Zap size={16} className="text-accent-700" aria-hidden />}
            </span>
            <div className="flex-1">
              <p className="text-sm font-bold text-ink-900">Bonus giornaliero</p>
              <p className="text-xs text-ink-500">
                {bonusReached
                  ? 'Obiettivo raggiunto: +2,00 € sbloccati!'
                  : `Ancora ${bonusLeft} ${bonusLeft === 1 ? 'consegna' : 'consegne'} per +2,00 €`}
              </p>
            </div>
            <span className={`text-base font-extrabold ${bonusReached ? 'text-olive-700' : 'text-accent-800'}`}>+{formatPrice(2)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-cream-200">
            <div
              className={`h-full rounded-full transition-all ${bonusReached ? 'bg-olive-500' : 'bg-gradient-to-r from-accent-400 to-accent-600'}`}
              style={{ width: `${bonusPct}%` }}
            />
          </div>
          <p className="mt-1.5 text-right text-[11px] text-ink-400">{todayCount}/{DAILY_GOAL} consegne oggi</p>
        </Card>
      </div>

      {/* Proiezione */}
      <div className="px-4 pb-4">
        <div className="flex items-center gap-2.5 rounded-lg border border-primary-200 bg-primary-50 px-3.5 py-3">
          <TrendingUp size={18} className="shrink-0 text-primary-700" aria-hidden />
          <p className="text-[13px] leading-relaxed text-primary-900">
            Resta online nelle ore di punta (<strong>12–14</strong> e <strong>19–21</strong>) per chiudere prima la giornata.
          </p>
        </div>
      </div>

      {/* Chart 7 giorni */}
      <div className="px-4 pb-4">
        <Card variant="bordered" padding="md">
          <p className="mb-3.5 text-sm font-bold text-ink-900">Ultimi 7 giorni</p>
          <div className="flex h-[110px] items-end gap-2">
            {daily.map(([day, v]) => {
              const pct = (v.total / maxDaily) * 100;
              return (
                <div key={day} className="flex h-full flex-1 flex-col items-center gap-1.5">
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t-sm bg-gradient-to-t from-accent-600 to-accent-400"
                      style={{ height: `${Math.max(pct, 4)}%` }}
                      title={`${formatPrice(v.total)} · ${v.count} consegne`}
                    />
                  </div>
                  <span className="text-[10px] text-ink-400">
                    {new Date(day).toLocaleDateString('it', { weekday: 'short' }).slice(0, 1).toUpperCase()}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Payout + IBAN */}
      <div className="px-4 pb-4">
        <Card variant="flat" padding="md" className="border border-olive-200 bg-olive-50">
          <div className="flex items-start gap-2.5">
            <Landmark size={18} className="shrink-0 text-olive-700" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-olive-900">Compensi sul tuo IBAN</p>
              <p className="mt-1 text-xs leading-relaxed text-olive-800">
                <strong>{formatPrice(paid)}</strong> già versati · <strong>{formatPrice(pending)}</strong> in arrivo (consegne con carta).
                I contanti li incassi direttamente alla consegna.
              </p>
              <div className="mt-3">
                <RiderConnectButton />
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Storico consegne (filtrato dal periodo) */}
      <div className="px-4">
        <p className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.03em] text-ink-700">Storico consegne</p>
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-cream-300 bg-surface-0 p-8 text-center text-sm text-ink-500">
            Nessuna consegna in questo periodo.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.slice(0, 20).map((o) => (
              <div key={o.id} className="flex items-center gap-3 rounded-lg border border-cream-300 bg-surface-0 px-3.5 py-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-olive-50 text-olive-700">
                  <Check size={17} strokeWidth={2.4} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-ink-900">
                    {o.delivery_address}{o.delivery_city ? `, ${o.delivery_city}` : ''}
                  </p>
                  <p className="text-[11px] text-ink-400">
                    {o.delivered_at ? new Date(o.delivered_at).toLocaleDateString('it-IT') : '—'} · {o.payment_method === 'cod' ? 'Contanti' : 'Carta'}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 font-bold text-olive-700">
                  <Banknote size={14} className="text-olive-600" aria-hidden />
                  {formatPrice(o.shipping_cost || 0)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
