'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Package } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import EmptyState from '@/components/EmptyState';
import { formatPrice, formatDate } from '@/lib/format';
import {
  type OrderStatus,
} from '@/lib/order-status';
import { OrderStatusBadge } from '@/components/ui/OrderStatusBadge';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';

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

/**
 * Mostra feedback al rientro da Stripe Checkout (?stripe=success).
 * In Suspense perché useSearchParams lo richiede in Next 14.
 */
function StripeReturnHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    if (searchParams.get('stripe') === 'success') {
      toast.success('Pagamento completato! Il tuo ordine è confermato.');
      // Pulisce il param dall'URL senza ricaricare
      router.replace('/orders');
    }
  }, [searchParams, router]);
  return null;
}

export default function OrdersPage() {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: queryKeys.orders.all,
    queryFn: fetchOrders,
  });

  if (isLoading) {
    return <LoadingState />;
  }

  if (orders.length === 0) {
    return (
      <div className="container mx-auto py-12 max-w-2xl">
        <Suspense fallback={null}><StripeReturnHandler /></Suspense>
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
      <Suspense fallback={null}><StripeReturnHandler /></Suspense>
      <h1 className="text-2xl font-bold text-ink-900">I tuoi ordini</h1>

      {orders.map((order) => {
        const status = order.delivery_status;
        const itemCount = order.order_items.reduce((s, i) => s + i.quantity, 0);

        return (
          <Link
            key={order.id}
            href={`/orders/${order.id}`}
            className="block bg-white border border-cream-300 rounded-xl hover:shadow-md hover:border-primary-200 transition-all overflow-hidden"
          >
            <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-4 min-w-0 flex-1">
                <div className="w-12 h-12 rounded-full bg-cream-100 shrink-0 overflow-hidden flex items-center justify-center text-xl">
                  {order.seller?.store_logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={order.seller.store_logo} alt="" loading="lazy" className="w-full h-full object-cover" />
                  ) : '🏪'}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-ink-900 truncate">
                    {order.seller?.store_name ?? 'Negozio'}
                  </p>
                  <p className="text-xs text-ink-500">
                    {formatDate(order.created_at)} · {itemCount} {itemCount === 1 ? 'articolo' : 'articoli'} · #{order.id.slice(0, 6).toUpperCase()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <OrderStatusBadge status={status} size="sm" />
                <span className="font-bold text-ink-900">{formatPrice(order.total_price)}</span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
