'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';

type OrderItem = {
  id: string;
  quantity: number;
  unit_price: number;
  product_id: string;
  products: { name: string }[] | null;  // Supabase restituisce sempre array nelle join
};

type Order = {
  id: string;
  total_price: number;
  payment_status: 'PAID' | 'FAILED' | 'PENDING';
  delivery_status: 'PREPARATION' | 'SHIPPED' | 'DELIVERED';
  created_at: string;
  order_items: OrderItem[];
};

const fetchOrders = async (): Promise<Order[]> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Non autenticato');

  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, total_price, payment_status, delivery_status, created_at,
      order_items (
        id, quantity, unit_price, product_id,
        products ( name )
      )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as Order[];
};

const paymentBadge: Record<Order['payment_status'], { label: string; classes: string }> = {
  PAID:    { label: 'Pagato',    classes: 'bg-green-100 text-green-700' },
  PENDING: { label: 'In attesa', classes: 'bg-yellow-100 text-yellow-700' },
  FAILED:  { label: 'Fallito',   classes: 'bg-red-100 text-red-700' },
};

const deliveryBadge: Record<Order['delivery_status'], { label: string; classes: string }> = {
  PREPARATION: { label: '📦 Preparazione', classes: 'bg-blue-100 text-blue-700' },
  SHIPPED:     { label: '🚚 Spedito',      classes: 'bg-indigo-100 text-indigo-700' },
  DELIVERED:   { label: '✅ Consegnato',   classes: 'bg-green-100 text-green-700' },
};

export default function OrdersPage() {
  const { data: orders = [], isLoading, error } = useQuery({
    queryKey: ['orders'],
    queryFn: fetchOrders,
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-8 text-center text-gray-500">
        Caricamento ordini...
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-8 text-center text-red-500">
        Errore nel caricamento degli ordini.
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="container mx-auto p-8 text-center space-y-4">
        <p className="text-gray-500 text-lg">Non hai ancora nessun ordine.</p>
        <Link
          href="/"
          className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg transition-colors"
        >
          Scopri i prodotti
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-8 max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">I tuoi ordini</h1>

      {orders.map((order) => {
        const payment = paymentBadge[order.payment_status];
        const delivery = deliveryBadge[order.delivery_status];
        const date = new Date(order.created_at).toLocaleDateString('it-IT', {
          day: '2-digit', month: 'long', year: 'numeric',
        });

        return (
          <div key={order.id} className="bg-white border rounded-xl shadow-sm overflow-hidden">
            {/* Header ordine */}
            <div className="bg-gray-50 border-b px-5 py-3 flex flex-wrap justify-between items-center gap-2">
              <div>
                <p className="text-xs text-gray-400 font-mono">#{order.id.slice(0, 8).toUpperCase()}</p>
                <p className="text-sm text-gray-600">{date}</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <span className={`text-xs font-semibold px-3 py-1 rounded-full ${payment.classes}`}>
                  {payment.label}
                </span>
                <span className={`text-xs font-semibold px-3 py-1 rounded-full ${delivery.classes}`}>
                  {delivery.label}
                </span>
              </div>
            </div>

            {/* Prodotti */}
            <div className="px-5 py-4 space-y-2">
              {order.order_items.map((item) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span className="text-gray-700">
                    {item.products?.[0]?.name ?? 'Prodotto rimosso'}
                    <span className="text-gray-400 ml-2">×{item.quantity}</span>
                  </span>
                  <span className="font-medium text-gray-800">
                    €{(item.unit_price * item.quantity).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>

            {/* Footer totale */}
            <div className="border-t px-5 py-3 flex justify-end">
              <span className="text-base font-bold text-indigo-700">
                Totale: €{Number(order.total_price).toFixed(2)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
