'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  ShoppingBag, TrendingUp, AlertTriangle, UserCheck, Euro,
  Clock, AlertCircle, CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { ORDER_STATUS_LABEL, type OrderStatus } from '@/lib/order-status';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';
import { AdminPageTitle, AdminSectionLabel } from '@/components/admin/AdminUI';

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
    color?: 'primary' | 'olive' | 'accent' | 'secondary';
    alert?: boolean;
  };
  const KpiCard = ({ icon: Icon, label, value, href, color = 'primary', alert }: KpiCardProps) => {
    const medallion: Record<string, string> = {
      primary: 'bg-primary-100 text-primary-700',
      olive: 'bg-olive-100 text-olive-700',
      accent: 'bg-accent-100 text-accent-700',
      secondary: 'bg-secondary-100 text-secondary-600',
    };
    const on = !!alert && Number(value) > 0;
    const inner = (
      <div className={`rounded-xl border-2 p-4 transition-all hover:shadow-warm ${on ? 'bg-secondary-50 border-secondary-200' : 'bg-white border-cream-300'}`}>
        <div className="mb-2.5 flex items-start justify-between">
          <span className={`inline-flex h-10 w-10 items-center justify-center rounded-md ${medallion[color]}`}>
            <Icon size={20} strokeWidth={2.2} aria-hidden />
          </span>
          {on && <AlertCircle size={16} className="text-secondary-600" aria-hidden />}
        </div>
        <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-ink-500">{label}</p>
        <p className="mt-1 text-[26px] font-extrabold leading-none text-ink-900">{value}</p>
      </div>
    );
    return href ? <Link href={href} className="block">{inner}</Link> : inner;
  };

  return (
    <div className="space-y-8">
      <AdminPageTitle
        eyebrow="Cockpit"
        title="Today"
        sub={`${new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · aggiornamento automatico ogni 30s`}
      />

      {/* Alert se ci sono problemi attivi */}
      {(stats.sosActiveCount > 0 || stats.ordersProblemCount > 0 || stats.disputesOpenCount > 0) && (
        <div className="flex items-start gap-3 rounded-xl border-2 border-secondary-200 bg-secondary-50 p-4">
          <AlertTriangle size={24} className="mt-0.5 flex-shrink-0 text-secondary-600" strokeWidth={2.2} />
          <div className="flex-1">
            <p className="font-bold text-secondary-700">Richiede attenzione immediata</p>
            <ul className="mt-1 space-y-0.5 text-sm text-secondary-800">
              {stats.sosActiveCount > 0 && (
                <li>{stats.sosActiveCount} SOS rider attivo — <Link href="/admin/sos" className="font-semibold underline">apri</Link></li>
              )}
              {stats.ordersProblemCount > 0 && (
                <li>{stats.ordersProblemCount} ordini in problema (NEW/ACCEPTED da +4h) — <Link href="/admin/orders" className="font-semibold underline">verifica</Link></li>
              )}
              {stats.disputesOpenCount > 0 && (
                <li>{stats.disputesOpenCount} dispute aperte — <Link href="/admin/disputes" className="font-semibold underline">risolvi</Link></li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* KPI today */}
      <section>
        <AdminSectionLabel icon={TrendingUp}>Oggi</AdminSectionLabel>
        <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
          <KpiCard icon={ShoppingBag} label="Ordini oggi" value={stats.ordersTodayCount} href="/admin/orders" color="primary" />
          <KpiCard icon={Euro} label="GMV oggi" value={formatPrice(stats.gmvToday)} color="olive" />
          <KpiCard icon={CheckCircle2} label="Consegnati" value={stats.deliveredToday} color="olive" />
          <KpiCard icon={UserCheck} label="Nuovi signup" value={stats.signupsTodayCount} href="/admin/users" color="accent" />
        </div>
      </section>

      {/* KPI in attesa */}
      <section>
        <AdminSectionLabel icon={Clock}>In attesa</AdminSectionLabel>
        <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
          <KpiCard icon={Clock} label="Ordini NEW" value={stats.ordersPendingCount} href="/admin/orders" color="primary" />
          <KpiCard icon={UserCheck} label="Seller pending" value={stats.sellersPendingCount} href="/admin/users?role=seller" color="accent" />
          <KpiCard icon={AlertTriangle} label="Dispute aperte" value={stats.disputesOpenCount} href="/admin/disputes" color="secondary" alert />
          <KpiCard icon={AlertCircle} label="SOS attivi" value={stats.sosActiveCount} href="/admin/sos" color="secondary" alert />
        </div>
      </section>

      {/* Ultimi ordini */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-ink-900">Ultimi 10 ordini</h2>
          <Link href="/admin/orders" className="text-xs text-primary-700 hover:underline">vedi tutti →</Link>
        </div>
        <div className="overflow-hidden rounded-xl border-2 border-cream-300 bg-white">
          {stats.recentOrders.length === 0 ? (
            <p className="p-6 text-center text-sm text-ink-500">Nessun ordine ancora oggi.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-cream-50 text-xs uppercase tracking-wider text-ink-600">
                <tr>
                  <th className="px-4 py-2.5 text-left">Ordine</th>
                  <th className="px-4 py-2.5 text-left">Cliente</th>
                  <th className="px-4 py-2.5 text-left">Stato</th>
                  <th className="px-4 py-2.5 text-right">Totale</th>
                  <th className="px-4 py-2.5 text-right">Quando</th>
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
                      <span className="inline-block rounded-full bg-cream-100 px-2 py-0.5 text-xs font-semibold text-ink-700">
                        {ORDER_STATUS_LABEL[o.delivery_status as OrderStatus] ?? o.delivery_status}
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
