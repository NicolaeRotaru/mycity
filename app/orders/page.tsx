'use client';

import { useQuery } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import EmptyState from '@/components/EmptyState';
import { formatPrice, formatDate } from '@/lib/format';
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_EMOJI,
  ORDER_STATUS_COLOR,
  type OrderStatus,
} from '@/lib/order-status';

type OrderItem = {
  id: string;
  quantity: number;
  unit_price: number;
  products: { name: string } | null;
};

type Order = {
  id: string;
  total_price: number;
  payment_status: 'PAID' | 'FAILED' | 'PENDING';
  delivery_status: OrderStatus;
  created_at: string;
  seller_id: string | null;
  seller: { store_name: string | null; store_logo: string | null } | null;
  order_items: OrderItem[];
};

const fetchOrders = async (): Promise<Order[]> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Non autenticato');

  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, total_price, payment_status, delivery_status, created_at, seller_id,
      seller:profiles!orders_seller_id_fkey ( store_name, store_logo ),
      order_items (
        id, quantity, unit_price,
        products ( name )
      )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as Order[];
};

export default function OrdersPage() {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: fetchOrders,
  });

  if (isLoading) {
    return <div className="container mx-auto p-8 text-center text-gray-500">Caricamento ordini...</div>;
  }

  if (orders.length === 0) {
    return (
      <div className="container mx-auto py-12 max-w-2xl">
        <EmptyState
          icon={Package}
          title="Non hai ancora ordini"
          description="Quando ordini qualcosa, lo vedrai qui con il tracking in tempo reale."
          ctaLabel="Inizia ad esplorare"
          ctaHref="/search"
          secondaryLabel="€5 di benvenuto"
          secondaryHref="/profile/loyalty"
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-8 max-w-4xl space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">I tuoi ordini</h1>

      {orders.map((order) => {
        const status = order.delivery_status;
        const c = ORDER_STATUS_COLOR[status];
        const itemCount = order.order_items.reduce((s, i) => s + i.quantity, 0);

        return (
          <Link
            key={order.id}
            href={`/orders/${order.id}`}
            className="block bg-white border border-gray-200 rounded-xl hover:shadow-md hover:border-indigo-200 transition-all overflow-hidden"
          >
            <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-4 min-w-0 flex-1">
                <div className="w-12 h-12 rounded-full bg-gray-100 shrink-0 overflow-hidden flex items-center justify-center text-xl">
                  {order.seller?.store_logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={order.seller.store_logo} alt="" className="w-full h-full object-cover" />
                  ) : '🏪'}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">
                    {order.seller?.store_name ?? 'Negozio'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatDate(order.created_at)} · {itemCount} {itemCount === 1 ? 'articolo' : 'articoli'} · #{order.id.slice(0, 6).toUpperCase()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ${c.bg} ${c.text} ${c.ring}`}>
                  <span>{ORDER_STATUS_EMOJI[status]}</span>
                  {ORDER_STATUS_LABEL[status]}
                </span>
                <span className="font-bold text-gray-900">{formatPrice(order.total_price)}</span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
