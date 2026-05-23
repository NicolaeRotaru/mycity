'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import DeliveryMap, { MapPoint } from '@/components/DeliveryMap';
import { formatPrice, formatDate } from '@/lib/format';
import { addToCart, clearCart } from '@/lib/cart';
import { toast } from 'sonner';
import {
  BUYER_TIMELINE,
  ORDER_STATUS_EMOJI,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_COLOR,
  isPastStatus,
  isActiveStatus,
  type OrderStatus,
} from '@/lib/order-status';

type OrderRow = {
  id: string;
  total_price: number;
  shipping_cost: number;
  delivery_status: OrderStatus;
  payment_status: string;
  created_at: string;
  accepted_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  delivery_full_name: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_zip: string | null;
  delivery_notes: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  rider_lat: number | null;
  rider_lng: number | null;
  rider_position_updated_at: string | null;
  rider_id: string | null;
  seller: {
    store_name: string | null;
    store_logo: string | null;
    store_phone: string | null;
    store_address: string | null;
    store_lat: number | null;
    store_lng: number | null;
  } | null;
  rider: { full_name: string | null } | null;
  seller_id: string | null;
  order_items: {
    id: string;
    quantity: number;
    unit_price: number;
    product_id: string | null;
    products: { name: string; images: string[] | null } | null;
  }[];
};

const fetchOrder = async (id: string): Promise<OrderRow | null> => {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, total_price, shipping_cost, delivery_status, payment_status, created_at,
      accepted_at, ready_at, picked_up_at, delivered_at,
      delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, delivery_notes,
      delivery_lat, delivery_lng,
      rider_lat, rider_lng, rider_position_updated_at, rider_id,
      seller:profiles!orders_seller_id_fkey ( store_name, store_logo, store_phone, store_address, store_lat, store_lng ),
      rider:profiles!orders_rider_id_fkey ( full_name ),
      seller_id,
      order_items (
        id, quantity, unit_price, product_id,
        products ( name, images )
      )
    `)
    .eq('id', id)
    .single();
  if (error) return null;
  return data as unknown as OrderRow;
};

export default function BuyerOrderDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();

  const { data: order, isLoading, refetch } = useQuery({
    queryKey: ['order', id],
    queryFn: () => fetchOrder(id),
  });

  // Realtime subscription: aggiornamenti live dell'ordine (stato + posizione rider)
  useEffect(() => {
    const channel = supabase
      .channel(`order:${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` },
        () => refetch(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, refetch]);

  if (isLoading) return <div className="container mx-auto p-8 text-center text-gray-500">Caricamento...</div>;
  if (!order) return <div className="container mx-auto p-8 text-center text-gray-500">Ordine non trovato.</div>;

  const status = order.delivery_status;
  const c = ORDER_STATUS_COLOR[status];

  const points: MapPoint[] = [];
  if (order.seller?.store_lat && order.seller?.store_lng) {
    points.push({ lat: order.seller.store_lat, lng: order.seller.store_lng, label: 'Negozio', color: 'indigo' });
  }
  if (order.delivery_lat && order.delivery_lng) {
    points.push({ lat: order.delivery_lat, lng: order.delivery_lng, label: 'Casa tua', color: 'rose' });
  }
  if (order.rider_lat && order.rider_lng && status !== 'DELIVERED' && status !== 'CANCELED') {
    points.push({ lat: order.rider_lat, lng: order.rider_lng, label: 'Rider', color: 'amber' });
  }

  const subtotal = order.order_items.reduce((s, it) => s + it.quantity * Number(it.unit_price), 0);
  const isDelivered = status === 'DELIVERED';

  const handleReorder = () => {
    clearCart();
    let added = 0;
    for (const it of order.order_items) {
      if (!it.product_id || !it.products?.name) continue;
      addToCart({
        id: it.product_id,
        name: it.products.name,
        price: Number(it.unit_price),
        image: it.products.images?.[0],
        quantity: it.quantity,
        sellerId: order.seller_id ?? undefined,
        storeName: order.seller?.store_name ?? undefined,
      });
      added++;
    }
    toast.success(`${added} articoli aggiunti al carrello!`);
    router.push('/cart');
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl space-y-6">
      {/* HEADER */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link href="/orders" className="text-sm text-indigo-600 hover:underline">← Tutti gli ordini</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">
            Ordine #{order.id.slice(0, 6).toUpperCase()}
          </h1>
          <p className="text-sm text-gray-500">{formatDate(order.created_at)}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ring-1 ${c.bg} ${c.text} ${c.ring}`}>
          <span>{ORDER_STATUS_EMOJI[status]}</span>
          {ORDER_STATUS_LABEL[status]}
        </span>
      </div>

      {isDelivered && (
        <div className="bg-emerald-50 border-2 border-emerald-200 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-emerald-800 font-medium">
            ✅ Ordine consegnato! Com'è andata?
          </p>
          <div className="flex gap-2 flex-wrap">
            <Link
              href={`/orders/${id}/review`}
              className="bg-amber-400 hover:bg-amber-500 text-gray-900 px-4 py-2 rounded-lg font-semibold text-sm"
            >
              ⭐ Lascia recensione
            </Link>
            <button
              onClick={handleReorder}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-semibold text-sm"
            >
              🔁 Ripeti ordine
            </button>
          </div>
        </div>
      )}

      {/* TIMELINE */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Stato della consegna</h2>
        {status === 'CANCELED' ? (
          <div className="text-rose-700 text-sm">Questo ordine è stato annullato.</div>
        ) : (
          <ol className="space-y-3">
            {BUYER_TIMELINE.map((step, i) => {
              const past = isPastStatus(status, step);
              const active = isActiveStatus(status, step);
              return (
                <li key={step} className="flex items-start gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 ${
                      past
                        ? 'bg-emerald-500 text-white'
                        : active
                        ? 'bg-indigo-600 text-white ring-4 ring-indigo-100 animate-pulse'
                        : 'bg-gray-200 text-gray-400'
                    }`}
                  >
                    {past ? '✓' : i + 1}
                  </div>
                  <div className="flex-1 pt-1">
                    <p className={`text-sm ${past || active ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>
                      {ORDER_STATUS_EMOJI[step]} {ORDER_STATUS_LABEL[step]}
                    </p>
                    {step === 'ACCEPTED' && order.accepted_at && (
                      <p className="text-xs text-gray-500">{new Date(order.accepted_at).toLocaleString('it-IT')}</p>
                    )}
                    {step === 'READY' && order.ready_at && (
                      <p className="text-xs text-gray-500">{new Date(order.ready_at).toLocaleString('it-IT')}</p>
                    )}
                    {step === 'PICKED_UP' && order.picked_up_at && (
                      <p className="text-xs text-gray-500">{new Date(order.picked_up_at).toLocaleString('it-IT')}</p>
                    )}
                    {step === 'DELIVERED' && order.delivered_at && (
                      <p className="text-xs text-gray-500">{new Date(order.delivered_at).toLocaleString('it-IT')}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* MAPPA + RIDER LIVE */}
      {points.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="font-semibold text-gray-900">📍 Tracking in tempo reale</h2>
              {order.rider_id && (status === 'PICKED_UP' || status === 'OUT_FOR_DELIVERY') ? (
                <p className="text-sm text-emerald-600">
                  ● Rider in movimento
                  {order.rider_position_updated_at && (
                    <span className="text-gray-500 ml-1">
                      · agg. {new Date(order.rider_position_updated_at).toLocaleTimeString('it-IT')}
                    </span>
                  )}
                </p>
              ) : status === 'ASSIGNED' ? (
                <p className="text-sm text-indigo-600">● Rider in arrivo al negozio</p>
              ) : (
                <p className="text-sm text-gray-500">Posizione rider non ancora disponibile</p>
              )}
            </div>
          </div>
          <DeliveryMap points={points} className="w-full h-72 z-0" />
        </div>
      )}

      {/* INFO NEGOZIO E RIDER */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Negozio</h3>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center text-xl">
              {order.seller?.store_logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={order.seller.store_logo} alt="" className="w-full h-full object-cover" />
              ) : '🏪'}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 truncate">{order.seller?.store_name ?? '—'}</p>
              {order.seller?.store_phone && (
                <a href={`tel:${order.seller.store_phone}`} className="text-sm text-indigo-600 hover:underline">
                  📞 {order.seller.store_phone}
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Rider</h3>
          {order.rider_id ? (
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-xl">
                🛵
              </div>
              <div>
                <p className="font-semibold text-gray-900">{order.rider?.full_name ?? 'Rider'}</p>
                <p className="text-sm text-gray-500">Assegnato alla consegna</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Nessun rider ancora assegnato.</p>
          )}
        </div>
      </div>

      {/* PRODOTTI */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Articoli dell'ordine</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {order.order_items.map((it) => {
            const img = it.products?.images?.[0];
            return (
              <div key={it.id} className="px-6 py-3 flex items-center gap-4">
                <div className="w-14 h-14 rounded bg-gray-100 overflow-hidden flex items-center justify-center shrink-0">
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  ) : '📦'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{it.products?.name ?? 'Prodotto'}</p>
                  <p className="text-sm text-gray-500">×{it.quantity}</p>
                </div>
                <p className="font-semibold text-gray-900">{formatPrice(Number(it.unit_price) * it.quantity)}</p>
              </div>
            );
          })}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-gray-600">Subtotale</span><span>{formatPrice(subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-gray-600">Spedizione</span><span>{order.shipping_cost > 0 ? formatPrice(order.shipping_cost) : 'GRATUITA'}</span></div>
          <div className="flex justify-between font-bold text-base pt-1 border-t border-gray-200"><span>Totale</span><span className="text-indigo-700">{formatPrice(order.total_price)}</span></div>
        </div>
      </div>

      {/* INDIRIZZO CONSEGNA */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="font-semibold text-gray-900 mb-3">Consegna a</h2>
        <div className="text-sm space-y-1 text-gray-700">
          <p className="font-medium">{order.delivery_full_name}</p>
          <p>{order.delivery_address}</p>
          <p>{order.delivery_zip} {order.delivery_city}</p>
          <p>📞 {order.delivery_phone}</p>
          {order.delivery_notes && <p className="text-gray-500 italic mt-2">Note: {order.delivery_notes}</p>}
        </div>
      </div>
    </div>
  );
}
