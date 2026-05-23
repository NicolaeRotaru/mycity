'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import { formatPrice, formatDate } from '@/lib/format';
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_EMOJI,
  ORDER_STATUS_COLOR,
  type OrderStatus,
} from '@/lib/order-status';

type Order = {
  id: string;
  total_price: number;
  delivery_status: OrderStatus;
  created_at: string;
  delivery_full_name: string | null;
  delivery_address: string | null;
  order_items: { id: string; quantity: number }[];
};

const STATUS_FILTERS: { label: string; statuses: OrderStatus[] | null }[] = [
  { label: 'Da fare',     statuses: ['NEW', 'ACCEPTED', 'READY'] },
  { label: 'In consegna', statuses: ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'] },
  { label: 'Completati',  statuses: ['DELIVERED'] },
  { label: 'Tutti',       statuses: null },
];

export default function SellerOrdersPage() {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['seller-orders'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, total_price, delivery_status, created_at,
          delivery_full_name, delivery_address,
          order_items ( id, quantity )
        `)
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Order[];
    },
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="text-center py-8 text-gray-500">Caricamento...</div>;

  const grouped = STATUS_FILTERS.slice(0, 3).map((f) => ({
    label: f.label,
    orders: orders.filter((o) => f.statuses?.includes(o.delivery_status)),
  }));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-gray-900">Ordini ricevuti</h1>
        <div className="flex gap-2 text-xs">
          {grouped.map((g) => (
            <span key={g.label} className="px-3 py-1 rounded-full bg-gray-100 text-gray-600">
              {g.label}: <strong className="text-gray-900">{g.orders.length}</strong>
            </span>
          ))}
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="bg-white border rounded-lg p-12 text-center text-gray-500">
          Non hai ancora ricevuto ordini.
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) =>
            group.orders.length === 0 ? null : (
              <section key={group.label}>
                <h2 className="font-semibold text-gray-700 mb-2">{group.label}</h2>
                <div className="space-y-2">
                  {group.orders.map((o) => {
                    const c = ORDER_STATUS_COLOR[o.delivery_status];
                    const itemCount = o.order_items.reduce((s, i) => s + i.quantity, 0);
                    return (
                      <Link
                        key={o.id}
                        href={`/seller/orders/${o.id}`}
                        className="block bg-white border border-gray-200 rounded-xl px-5 py-4 hover:shadow-md hover:border-indigo-200 transition-all"
                      >
                        <div className="flex items-center justify-between flex-wrap gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-mono text-xs text-gray-400">#{o.id.slice(0, 6).toUpperCase()}</p>
                              <span className="text-gray-300">·</span>
                              <p className="text-xs text-gray-500">{formatDate(o.created_at)}</p>
                            </div>
                            <p className="font-semibold text-gray-900 mt-0.5">{o.delivery_full_name ?? 'Cliente'}</p>
                            <p className="text-sm text-gray-500 truncate">
                              {itemCount} {itemCount === 1 ? 'articolo' : 'articoli'} · {o.delivery_address}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ${c.bg} ${c.text} ${c.ring}`}>
                              <span>{ORDER_STATUS_EMOJI[o.delivery_status]}</span>
                              {ORDER_STATUS_LABEL[o.delivery_status]}
                            </span>
                            <span className="font-bold text-gray-900">{formatPrice(o.total_price)}</span>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ),
          )}
        </div>
      )}
    </div>
  );
}
