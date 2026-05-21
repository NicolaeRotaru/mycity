'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';

export default function SellerDashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['seller-stats'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');

      const [{ count: productCount }, { count: availableCount }, { data: items }] = await Promise.all([
        supabase.from('products').select('id', { count: 'exact', head: true }).eq('seller_id', user.id),
        supabase
          .from('products')
          .select('id', { count: 'exact', head: true })
          .eq('seller_id', user.id)
          .eq('status', 'available'),
        supabase
          .from('order_items')
          .select('quantity, unit_price, products!inner(seller_id)')
          .eq('products.seller_id', user.id),
      ]);

      const revenue = (items ?? []).reduce(
        (s: number, it: any) => s + Number(it.unit_price) * it.quantity,
        0
      );
      const orderCount = items?.length ?? 0;

      return {
        productCount: productCount ?? 0,
        availableCount: availableCount ?? 0,
        orderCount,
        revenue,
      };
    },
  });

  if (isLoading || !stats) return <div className="text-center py-8">Caricamento...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Prodotti totali"   value={stats.productCount}    icon="📦" />
        <KpiCard label="In vendita"        value={stats.availableCount}  icon="✅" />
        <KpiCard label="Articoli venduti"  value={stats.orderCount}      icon="🛒" />
        <KpiCard label="Fatturato"         value={formatPrice(stats.revenue)} icon="💰" />
      </div>

      <div className="bg-white border rounded-lg p-6">
        <h2 className="font-bold mb-3">Azioni rapide</h2>
        <div className="flex flex-wrap gap-3">
          <Link href="/seller/products/new" className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded">
            ➕ Aggiungi prodotto
          </Link>
          <Link href="/seller/orders" className="bg-white border hover:bg-gray-50 px-4 py-2 rounded">
            📦 Gestisci ordini
          </Link>
          <Link href="/seller/profile" className="bg-white border hover:bg-gray-50 px-4 py-2 rounded">
            🏪 Modifica negozio
          </Link>
        </div>
      </div>
    </div>
  );
}

const KpiCard = ({ label, value, icon }: { label: string; value: string | number; icon: string }) => (
  <div className="bg-white border rounded-lg p-5">
    <div className="text-3xl mb-2">{icon}</div>
    <div className="text-2xl font-bold text-gray-800">{value}</div>
    <div className="text-sm text-gray-500">{label}</div>
  </div>
);
