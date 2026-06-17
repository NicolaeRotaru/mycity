'use client';;
import { use } from "react";

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { formatPrice, formatDate } from '@/lib/format';
import {
  ORDER_STATUS_LABEL,
  type OrderStatus,
} from '@/lib/order-status';
import { OrderStatusBadge } from '@/components/ui/OrderStatusBadge';
import OrderTimeline from '@/components/OrderTimeline';
import { notify } from '@/lib/notifications';
import SimpleQR from '@/components/SimpleQR';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { friendlyError } from '@/lib/errors';
import EmptyState from '@/components/EmptyState';
import { Package, CheckCircle2, X, Printer, Bike, Phone, MapPin, Clock } from 'lucide-react';
import { queryKeys } from '@/lib/queries/keys';
import ReturnRequestCard, { type ReturnRow } from '@/components/seller/ReturnRequestCard';

type OrderRow = {
  id: string;
  user_id: string;
  total_price: number;
  shipping_cost: number;
  delivery_status: OrderStatus;
  created_at: string;
  accepted_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  canceled_at: string | null;
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

export default function SellerOrderDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const { id } = params;
  const qc = useQueryClient();

  const { data: order, isLoading } = useQuery({
    queryKey: queryKeys.seller.order(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, user_id, total_price, shipping_cost, delivery_status, created_at,
          accepted_at, ready_at, picked_up_at, delivered_at, canceled_at,
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
    refetchInterval: 30_000,
  });

  // Codice ritiro: visibile solo al seller (RLS lo limita ai propri ordini)
  const { data: pickupCode } = useQuery({
    queryKey: queryKeys.seller.pickupCode(id),
    enabled: !!order && ['ACCEPTED', 'READY', 'ASSIGNED'].includes(order.delivery_status),
    queryFn: async () => {
      const { data } = await supabase
        .from('order_pickup_codes')
        .select('code, verified_at')
        .eq('order_id', id)
        .maybeSingle();
      return data;
    },
  });

  // Eventuale richiesta di reso collegata a quest'ordine (UI venditore).
  const { data: returnRow } = useQuery({
    queryKey: queryKeys.seller.returnForOrder(id),
    queryFn: async () => {
      const { data } = await supabase
        .from('returns')
        .select('id, status, reason, notes, photo_urls, refund_amount_cents, decision_notes, created_at')
        .eq('order_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const reject = useMutation({
    mutationFn: async (reason?: string) => {
      const { data, error } = await supabase.rpc('seller_reject_order', {
        p_order_id: id,
        p_reason: reason ?? null,
      });
      if (error) throw error;
      const r = data as { ok: boolean; reason?: string };
      if (!r.ok) throw new Error(r.reason ?? 'Impossibile rifiutare');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.seller.order(id) });
      qc.invalidateQueries({ queryKey: queryKeys.seller.orders });
      toast.success('Ordine rifiutato');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
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
          title: ORDER_STATUS_LABEL[params.newStatus],
          body: `Ordine #${order.id.slice(0, 6).toUpperCase()}`,
          link: `/orders/${order.id}`,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.seller.order(id) });
      qc.invalidateQueries({ queryKey: queryKeys.seller.orders });
      toast.success('Stato aggiornato');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  if (isLoading) return <LoadingState />;
  if (!order) return <EmptyState icon={Package} title="Ordine non trovato" description="L'ordine non esiste o non hai i permessi per vederlo." ctaLabel="Tutti gli ordini" ctaHref="/seller/orders" />;

  const subtotal = order.order_items.reduce((s, it) => s + it.quantity * Number(it.unit_price), 0);

  const showPickupCode = ['ACCEPTED', 'READY', 'ASSIGNED'].includes(order.delivery_status) && pickupCode?.code;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link href="/seller/orders" className="text-sm text-primary-700 hover:underline">← Tutti gli ordini</Link>
          <h1 className="text-2xl font-bold text-ink-900 mt-1">
            Ordine #{order.id.slice(0, 6).toUpperCase()}
          </h1>
          <p className="text-sm text-ink-500">{formatDate(order.created_at)}</p>
        </div>
        <OrderStatusBadge status={order.delivery_status} />
      </div>
      <OrderTimeline
        status={order.delivery_status}
        createdAt={order.created_at}
        acceptedAt={order.accepted_at}
        readyAt={order.ready_at}
        pickedUpAt={order.picked_up_at}
        deliveredAt={order.delivered_at}
        canceledAt={order.canceled_at}
      />
      {/* RICHIESTA DI RESO */}
      {returnRow && (
        <ReturnRequestCard
          ret={returnRow as unknown as ReturnRow}
          orderTotal={Number(order.total_price)}
          onDecided={() => {
            qc.invalidateQueries({ queryKey: queryKeys.seller.returnForOrder(id) });
            qc.invalidateQueries({ queryKey: queryKeys.seller.order(id) });
          }}
        />
      )}
      {/* AZIONI */}
      {order.delivery_status === 'NEW' && (
        <div className="bg-white border border-cream-300 rounded-xl p-5">
          <p className="text-sm text-ink-600 mb-3">Vuoi accettare questo ordine?</p>
          <div className="flex gap-2 flex-wrap">
            <Button
              icon={CheckCircle2}
              onClick={() => transition.mutate({ newStatus: 'ACCEPTED', timestampField: 'accepted_at' })}
              loading={transition.isPending}
            >
              Accetta ordine
            </Button>
            <button
              onClick={() => {
                const reason = prompt('Motivo del rifiuto (visibile al cliente):');
                if (reason !== null) reject.mutate(reason || undefined);
              }}
              disabled={reject.isPending}
              className="inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg font-semibold disabled:opacity-50"
            >
              <X size={16} aria-hidden /> Rifiuta
            </button>
          </div>
        </div>
      )}
      {order.delivery_status === 'ACCEPTED' && (
        <div className="bg-white border border-cream-300 rounded-xl p-5">
          <p className="text-sm text-ink-600 mb-3">Quando hai finito di preparare l&apos;ordine:</p>
          <div className="flex gap-2 flex-wrap">
            <Button
              icon={Package}
              onClick={() => transition.mutate({ newStatus: 'READY', timestampField: 'ready_at' })}
              loading={transition.isPending}
            >
              Pronto per il rider
            </Button>
            {/* Print thermal label — Operations Manager: 1 click vs scrivere a mano */}
            <a
              href={`/api/seller/orders/${order.id}/label`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 bg-white border border-cream-300 hover:border-primary-300 text-ink-900 px-4 py-2 rounded-lg font-semibold text-sm"
            >
              <Printer size={16} aria-hidden /> Stampa etichetta
            </a>
          </div>
        </div>
      )}
      {/* CODICE RITIRO (visibile dopo ACCEPTED) */}
      {showPickupCode && (
        <div className="bg-gradient-to-br from-cyan-500 to-blue-600 text-white rounded-2xl p-6 shadow-lg">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <p className="text-xs uppercase tracking-widest text-cyan-100 font-semibold">Codice ritiro</p>
              <p className="font-mono font-extrabold text-4xl sm:text-5xl tracking-[0.3em] my-2">
                {pickupCode!.code}
              </p>
              <p className="text-sm text-cyan-100">
                {pickupCode!.verified_at
                  ? 'Codice già usato dal rider per ritirare.'
                  : 'Mostra questo codice (o il QR) al rider quando viene a ritirare l\'ordine.'}
              </p>
            </div>
            <div className="bg-white p-2 rounded-lg shrink-0">
              <SimpleQR value={pickupCode!.code} size={120} />
            </div>
          </div>
        </div>
      )}
      {order.delivery_status === 'READY' && !order.rider_id && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 text-sm text-violet-800 flex items-center gap-2">
          <Clock size={16} aria-hidden className="shrink-0" /> In attesa che un rider prenda in carico questo ordine.
        </div>
      )}
      {order.rider_id && order.delivery_status !== 'DELIVERED' && (
        <div className="bg-primary-50 border border-primary-200 rounded-xl p-4 text-sm text-primary-800 flex items-center gap-2">
          <Bike size={16} aria-hidden className="shrink-0" /> <span>Rider <strong>{order.rider?.full_name ?? 'assegnato'}</strong> sta gestendo la consegna.</span>
        </div>
      )}
      {/* CLIENTE + INDIRIZZO */}
      <div className="bg-white border border-cream-300 rounded-xl p-6">
        <h2 className="font-semibold text-ink-900 mb-3">Cliente</h2>
        <div className="text-sm space-y-1 text-ink-700">
          <p className="font-medium text-ink-900">{order.delivery_full_name}</p>
          <p className="flex items-center gap-1.5"><Phone size={14} aria-hidden className="shrink-0 text-ink-400" /> <a href={`tel:${order.delivery_phone}`} className="text-primary-700 hover:underline">{order.delivery_phone}</a></p>
          <p className="flex items-start gap-1.5"><MapPin size={14} aria-hidden className="shrink-0 text-ink-400 mt-0.5" /> <span>{order.delivery_address}, {order.delivery_zip} {order.delivery_city}</span></p>
          {order.delivery_notes && <p className="text-ink-500 italic mt-2">Note: {order.delivery_notes}</p>}
        </div>
      </div>
      {/* PRODOTTI */}
      <div className="bg-white border border-cream-300 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-cream-200">
          <h2 className="font-semibold text-ink-900">Da preparare</h2>
        </div>
        <div className="divide-y divide-cream-100">
          {order.order_items.map((it) => {
            const img = it.products?.images?.[0];
            return (
              <div key={it.id} className="px-6 py-3 flex items-center gap-4">
                <div className="w-14 h-14 rounded bg-cream-100 overflow-hidden flex items-center justify-center shrink-0">
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    (<img src={img} alt="" loading="lazy" className="w-full h-full object-cover" />)
                  ) : <Package size={20} className="text-ink-400" aria-hidden />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-ink-900 truncate">{it.products?.name ?? 'Prodotto'}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-lg text-ink-900">×{it.quantity}</p>
                  <p className="text-xs text-ink-500">{formatPrice(Number(it.unit_price) * it.quantity)}</p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-6 py-4 border-t border-cream-200 bg-cream-50 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-ink-600">Subtotale</span><span>{formatPrice(subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-ink-600">Spedizione</span><span>{order.shipping_cost > 0 ? formatPrice(order.shipping_cost) : 'GRATUITA'}</span></div>
          <div className="flex justify-between font-bold text-base pt-1 border-t border-cream-300"><span>Totale</span><span className="text-primary-800">{formatPrice(order.total_price)}</span></div>
        </div>
      </div>
    </div>
  );
}
