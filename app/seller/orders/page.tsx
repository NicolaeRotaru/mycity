'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import { formatPrice, formatDate } from '@/lib/format';
import {
  type OrderStatus,
} from '@/lib/order-status';
import { OrderStatusBadge } from '@/components/ui/OrderStatusBadge';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';

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
    queryKey: queryKeys.seller.orders,
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

  if (isLoading) return <LoadingState />;

  const grouped = STATUS_FILTERS.slice(0, 3).map((f) => ({
    label: f.label,
    orders: orders.filter((o) => f.statuses?.includes(o.delivery_status)),
  }));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-ink-900">Ordini ricevuti</h1>
        <div className="flex gap-2 text-xs">
          {grouped.map((g) => (
            <span key={g.label} className="px-3 py-1 rounded-full bg-cream-100 text-ink-600">
              {g.label}: <strong className="text-ink-900">{g.orders.length}</strong>
            </span>
          ))}
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="bg-white border rounded-lg p-12 text-center text-ink-500">
          Non hai ancora ricevuto ordini.
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) =>
            group.orders.length === 0 ? null : (
              <section key={group.label}>
                <h2 className="font-semibold text-ink-700 mb-2">{group.label}</h2>
                <div className="space-y-2">
                  {group.orders.map((o) => {
                    const itemCount = o.order_items.reduce((s, i) => s + i.quantity, 0);
                    return (
                      <Link
                        key={o.id}
                        href={`/seller/orders/${o.id}`}
                        className="block bg-white border border-cream-300 rounded-xl px-5 py-4 hover:shadow-md hover:border-primary-200 transition-all"
                      >
                        <div className="flex items-center justify-between flex-wrap gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-mono text-xs text-ink-400">#{o.id.slice(0, 6).toUpperCase()}</p>
                              <span className="text-ink-300">·</span>
                              <p className="text-xs text-ink-500">{formatDate(o.created_at)}</p>
                            </div>
                            <p className="font-semibold text-ink-900 mt-0.5">{o.delivery_full_name ?? 'Cliente'}</p>
                            <p className="text-sm text-ink-500 truncate">
                              {itemCount} {itemCount === 1 ? 'articolo' : 'articoli'} · {o.delivery_address}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <OrderStatusBadge status={o.delivery_status} size="sm" />
                            <span className="font-bold text-ink-900">{formatPrice(o.total_price)}</span>
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
