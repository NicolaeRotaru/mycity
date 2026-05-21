'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { useProfile } from '@/components/hooks/useProfile';

export default function SellerDashboard() {
  const { profile, isPendingSeller, isSeller } = useProfile();

  const { data: stats, isLoading } = useQuery({
    queryKey: ['seller-stats'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');

      const [{ count: productCount }, { count: availableCount }, { data: items }] = await Promise.all([
        supabase.from('products').select('id', { count: 'exact', head: true }).eq('seller_id', user.id),
        supabase.from('products').select('id', { count: 'exact', head: true })
          .eq('seller_id', user.id).eq('status', 'available'),
        supabase.from('order_items')
          .select('quantity, unit_price, orders(created_at), products!inner(seller_id)')
          .eq('products.seller_id', user.id),
      ]);

      const itemsArr = items ?? [];
      const revenue = itemsArr.reduce((s: number, it: any) => s + Number(it.unit_price) * it.quantity, 0);
      const last30 = itemsArr.filter((it: any) => {
        const d = new Date(it.orders?.created_at ?? 0).getTime();
        return Date.now() - d < 30 * 86400000;
      });
      const revenue30 = last30.reduce((s: number, it: any) => s + Number(it.unit_price) * it.quantity, 0);

      return {
        productCount: productCount ?? 0,
        availableCount: availableCount ?? 0,
        orderCount: itemsArr.length,
        revenue,
        revenue30,
        last30Count: last30.length,
      };
    },
    enabled: isSeller || isPendingSeller,
  });

  // Stato pending: mostra solo guida
  if (isPendingSeller) {
    return (
      <div className="max-w-2xl space-y-6">
        <div className="bg-gradient-to-r from-yellow-100 to-amber-100 border-2 border-yellow-400 rounded-xl p-6 space-y-3">
          <div className="text-4xl">⏳</div>
          <h1 className="text-2xl font-bold">Il tuo negozio è in attesa di approvazione</h1>
          <p className="text-gray-700">
            Grazie per esserti registrato come venditore! Stiamo verificando i tuoi dati. Riceverai una notifica appena il negozio sarà attivo (di solito entro 24 ore).
          </p>
          <Link
            href="/seller/profile"
            className="inline-block bg-yellow-500 hover:bg-yellow-600 text-white px-5 py-2.5 rounded-lg font-bold"
          >
            Completa i dati del negozio →
          </Link>
        </div>

        <div className="bg-white border rounded-xl p-6 space-y-4">
          <h2 className="font-bold text-lg">Cosa puoi fare nel frattempo</h2>
          <div className="space-y-3 text-sm">
            <div className="flex gap-3">
              <span className="text-2xl">1️⃣</span>
              <div>
                <p className="font-semibold">Completa i dati del negozio</p>
                <p className="text-gray-500">Nome, indirizzo, telefono — più informazioni dai, più velocemente verrai approvato.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="text-2xl">2️⃣</span>
              <div>
                <p className="font-semibold">Prepara il catalogo</p>
                <p className="text-gray-500">Pensa ai primi 5-10 prodotti da pubblicare. Foto belle = più vendite.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="text-2xl">3️⃣</span>
              <div>
                <p className="font-semibold">Esplora il marketplace</p>
                <p className="text-gray-500">Guarda come si presentano gli altri negozi su <Link href="/stores" className="text-indigo-600 hover:underline">/stores</Link>.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading || !stats) return <div className="text-center py-8 text-gray-400">Caricamento...</div>;

  return (
    <div className="space-y-6">
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

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Fatturato totale"
          value={formatPrice(stats.revenue)}
          icon="💰"
          accent="emerald"
          hint={stats.revenue30 > 0 ? `+${formatPrice(stats.revenue30)} ultimi 30 giorni` : 'Nessuna vendita ancora'}
        />
        <KpiCard
          label="Articoli venduti"
          value={stats.orderCount}
          icon="📦"
          accent="indigo"
          hint={stats.last30Count > 0 ? `${stats.last30Count} negli ultimi 30 giorni` : '—'}
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
          value="—"
          icon="⭐"
          accent="amber"
          hint="In arrivo"
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
