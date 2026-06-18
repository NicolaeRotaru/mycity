'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import {
  Users, ShoppingCart, Store, Bike, Shield, Package, TrendingUp,
  CheckCircle2, Banknote, ShoppingBag, LayoutGrid,
} from 'lucide-react';
import { formatPrice } from '@/lib/format';
import { ORDER_STATUS_LABEL, ORDER_STATUS_ICON, type OrderStatus } from '@/lib/order-status';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';
import { getAccountMenuItems } from '@/lib/account-menu';
import { AdminPageTitle, AdminSectionLabel, AdminStatCard } from '@/components/admin/AdminUI';

export default function AdminDashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: queryKeys.admin.stats,
    queryFn: async () => {
      const [profilesRes, ordersRes, productsRes] = await Promise.all([
        supabase.from('profiles').select('role'),
        supabase.from('orders').select('total_price, delivery_status, created_at'),
        supabase.from('products').select('status'),
      ]);

      const profiles = profilesRes.data ?? [];
      const orders = ordersRes.data ?? [];
      const products = productsRes.data ?? [];

      const byRole: Record<string, number> = {};
      for (const p of profiles) byRole[p.role] = (byRole[p.role] ?? 0) + 1;

      const byStatus: Record<string, number> = {};
      for (const o of orders) byStatus[o.delivery_status] = (byStatus[o.delivery_status] ?? 0) + 1;

      type Order = { delivery_status: string; total_price: string | number; created_at: string };
      type Product = { status: string };

      const totalRevenue = (orders as Order[])
        .filter((o) => o.delivery_status === 'DELIVERED')
        .reduce((s, o) => s + Number(o.total_price), 0);

      const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
      const recent = (orders as Order[]).filter((o) => o.created_at >= sevenDaysAgo).length;

      return {
        users: {
          total: profiles.length,
          buyers: byRole.buyer ?? 0,
          sellers: byRole.seller ?? 0,
          riders: byRole.rider ?? 0,
          admins: byRole.admin ?? 0,
        },
        orders: {
          total: orders.length,
          recent,
          byStatus,
          revenue: totalRevenue,
        },
        products: {
          total: products.length,
          available: (products as Product[]).filter((p) => p.status === 'available').length,
        },
      };
    },
    refetchInterval: 30_000,
  });

  if (isLoading || !stats) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-8">
      <AdminPageTitle
        eyebrow="Marketplace"
        title="Panoramica"
        sub="Tutti i numeri del marketplace, in tempo reale."
      />

      {/* Scorciatoie: solo mobile (su desktop la navigazione è nella sidebar cockpit). */}
      <section className="md:hidden">
        <AdminSectionLabel icon={LayoutGrid}>Sezioni</AdminSectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {getAccountMenuItems('admin')
            .filter((it) => it.href.startsWith('/admin') && it.href !== '/admin')
            .map((it) => {
              const Icon = it.icon;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className="flex items-center gap-2 bg-white border border-cream-300 rounded-lg px-3 py-2.5 text-sm font-semibold text-ink-700 hover:border-primary-300 hover:bg-cream-50 transition-colors"
                >
                  <Icon size={16} strokeWidth={2.2} className="text-primary-700 shrink-0" aria-hidden />
                  <span className="truncate">{it.label}</span>
                </Link>
              );
            })}
        </div>
      </section>

      <section>
        <AdminSectionLabel icon={Users}>Utenti · {stats.users.total}</AdminSectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          <AdminStatCard tone="primary"   icon={ShoppingCart} label="Acquirenti" value={stats.users.buyers}  href="/admin/users?role=buyer" />
          <AdminStatCard tone="accent"    icon={Store}        label="Venditori"  value={stats.users.sellers} href="/admin/users?role=seller" />
          <AdminStatCard tone="olive"     icon={Bike}         label="Rider"      value={stats.users.riders}  href="/admin/users?role=rider" />
          <AdminStatCard tone="secondary" icon={Shield}       label="Admin"      value={stats.users.admins}  href="/admin/users?role=admin" />
        </div>
      </section>

      <section>
        <AdminSectionLabel icon={Package}>Ordini · {stats.orders.total}</AdminSectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          <AdminStatCard tone="primary" icon={Package}      label="Totali"          value={stats.orders.total} href="/admin/orders" />
          <AdminStatCard tone="accent"  icon={TrendingUp}   label="Ultimi 7 giorni" value={stats.orders.recent} href="/admin/orders" />
          <AdminStatCard tone="olive"   icon={CheckCircle2} label="Consegnati"      value={stats.orders.byStatus.DELIVERED ?? 0} />
          <AdminStatCard tone="olive"   icon={Banknote}     label="Ricavi totali"   value={formatPrice(stats.orders.revenue)} />
        </div>

        <div className="bg-white border-2 border-cream-300 rounded-xl p-5 mt-4">
          <h3 className="font-serif text-[17px] font-bold text-ink-900 mb-3.5">Stato degli ordini</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            {(['NEW','ACCEPTED','READY','ASSIGNED','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED','CANCELED'] as OrderStatus[]).map((s) => {
              const Icon = ORDER_STATUS_ICON[s];
              return (
              <div key={s} className="flex items-center justify-between bg-cream-50 rounded-md px-3 py-2">
                <span className="text-ink-600 truncate inline-flex items-center gap-1.5">
                  <Icon size={14} strokeWidth={2.2} aria-hidden />
                  {ORDER_STATUS_LABEL[s]}
                </span>
                <span className="font-extrabold text-ink-900">{stats.orders.byStatus[s] ?? 0}</span>
              </div>
              );
            })}
          </div>
        </div>
      </section>

      <section>
        <AdminSectionLabel icon={ShoppingBag}>Catalogo</AdminSectionLabel>
        <div className="grid grid-cols-2 gap-3.5">
          <AdminStatCard tone="primary" icon={Package}      label="Prodotti totali"    value={stats.products.total} href="/admin/products" />
          <AdminStatCard tone="olive"   icon={CheckCircle2} label="Disponibili online" value={stats.products.available} />
        </div>
      </section>
    </div>
  );
}
