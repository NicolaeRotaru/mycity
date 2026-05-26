'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { useProfile } from '@/components/hooks/useProfile';
import SellerHealthScore from '@/components/seller/SellerHealthScore';
import SellerOnboardingChecklist from '@/components/seller/SellerOnboardingChecklist';

export default function SellerDashboard() {
  const { profile, isSeller } = useProfile();

  const { data: stats, isLoading } = useQuery({
    queryKey: ['seller-stats'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');

      const [{ count: productCount }, { count: availableCount }, { data: items }, { data: storeReviews }] = await Promise.all([
        supabase.from('products').select('id', { count: 'exact', head: true }).eq('seller_id', user.id),
        supabase.from('products').select('id', { count: 'exact', head: true })
          .eq('seller_id', user.id).eq('status', 'available'),
        supabase.from('order_items')
          .select('quantity, unit_price, orders(created_at), products!inner(seller_id)')
          .eq('products.seller_id', user.id),
        supabase.from('store_reviews').select('rating').eq('store_id', user.id),
      ]);

      const itemsArr = items ?? [];
      const revenue = itemsArr.reduce((s: number, it: any) => s + Number(it.unit_price) * it.quantity, 0);

      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      const startOf7d = new Date(Date.now() - 7 * 86400000);
      const startOf30d = new Date(Date.now() - 30 * 86400000);

      const inRange = (it: any, from: Date) => new Date(it.orders?.created_at ?? 0) >= from;
      const sum = (arr: any[]) => arr.reduce((s, it) => s + Number(it.unit_price) * it.quantity, 0);

      const today = itemsArr.filter((it: any) => inRange(it, startOfToday));
      const last7 = itemsArr.filter((it: any) => inRange(it, startOf7d));
      const last30 = itemsArr.filter((it: any) => inRange(it, startOf30d));

      const reviews = storeReviews ?? [];
      const avgRating = reviews.length > 0
        ? reviews.reduce((s, r: any) => s + r.rating, 0) / reviews.length
        : 0;

      return {
        productCount: productCount ?? 0,
        availableCount: availableCount ?? 0,
        orderCount: itemsArr.length,
        revenue,
        revenueToday: sum(today),
        revenue7: sum(last7),
        revenue30: sum(last30),
        ordersToday: today.length,
        orders7: last7.length,
        last30Count: last30.length,
        avgRating,
        reviewCount: reviews.length,
      };
    },
    enabled: isSeller,
  });

  if (isLoading || !stats) return <div className="text-center py-8 text-gray-400">Caricamento...</div>;

  return (
    <div className="space-y-6">
      <SellerOnboardingChecklist />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">Ciao, {profile?.store_name ?? 'venditore'} 👋</h1>
          <p className="text-gray-500 text-sm">Ecco il riepilogo del tuo negozio</p>
        </div>
        <Link
          href="/seller/products/new"
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-bold shadow-md"
        >
          ➕ Pubblica un prodotto
        </Link>
      </div>

      {/* Health Score */}
      <SellerHealthScore />

      {/* CASSA — incassi per periodo */}
      <div className="bg-white border-2 border-emerald-200 rounded-xl p-5">
        <h2 className="font-bold text-gray-900 mb-3 flex items-center gap-2">💰 Cassa</h2>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-emerald-50 rounded-lg p-3">
            <p className="text-xs uppercase tracking-wide text-emerald-700 font-semibold">Oggi</p>
            <p className="text-xl sm:text-2xl font-bold text-emerald-900 mt-1">{formatPrice(stats.revenueToday)}</p>
            <p className="text-xs text-emerald-600">{stats.ordersToday} articoli</p>
          </div>
          <div className="bg-indigo-50 rounded-lg p-3">
            <p className="text-xs uppercase tracking-wide text-indigo-700 font-semibold">7 giorni</p>
            <p className="text-xl sm:text-2xl font-bold text-indigo-900 mt-1">{formatPrice(stats.revenue7)}</p>
            <p className="text-xs text-indigo-600">{stats.orders7} articoli</p>
          </div>
          <div className="bg-purple-50 rounded-lg p-3">
            <p className="text-xs uppercase tracking-wide text-purple-700 font-semibold">30 giorni</p>
            <p className="text-xl sm:text-2xl font-bold text-purple-900 mt-1">{formatPrice(stats.revenue30)}</p>
            <p className="text-xs text-purple-600">{stats.last30Count} articoli</p>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Fatturato totale"
          value={formatPrice(stats.revenue)}
          icon="💰"
          accent="emerald"
          hint={`${stats.orderCount} articoli venduti`}
        />
        <KpiCard
          label="Prodotti in vendita"
          value={stats.availableCount}
          icon="🛍️"
          accent="purple"
          hint={`Su ${stats.productCount} totali`}
        />
        <KpiCard
          label="Valutazione media"
          value={stats.avgRating > 0 ? stats.avgRating.toFixed(1) + ' ★' : '—'}
          icon="⭐"
          accent="amber"
          hint={stats.reviewCount > 0 ? `${stats.reviewCount} recensioni` : 'Nessuna recensione'}
        />
        <KpiCard
          label="Articoli totali"
          value={stats.orderCount}
          icon="📦"
          accent="indigo"
          hint="Dall'inizio"
        />
      </div>

      {/* Suggerimenti */}
      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-6">
        <h2 className="font-bold text-lg mb-3 flex items-center gap-2">💡 Suggerimenti per vendere di più</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          {stats.availableCount < 5 && (
            <div className="bg-white rounded-lg p-4 border border-indigo-100">
              <p className="font-bold text-indigo-700 mb-1">📷 Aggiungi più prodotti</p>
              <p className="text-gray-600">I negozi con +10 prodotti vendono il 70% in più.</p>
              <Link href="/seller/products/new" className="text-indigo-600 hover:underline text-xs font-semibold mt-2 inline-block">
                Aggiungi ora →
              </Link>
            </div>
          )}
          <div className="bg-white rounded-lg p-4 border border-indigo-100">
            <p className="font-bold text-indigo-700 mb-1">📸 Foto di qualità</p>
            <p className="text-gray-600">Prodotti con almeno 3 foto vendono 2× di più.</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-indigo-100">
            <p className="font-bold text-indigo-700 mb-1">✍️ Descrizioni complete</p>
            <p className="text-gray-600">Includi peso, materiali, provenienza.</p>
          </div>
        </div>
      </div>

      {/* Azioni rapide */}
      <div className="bg-white border rounded-xl p-6">
        <h2 className="font-bold mb-4">Azioni rapide</h2>
        <div className="flex flex-wrap gap-3">
          <Link href="/seller/products/new" className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-lg font-semibold">
            ➕ Aggiungi prodotto
          </Link>
          <Link href="/seller/orders" className="bg-white border-2 hover:border-indigo-400 px-4 py-2.5 rounded-lg font-semibold">
            📦 Gestisci ordini
          </Link>
          <Link href="/seller/products" className="bg-white border-2 hover:border-indigo-400 px-4 py-2.5 rounded-lg font-semibold">
            🗂️ I miei prodotti
          </Link>
          <Link href="/seller/profile" className="bg-white border-2 hover:border-indigo-400 px-4 py-2.5 rounded-lg font-semibold">
            🏪 Modifica negozio
          </Link>
          {profile && (
            <Link href={`/store/${profile.id}`} className="bg-white border-2 hover:border-indigo-400 px-4 py-2.5 rounded-lg font-semibold">
              👁️ Vedi negozio pubblico
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

const accentClasses: Record<string, string> = {
  emerald: 'from-emerald-500 to-teal-500',
  indigo:  'from-indigo-500 to-purple-500',
  purple:  'from-purple-500 to-pink-500',
  amber:   'from-amber-400 to-orange-500',
};

const KpiCard = ({
  label, value, icon, accent, hint,
}: { label: string; value: string | number; icon: string; accent: string; hint?: string }) => (
  <div className="bg-white border rounded-xl p-5 relative overflow-hidden">
    <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-br ${accentClasses[accent]} opacity-10 rounded-full -mr-8 -mt-8`} />
    <div className="text-3xl mb-2 relative">{icon}</div>
    <div className="text-2xl font-extrabold text-gray-800 relative">{value}</div>
    <div className="text-xs text-gray-500 mt-1 relative">{label}</div>
    {hint && <div className="text-[10px] text-gray-400 mt-2 relative">{hint}</div>}
  </div>
);
