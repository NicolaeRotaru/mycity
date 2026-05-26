'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';

type GroupOrder = {
  id: string;
  title: string | null;
  target_quantity: number;
  current_quantity: number;
  discount_percent: number;
  unit_price: number;
  discounted_price: number;
  deadline: string;
  status: string;
  product: { name: string; images: string[] | null } | null;
  seller: { store_name: string | null; store_logo: string | null } | null;
};

function timeLeft(deadline: string): string {
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return 'Scaduto';
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return `${Math.floor(ms / 60000)} min rimasti`;
  if (hours < 24) return `${hours}h rimaste`;
  return `${Math.floor(hours / 24)}g rimasti`;
}

export default function GroupsPage() {
  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['group-orders'],
    queryFn: async () => {
      const { data } = await supabase
        .from('group_orders')
        .select(`
          id, title, target_quantity, current_quantity, discount_percent,
          unit_price, discounted_price, deadline, status,
          product:products ( name, images ),
          seller:profiles!group_orders_seller_id_fkey ( store_name, store_logo )
        `)
        .eq('status', 'OPEN')
        .gt('deadline', new Date().toISOString())
        .order('deadline');
      return (data ?? []) as unknown as GroupOrder[];
    },
    refetchInterval: 30_000,
  });

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="bg-gradient-to-r from-accent-500 to-rose-500 text-white rounded-2xl p-6 mb-6">
        <h1 className="text-3xl font-extrabold">🤝 Gruppi d'acquisto</h1>
        <p className="text-accent-50 mt-2 max-w-2xl">
          Unisciti ai tuoi vicini: più persone si uniscono, più scendi di prezzo.
          Quando si raggiunge il target, l'offerta si attiva per tutti.
        </p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-ink-500">Caricamento…</div>
      ) : groups.length === 0 ? (
        <div className="bg-white border rounded-xl p-12 text-center">
          <p className="text-5xl mb-3">🤝</p>
          <p className="text-ink-700 font-semibold">Nessun gruppo attivo al momento</p>
          <p className="text-sm text-ink-500 mt-1">Torna presto, oppure proponi un acquisto di gruppo al tuo negozio preferito.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {groups.map((g) => {
            const progress = Math.min(100, (g.current_quantity / g.target_quantity) * 100);
            const img = g.product?.images?.[0];
            return (
              <Link
                key={g.id}
                href={`/groups/${g.id}`}
                className="block bg-white border-2 border-accent-200 rounded-xl overflow-hidden hover:shadow-lg transition-all"
              >
                <div className="flex">
                  <div className="w-28 h-28 bg-cream-100 shrink-0">
                    {img && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt="" loading="lazy" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="flex-1 p-3 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold text-ink-900 line-clamp-2 text-sm">{g.product?.name ?? 'Prodotto'}</h3>
                      <span className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded shrink-0">
                        -{g.discount_percent}%
                      </span>
                    </div>
                    <p className="text-xs text-ink-500">🏪 {g.seller?.store_name}</p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="font-extrabold text-lg text-rose-600">{formatPrice(g.discounted_price)}</span>
                      <span className="text-xs text-ink-400 line-through">{formatPrice(g.unit_price)}</span>
                    </div>
                  </div>
                </div>
                <div className="px-3 pb-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-semibold text-ink-700">
                      {g.current_quantity} / {g.target_quantity} partecipanti
                    </span>
                    <span className="text-accent-600 font-semibold">⏱ {timeLeft(g.deadline)}</span>
                  </div>
                  <div className="bg-cream-200 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-accent-400 to-rose-500 h-full transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
