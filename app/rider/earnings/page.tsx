'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';
import RiderConnectButton from '@/components/rider/RiderConnectButton';

type PeriodKey = 'today' | '7d' | '30d' | 'all';
const PERIODS: { key: PeriodKey; label: string; days: number | null }[] = [
  { key: 'today', label: 'Oggi',             days: 0 },
  { key: '7d',    label: 'Ultimi 7 giorni',  days: 7 },
  { key: '30d',   label: 'Ultimi 30 giorni', days: 30 },
  { key: 'all',   label: 'Tutto',            days: null },
];

export default function RiderEarningsPage() {
  const [period, setPeriod] = useState<PeriodKey>('30d');

  const { data: orders = [], isLoading } = useQuery({
    queryKey: queryKeys.rider.earnings,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('orders')
        .select('id, shipping_cost, delivered_at, rider_payout_status, payment_method')
        .eq('rider_id', user.id)
        .eq('delivery_status', 'DELIVERED')
        .order('delivered_at', { ascending: false });
      if (error) throw error;
      type EarningOrder = { id: string; shipping_cost: number | null; delivered_at: string | null; rider_payout_status: string | null; payment_method: string | null };
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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold text-ink-900">💶 I tuoi guadagni</h1>
        <p className="text-sm text-ink-500">Tutto quello che hai incassato consegnando.</p>
      </div>

      {/* Period switcher */}
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriod(p.key)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              period === p.key
                ? 'bg-accent-500 text-white'
                : 'bg-cream-100 text-ink-700 hover:bg-cream-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Big number + KPI */}
      <section className="bg-gradient-to-br from-accent-50 via-orange-50 to-rose-50 border-2 border-accent-200 rounded-2xl p-6">
        <p className="text-xs uppercase tracking-widest font-bold text-accent-700">Hai guadagnato</p>
        <p className="text-5xl md:text-6xl font-extrabold text-accent-900 mt-1">{formatPrice(totalEarned)}</p>
        <div className="grid grid-cols-2 gap-4 mt-5">
          <div className="bg-white/60 rounded-lg p-3">
            <p className="text-xs text-ink-500 uppercase">Consegne</p>
            <p className="text-2xl font-bold text-ink-900">{filtered.length}</p>
          </div>
          <div className="bg-white/60 rounded-lg p-3">
            <p className="text-xs text-ink-500 uppercase">Media per consegna</p>
            <p className="text-2xl font-bold text-ink-900">{formatPrice(avgPerDelivery)}</p>
          </div>
        </div>
      </section>

      {/* Daily chart */}
      <section className="bg-white border rounded-xl p-5">
        <h2 className="font-bold text-ink-900 mb-4">Andamento ultimi 7 giorni</h2>
        <div className="flex items-end gap-2 h-32">
          {daily.map(([day, v]) => {
            const pct = (v.total / maxDaily) * 100;
            return (
              <div key={day} className="flex-1 flex flex-col items-center gap-1">
                <div className="flex-1 w-full flex items-end">
                  <div
                    className="w-full bg-gradient-to-t from-accent-500 to-orange-400 rounded-t"
                    style={{ height: `${Math.max(pct, 4)}%` }}
                    title={`${formatPrice(v.total)} · ${v.count} consegne`}
                  />
                </div>
                <span className="text-[10px] text-ink-500">
                  {new Date(day).toLocaleDateString('it', { weekday: 'short' })}
                </span>
                <span className="text-[10px] text-ink-400">{v.count}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Compensi reali + IBAN */}
      <section className="bg-white border rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-bold text-ink-900 mb-1 flex items-center gap-2">🏦 I tuoi compensi</h2>
            <p className="text-sm text-ink-700">
              <strong>{formatPrice(paid)}</strong> già versati ·{' '}
              <strong>{formatPrice(pending)}</strong> in arrivo (consegne con carta).
            </p>
            <p className="text-xs text-ink-500 mt-1">
              Il compenso viene versato sul tuo IBAN circa 24h dopo la consegna. Le consegne in
              contanti le incassi direttamente.
            </p>
          </div>
          <RiderConnectButton />
        </div>
      </section>

      {/* Tips */}
      <section className="bg-gradient-to-r from-primary-50 to-purple-50 border border-primary-200 rounded-xl p-5">
        <h3 className="font-bold text-ink-900 mb-2">🚀 Guadagna di più</h3>
        <ul className="text-sm text-ink-700 space-y-1.5">
          <li>• Tieni la disponibilità ON nei picchi (12-14 e 19-21)</li>
          <li>• Mantieni rating sopra 4.5★ → ricevi consegne prioritarie</li>
          <li>• Consegne ravvicinate = più guadagno/ora</li>
        </ul>
      </section>
    </div>
  );
}
