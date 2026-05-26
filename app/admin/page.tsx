'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import { formatPrice } from '@/lib/format';
import { ORDER_STATUS_LABEL, ORDER_STATUS_ICON, type OrderStatus } from '@/lib/order-status';
import { LoadingState } from '@/components/ui/LoadingState';

const StatCard = ({ label, value, color, href, icon }: { label: string; value: string | number; color: string; href?: string; icon: string }) => {
  const inner = (
    <div className={`bg-white border-2 rounded-xl p-5 hover:shadow-md transition-all border-${color}-200`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xl">{icon}</span>
        <span className="text-xs uppercase tracking-wide text-ink-400 font-semibold">{label}</span>
      </div>
      <p className="text-3xl font-bold text-ink-900">{value}</p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
};

export default function AdminDashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin-stats'],
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

      const totalRevenue = orders
        .filter((o: any) => o.delivery_status === 'DELIVERED')
        .reduce((s: number, o: any) => s + Number(o.total_price), 0);

      const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
      const recent = orders.filter((o: any) => o.created_at >= sevenDaysAgo).length;

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
          available: products.filter((p: any) => p.status === 'available').length,
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
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Dashboard amministratore</h1>
        <p className="text-sm text-ink-500">Panoramica del marketplace in tempo reale.</p>
      </div>

      <section>
        <h2 className="font-bold text-ink-900 mb-3">👥 Utenti ({stats.users.total})</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Acquirenti" value={stats.users.buyers}  color="indigo" icon="🛒" href="/admin/users?role=buyer" />
          <StatCard label="Venditori"  value={stats.users.sellers} color="pink"   icon="🏪" href="/admin/users?role=seller" />
          <StatCard label="Rider"      value={stats.users.riders}  color="amber"  icon="🛵" href="/admin/users?role=rider" />
          <StatCard label="Admin"      value={stats.users.admins}  color="rose"   icon="🛡️" href="/admin/users?role=admin" />
        </div>
      </section>

      <section>
        <h2 className="font-bold text-ink-900 mb-3">📦 Ordini ({stats.orders.total})</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Totali"          value={stats.orders.total}                color="blue"    icon="📦" href="/admin/orders" />
          <StatCard label="Ultimi 7 giorni" value={stats.orders.recent}               color="violet"  icon="📈" href="/admin/orders" />
          <StatCard label="Consegnati"      value={stats.orders.byStatus.DELIVERED ?? 0} color="emerald" icon="✅" />
          <StatCard label="Ricavi totali"   value={formatPrice(stats.orders.revenue)} color="emerald" icon="💰" />
        </div>

        <div className="bg-white border rounded-xl p-5 mt-4">
          <h3 className="font-semibold text-ink-900 mb-3">Stato degli ordini</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            {(['NEW','ACCEPTED','READY','ASSIGNED','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED','CANCELED'] as OrderStatus[]).map((s) => {
              const Icon = ORDER_STATUS_ICON[s];
              return (
              <div key={s} className="flex items-center justify-between bg-cream-50 rounded px-3 py-2">
                <span className="text-ink-700 truncate inline-flex items-center gap-1.5">
                  <Icon size={14} strokeWidth={2.2} aria-hidden />
                  {ORDER_STATUS_LABEL[s]}
                </span>
                <span className="font-bold text-ink-900">{stats.orders.byStatus[s] ?? 0}</span>
              </div>
              );
            })}
          </div>
        </div>
      </section>

      <section>
        <h2 className="font-bold text-ink-900 mb-3">🛍️ Catalogo</h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Prodotti totali"    value={stats.products.total}     color="indigo"  icon="📦" href="/admin/products" />
          <StatCard label="Disponibili online" value={stats.products.available} color="emerald" icon="🟢" />
        </div>
      </section>
    </div>
  );
}
