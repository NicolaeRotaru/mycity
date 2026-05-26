'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Users, ShoppingCart, Package } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { LoadingState } from '@/components/ui/LoadingState';

/**
 * Admin: Funnel signup → first order + Cohort retention.
 *
 * Esperti consultati:
 * - Data Analyst: "Senza cohort retention non sai se buyer del mese N tornano
 *   nel mese N+1. È la metrica #1 marketplace dopo PMF."
 * - Growth PM: "Funnel signup→first order è THE activation metric.
 *   Glovo: 35-40%. Sotto 20% = problem."
 * - Senior PM: "Mostra anche % buyer attivi vs registrati."
 *
 * Calcoli fatti client-side per evitare aggiunta RPC. Pre-PMF (volumes basso)
 * è acceptable. Quando hai >10k user, ottimizza con view materializzata.
 */

type FunnelData = {
  signups: number;
  firstOrderWithin7d: number;
  firstOrderEver: number;
  multipleOrders: number;
  cohortRetention: { month: string; cohortSize: number; m1: number; m2: number; m3: number }[];
};

export default function AdminFunnelPage() {
  const [periodDays, setPeriodDays] = useState(90);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-funnel', periodDays],
    queryFn: async (): Promise<FunnelData> => {
      const since = new Date(Date.now() - periodDays * 86_400_000).toISOString();

      // Buyer signups nel periodo
      const { data: signupsList } = await supabase
        .from('profiles')
        .select('id, created_at')
        .eq('role', 'buyer')
        .gte('created_at', since);

      const userIds = (signupsList ?? []).map((u: any) => u.id);

      // Orders di questi utenti
      const { data: orders } = userIds.length > 0
        ? await supabase
            .from('orders')
            .select('user_id, created_at, delivery_status')
            .in('user_id', userIds)
            .neq('delivery_status', 'CANCELED')
        : { data: [] as any[] };

      const orderMap = new Map<string, Date[]>();
      for (const o of (orders ?? [])) {
        const arr = orderMap.get(o.user_id) ?? [];
        arr.push(new Date(o.created_at));
        orderMap.set(o.user_id, arr);
      }

      let firstOrderWithin7d = 0;
      let firstOrderEver = 0;
      let multipleOrders = 0;

      for (const u of (signupsList ?? [])) {
        const userOrders = (orderMap.get(u.id) ?? []).sort((a, b) => a.getTime() - b.getTime());
        if (userOrders.length === 0) continue;
        firstOrderEver++;
        const signupTime = new Date(u.created_at).getTime();
        if (userOrders[0].getTime() - signupTime < 7 * 86_400_000) firstOrderWithin7d++;
        if (userOrders.length > 1) multipleOrders++;
      }

      // Cohort retention (semplice: 3 mesi)
      const now = new Date();
      const cohortMonths: { month: string; cohortSize: number; m1: number; m2: number; m3: number }[] = [];
      for (let i = 3; i >= 0; i--) {
        const cohortStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const cohortEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        const cohort = (signupsList ?? []).filter((u: any) => {
          const t = new Date(u.created_at);
          return t >= cohortStart && t < cohortEnd;
        });
        if (cohort.length === 0) {
          cohortMonths.push({ month: cohortStart.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' }), cohortSize: 0, m1: 0, m2: 0, m3: 0 });
          continue;
        }

        const activeIn = (offsetMonths: number) => {
          const winStart = new Date(cohortStart.getFullYear(), cohortStart.getMonth() + offsetMonths, 1);
          const winEnd = new Date(cohortStart.getFullYear(), cohortStart.getMonth() + offsetMonths + 1, 1);
          let active = 0;
          for (const u of cohort) {
            const userOrders = orderMap.get(u.id) ?? [];
            if (userOrders.some((d) => d >= winStart && d < winEnd)) active++;
          }
          return active;
        };

        const m1 = activeIn(1);
        const m2 = activeIn(2);
        const m3 = activeIn(3);
        cohortMonths.push({
          month: cohortStart.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' }),
          cohortSize: cohort.length,
          m1, m2, m3,
        });
      }

      return {
        signups: signupsList?.length ?? 0,
        firstOrderWithin7d,
        firstOrderEver,
        multipleOrders,
        cohortRetention: cohortMonths,
      };
    },
  });

  if (isLoading || !data) return <LoadingState />;

  const activation7d = data.signups > 0 ? (data.firstOrderWithin7d / data.signups) * 100 : 0;
  const activationEver = data.signups > 0 ? (data.firstOrderEver / data.signups) * 100 : 0;
  const repeatBuyer = data.firstOrderEver > 0 ? (data.multipleOrders / data.firstOrderEver) * 100 : 0;

  const FunnelRow = ({ icon: Icon, label, value, total, color }: any) => {
    const pct = total > 0 ? (value / total) * 100 : 0;
    return (
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-${color}-50 text-${color}-700`}>
            <Icon size={16} strokeWidth={2.2} />
          </div>
          <span className="font-semibold text-ink-900 flex-1">{label}</span>
          <span className="text-sm font-bold">{value} <span className="text-ink-500 font-normal">/ {total} ({pct.toFixed(1)}%)</span></span>
        </div>
        <div className="w-full h-2 bg-cream-100 rounded-full overflow-hidden">
          <div className={`h-full bg-${color}-500`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900 flex items-center gap-2">
            <TrendingUp size={22} className="text-primary-700" strokeWidth={2.2} />
            Funnel & Cohort
          </h1>
          <p className="text-sm text-ink-500 mt-1">Activation buyer + retention cohort.</p>
        </div>
        <select
          value={periodDays}
          onChange={(e) => setPeriodDays(Number(e.target.value))}
          className="bg-white border border-cream-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value={30}>Ultimi 30 giorni</option>
          <option value={90}>Ultimi 90 giorni</option>
          <option value={365}>Ultimo anno</option>
        </select>
      </header>

      {/* Funnel activation */}
      <section className="bg-white border border-cream-300 rounded-xl p-6 space-y-4">
        <h2 className="font-bold text-ink-900 mb-2">Funnel activation</h2>
        <FunnelRow icon={Users} label="Signup buyer" value={data.signups} total={data.signups} color="primary" />
        <FunnelRow icon={ShoppingCart} label="1° ordine entro 7gg" value={data.firstOrderWithin7d} total={data.signups} color="accent" />
        <FunnelRow icon={Package} label="1° ordine mai (totale)" value={data.firstOrderEver} total={data.signups} color="olive" />
        <FunnelRow icon={TrendingUp} label="Multi-buyer (>1 ordine)" value={data.multipleOrders} total={data.firstOrderEver} color="secondary" />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-cream-200">
          <div>
            <p className="text-xs uppercase tracking-wider text-ink-500">Activation 7gg</p>
            <p className={`text-3xl font-bold ${activation7d >= 30 ? 'text-olive-700' : activation7d >= 15 ? 'text-accent-700' : 'text-rose-700'}`}>
              {activation7d.toFixed(1)}%
            </p>
            <p className="text-xs text-ink-500">target Glovo: 35-40%</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-ink-500">Activation totale</p>
            <p className="text-3xl font-bold text-ink-900">{activationEver.toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-ink-500">% buyer ricorrente</p>
            <p className="text-3xl font-bold text-ink-900">{repeatBuyer.toFixed(1)}%</p>
            <p className="text-xs text-ink-500">target sano: &gt;40%</p>
          </div>
        </div>
      </section>

      {/* Cohort retention */}
      <section className="bg-white border border-cream-300 rounded-xl p-6">
        <h2 className="font-bold text-ink-900 mb-3">Cohort retention</h2>
        <p className="text-xs text-ink-500 mb-4">
          % buyer di una coorte mensile che ha fatto almeno 1 ordine nei mesi successivi.
        </p>
        <table className="w-full text-sm">
          <thead className="text-ink-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2">Coorte</th>
              <th className="text-right px-3 py-2">Signup</th>
              <th className="text-right px-3 py-2">M+1</th>
              <th className="text-right px-3 py-2">M+2</th>
              <th className="text-right px-3 py-2">M+3</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cream-100">
            {data.cohortRetention.map((c) => {
              const m1pct = c.cohortSize > 0 ? (c.m1 / c.cohortSize) * 100 : 0;
              const m2pct = c.cohortSize > 0 ? (c.m2 / c.cohortSize) * 100 : 0;
              const m3pct = c.cohortSize > 0 ? (c.m3 / c.cohortSize) * 100 : 0;
              const color = (pct: number) => pct >= 40 ? 'bg-olive-100 text-olive-800' : pct >= 20 ? 'bg-accent-100 text-accent-800' : pct > 0 ? 'bg-rose-100 text-rose-800' : 'text-ink-400';
              return (
                <tr key={c.month}>
                  <td className="px-3 py-2 font-semibold capitalize">{c.month}</td>
                  <td className="px-3 py-2 text-right">{c.cohortSize}</td>
                  <td className="px-3 py-2 text-right"><span className={`inline-block px-2 py-0.5 rounded ${color(m1pct)}`}>{m1pct.toFixed(0)}%</span></td>
                  <td className="px-3 py-2 text-right"><span className={`inline-block px-2 py-0.5 rounded ${color(m2pct)}`}>{m2pct.toFixed(0)}%</span></td>
                  <td className="px-3 py-2 text-right"><span className={`inline-block px-2 py-0.5 rounded ${color(m3pct)}`}>{m3pct.toFixed(0)}%</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
