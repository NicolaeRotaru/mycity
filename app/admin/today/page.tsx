'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  ShoppingBag, TrendingUp, AlertTriangle, UserCheck, Euro,
  Clock, Package, AlertCircle, CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';

/**
 * Admin "Today" dashboard — 1 colpo d'occhio per tutte le metriche vitali.
 *
 * Esperti consultati:
 * - Senior PM: "Senza /today dashboard, founder perde 30 min al giorno a navigare
 *   sezioni diverse. Concentrato qui = velocità decisionale."
 * - Data Analyst: "Numeri vitali: GMV oggi, ordini in problema, seller pending,
 *   SOS attivi, dispute aperte. Ognuno con link diretto."
 * - SRE: "Refresh ogni 30s. Niente realtime (overkill per admin)."
 */

export default function AdminTodayPage() {
  const { data: stats } = useQuery({
    queryKey: queryKeys.admin.today,
    refetchInterval: 30_000,
    queryFn: async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [
        ordersToday,
        ordersPending,
        ordersProblem,
        sellersPending,
        sosActive,
        disputesOpen,
        signupsToday,
        recentOrders,
      ] = await Promise.all([
        supabase.from('orders').select('id, total_price, delivery_status').gte('created_at', todayStart.toISOString()),
        supabase.from('orders').select('id').eq('delivery_status', 'NEW').gte('created_at', todayStart.toISOString()),
        supabase.from('orders').select('id').in('delivery_status', ['NEW', 'ACCEPTED']).lt('created_at', new Date(Date.now() - 4 * 60 * 60_000).toISOString()),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'seller').eq('is_approved', false),
        supabase.from('rider_sos_events').select('id', { count: 'exact', head: true }).is('resolved_at', null),
        supabase.from('disputes').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
        supabase.from('orders').select('id, total_price, delivery_status, created_at, delivery_full_name').order('created_at', { ascending: false }).limit(10),
      ]);

      type TodayOrder = {
        id: string; total_price: number | string | null;
        delivery_status: string; created_at: string;
        delivery_full_name: string | null;
      };
      const todayOrders = (ordersToday.data ?? []) as TodayOrder[];
      const todayGmv = todayOrders
        .filter((o) => o.delivery_status !== 'CANCELED')
        .reduce((s, o) => s + Number(o.total_price ?? 0), 0);
      const todayDelivered = todayOrders.filter((o) => o.delivery_status === 'DELIVERED').length;

      return {
        ordersTodayCount: todayOrders.length,
        gmvToday: todayGmv,
        deliveredToday: todayDelivered,
        ordersPendingCount: ordersPending.data?.length ?? 0,
        ordersProblemCount: ordersProblem.data?.length ?? 0,
        sellersPendingCount: sellersPending.count ?? 0,
        sosActiveCount: sosActive.count ?? 0,
        disputesOpenCount: disputesOpen.count ?? 0,
        signupsTodayCount: signupsToday.count ?? 0,
        recentOrders: recentOrders.data ?? [],
      };
    },
  });

  if (!stats) {
    return <LoadingState />;
  }

  type KpiCardProps = {
    icon: LucideIcon;
    label: string;
    value: string | number;
    href?: string;
    color?: 'primary' | 'olive' | 'rose' | 'accent';
    alert?: boolean;
  };
  const KpiCard = ({ icon: Icon, label, value, href, color = 'primary', alert }: KpiCardProps) => {
    const colorMap: Record<string, string> = {
      primary: 'bg-primary-50 text-primary-700 border-primary-200',
      olive: 'bg-olive-50 text-olive-700 border-olive-200',
      accent: 'bg-accent-50 text-accent-700 border-accent-200',
      rose: 'bg-rose-50 text-rose-700 border-rose-200',
      amber: 'bg-accent-50 text-accent-700 border-accent-200',
    };
    const inner = (
      <div className={`border-2 rounded-xl p-4 ${alert ? colorMap.rose : 'bg-white border-cream-300'} transition-all hover:shadow-warm`}>
        <div className="flex items-start justify-between mb-2">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorMap[color]}`}>
            <Icon size={20} strokeWidth={2.2} />
          </div>
          {alert && Number(value) > 0 && <AlertCircle size={16} className="text-rose-600" />}
        </div>
        <p className="text-xs uppercase tracking-wider text-ink-500 font-semibold">{label}</p>
        <p className="text-2xl font-bold text-ink-900 mt-1">{value}</p>
      </div>
    );
    return href ? <Link href={href}>{inner}</Link> : inner;
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-ink-900">Today</h1>
        <p className="text-sm text-ink-500">
          {new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} ·
          Auto-refresh ogni 30s.
        </p>
      </header>

      {/* Alert rosso se ci sono problemi attivi */}
      {(stats.sosActiveCount > 0 || stats.ordersProblemCount > 0 || stats.disputesOpenCount > 0) && (
        <div className="bg-rose-50 border-2 border-rose-300 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle size={24} className="text-rose-600 flex-shrink-0 mt-0.5" strokeWidth={2.2} />
          <div className="flex-1">
            <p className="font-bold text-rose-900">Richiede attenzione immediata</p>
            <ul className="text-sm text-rose-800 mt-1 space-y-0.5">
              {stats.sosActiveCount > 0 && (
                <li>{stats.sosActiveCount} SOS rider attivo — <Link href="/admin/sos" className="underline font-semibold">apri</Link></li>
              )}
              {stats.ordersProblemCount > 0 && (
                <li>{stats.ordersProblemCount} ordini in problema (NEW/ACCEPTED da +4h) — <Link href="/admin/orders" className="underline font-semibold">verifica</Link></li>
              )}
              {stats.disputesOpenCount > 0 && (
                <li>{stats.disputesOpenCount} dispute aperte — <Link href="/admin/disputes" className="underline font-semibold">risolvi</Link></li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* KPI today */}
      <section>
        <h2 className="font-bold text-ink-900 mb-3 inline-flex items-center gap-2">
          <TrendingUp size={16} strokeWidth={2.4} className="text-primary-700" aria-hidden />
          Oggi
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={ShoppingBag} label="Ordini oggi" value={stats.ordersTodayCount} href="/admin/orders" color="primary" />
          <KpiCard icon={Euro} label="GMV oggi" value={formatPrice(stats.gmvToday)} color="olive" />
          <KpiCard icon={CheckCircle2} label="Consegnati" value={stats.deliveredToday} color="olive" />
          <KpiCard icon={UserCheck} label="Nuovi signup" value={stats.signupsTodayCount} href="/admin/users" color="accent" />
        </div>
      </section>

      {/* KPI in attesa */}
      <section>
        <h2 className="font-bold text-ink-900 mb-3 inline-flex items-center gap-2">
          <Clock size={16} strokeWidth={2.4} className="text-ink-500" aria-hidden />
          In attesa
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={Clock} label="Ordini NEW" value={stats.ordersPendingCount} href="/admin/orders" color="primary" />
          <KpiCard icon={UserCheck} label="Seller pending" value={stats.sellersPendingCount} href="/admin/users?role=seller" color="accent" />
          <KpiCard icon={AlertTriangle} label="Dispute aperte" value={stats.disputesOpenCount} href="/admin/disputes" color="rose" alert />
          <KpiCard icon={AlertCircle} label="SOS attivi" value={stats.sosActiveCount} href="/admin/sos" color="rose" alert />
        </div>
      </section>

      {/* Ultimi ordini */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-ink-900">Ultimi 10 ordini</h2>
          <Link href="/admin/orders" className="text-xs text-primary-700 hover:underline">vedi tutti →</Link>
        </div>
        <div className="bg-white border border-cream-300 rounded-xl overflow-hidden">
          {stats.recentOrders.length === 0 ? (
            <p className="text-sm text-ink-500 p-6 text-center">Nessun ordine ancora oggi.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-cream-50 text-ink-600 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2">Ordine</th>
                  <th className="text-left px-4 py-2">Cliente</th>
                  <th className="text-left px-4 py-2">Stato</th>
                  <th className="text-right px-4 py-2">Totale</th>
                  <th className="text-right px-4 py-2">Quando</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-100">
                {(stats.recentOrders as Array<{
                  id: string; total_price: number | string | null;
                  delivery_status: string; created_at: string;
                  delivery_full_name: string | null;
                }>).map((o) => (
                  <tr key={o.id} className="hover:bg-cream-50">
                    <td className="px-4 py-3">
                      <Link href={`/admin/orders/${o.id}`} className="font-mono text-xs text-primary-700 hover:underline">
                        #{o.id.slice(0, 6).toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink-700">{o.delivery_full_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-cream-100 text-ink-700">
                        {o.delivery_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{formatPrice(Number(o.total_price ?? 0))}</td>
                    <td className="px-4 py-3 text-right text-xs text-ink-500">
                      {new Date(o.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
