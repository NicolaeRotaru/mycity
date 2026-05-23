'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { formatPrice, formatDate } from '@/lib/format';
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_EMOJI,
  ORDER_STATUS_COLOR,
  type OrderStatus,
} from '@/lib/order-status';
import { notify } from '@/lib/notifications';

type OrderRow = {
  id: string;
  user_id: string;
  total_price: number;
  shipping_cost: number;
  delivery_status: OrderStatus;
  created_at: string;
  delivery_full_name: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_zip: string | null;
  delivery_notes: string | null;
  rider_id: string | null;
  rider: { full_name: string | null } | null;
  order_items: {
    id: string;
    quantity: number;
    unit_price: number;
    products: { name: string; images: string[] | null } | null;
  }[];
};

export default function SellerOrderDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const qc = useQueryClient();

  const { data: order, isLoading } = useQuery({
    queryKey: ['seller-order', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, user_id, total_price, shipping_cost, delivery_status, created_at,
          delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, delivery_notes,
          rider_id,
          rider:profiles!orders_rider_id_fkey ( full_name ),
          order_items (
            id, quantity, unit_price,
            products ( name, images )
          )
        `)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as unknown as OrderRow;
    },
  });

  const transition = useMutation({
    mutationFn: async (params: { newStatus: OrderStatus; timestampField?: string }) => {
      if (!order) throw new Error('Ordine non caricato');
      const update: Record<string, any> = { delivery_status: params.newStatus };
      if (params.timestampField) update[params.timestampField] = new Date().toISOString();

      const { error } = await supabase.from('orders').update(update).eq('id', order.id);
      if (error) throw error;

      // Notifica il buyer del cambio stato
      if (order.user_id) {
        notify({
          userId: order.user_id,
          title: `${ORDER_STATUS_EMOJI[params.newStatus]} ${ORDER_STATUS_LABEL[params.newStatus]}`,
          body: `Ordine #${order.id.slice(0, 6).toUpperCase()}`,
          link: `/orders/${order.id}`,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seller-order', id] });
      qc.invalidateQueries({ queryKey: ['seller-orders'] });
      toast.success('Stato aggiornato');
    },
    onError: (err: any) => toast.error(err.message),
  });

  if (isLoading) return <div className="text-center py-8 text-gray-500">Caricamento...</div>;
  if (!order) return <div className="text-center py-8 text-gray-500">Ordine non trovato.</div>;

  const c = ORDER_STATUS_COLOR[order.delivery_status];
  const subtotal = order.order_items.reduce((s, it) => s + it.quantity * Number(it.unit_price), 0);

  // Bottoni azione in base allo stato
  const actions: { label: string; nextStatus: OrderStatus; timestampField: string; color: string }[] = [];
  if (order.delivery_status === 'NEW') {
    actions.push({ label: '✓ Accetta ordine', nextStatus: 'ACCEPTED', timestampField: 'accepted_at', color: 'bg-blue-600 hover:bg-blue-700' });
    actions.push({ label: '✕ Rifiuta',          nextStatus: 'CANCELED', timestampField: 'canceled_at', color: 'bg-rose-600 hover:bg-rose-700' });
  } else if (order.delivery_status === 'ACCEPTED') {
    actions.push({ label: '📦 Pronto per il rider', nextStatus: 'READY', timestampField: 'ready_at', color: 'bg-violet-600 hover:bg-violet-700' });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link href="/seller/orders" className="text-sm text-indigo-600 hover:underline">← Tutti gli ordini</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">
            Ordine #{order.id.slice(0, 6).toUpperCase()}
          </h1>
          <p className="text-sm text-gray-500">{formatDate(order.created_at)}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ring-1 ${c.bg} ${c.text} ${c.ring}`}>
          <span>{ORDER_STATUS_EMOJI[order.delivery_status]}</span>
          {ORDER_STATUS_LABEL[order.delivery_status]}
        </span>
      </div>

      {/* AZIONI */}
      {actions.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-sm text-gray-600 mb-3">Cosa vuoi fare?</p>
          <div className="flex gap-2 flex-wrap">
            {actions.map((a) => (
              <button
                key={a.nextStatus}
                onClick={() => transition.mutate({ newStatus: a.nextStatus, timestampField: a.timestampField })}
                disabled={transition.isPending}
                className={`${a.color} text-white px-4 py-2 rounded-lg font-semibold disabled:opacity-50`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {order.delivery_status === 'READY' && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 text-sm text-violet-800">
          ⏳ In attesa che un rider prenda in carico questo ordine.
        </div>
      )}
      {order.rider_id && order.delivery_status !== 'DELIVERED' && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-sm text-indigo-800">
          🛵 Rider <strong>{order.rider?.full_name ?? 'assegnato'}</strong> sta gestendo la consegna.
        </div>
      )}

      {/* CLIENTE + INDIRIZZO */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="font-semibold text-gray-900 mb-3">Cliente</h2>
        <div className="text-sm space-y-1 text-gray-700">
          <p className="font-medium text-gray-900">{order.delivery_full_name}</p>
          <p>📞 <a href={`tel:${order.delivery_phone}`} className="text-indigo-600 hover:underline">{order.delivery_phone}</a></p>
          <p>📍 {order.delivery_address}, {order.delivery_zip} {order.delivery_city}</p>
          {order.delivery_notes && <p className="text-gray-500 italic mt-2">Note: {order.delivery_notes}</p>}
        </div>
      </div>

      {/* PRODOTTI */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Da preparare</h2>
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
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-lg text-gray-900">×{it.quantity}</p>
                  <p className="text-xs text-gray-500">{formatPrice(Number(it.unit_price) * it.quantity)}</p>
                </div>
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
    </div>
  );
}
