'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import DeliveryMap, { MapPoint } from '@/components/DeliveryMapLazy';
import VerifyCodeDialog from '@/components/VerifyCodeDialog';
import { formatPrice } from '@/lib/format';
import {
  ORDER_STATUS_LABEL,
  type OrderStatus,
} from '@/lib/order-status';
import { OrderStatusBadge } from '@/components/ui/OrderStatusBadge';
import { notify } from '@/lib/notifications';
import CashConfirmDialog from '@/components/rider/CashConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { friendlyError } from '@/lib/errors';
import EmptyState from '@/components/EmptyState';
import { Package } from 'lucide-react';
import { queryKeys } from '@/lib/queries/keys';

type OrderRow = {
  id: string;
  user_id: string;
  seller_id: string;
  total_price: number;
  shipping_cost: number;
  delivery_status: OrderStatus;
  payment_method: 'cod' | 'card' | null;
  cash_confirmed_at: string | null;
  delivery_full_name: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_zip: string | null;
  delivery_notes: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  seller: {
    store_name: string | null;
    store_phone: string | null;
    store_address: string | null;
    store_lat: number | null;
    store_lng: number | null;
  } | null;
  order_items: {
    id: string;
    quantity: number;
    unit_price: number;
    products: { name: string } | null;
  }[];
};

export default function RiderOrderDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const qc = useQueryClient();
  const router = useRouter();
  const [sharing, setSharing] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const [verifyOpen, setVerifyOpen] = useState<'pickup' | 'delivery' | null>(null);

  const { data: order, isLoading } = useQuery({
    queryKey: queryKeys.rider.order(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, user_id, seller_id, total_price, shipping_cost, delivery_status,
          payment_method, cash_confirmed_at,
          delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, delivery_notes,
          delivery_lat, delivery_lng,
          seller:profiles!orders_seller_id_fkey ( store_name, store_phone, store_address, store_lat, store_lng ),
          order_items ( id, quantity, unit_price, products ( name ) )
        `)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as unknown as OrderRow;
    },
  });

  // Transizione semplice (es. PICKED_UP → OUT_FOR_DELIVERY senza codice)
  const transition = useMutation({
    mutationFn: async (params: { newStatus: OrderStatus; timestampField?: string }) => {
      if (!order) throw new Error('Ordine non caricato');
      const update: Record<string, any> = { delivery_status: params.newStatus };
      if (params.timestampField) update[params.timestampField] = new Date().toISOString();
      const { error } = await supabase.from('orders').update(update).eq('id', order.id);
      if (error) throw error;

      notify({ userId: order.user_id, title: ORDER_STATUS_LABEL[params.newStatus], body: `Ordine #${order.id.slice(0, 6).toUpperCase()}`, link: `/orders/${order.id}` });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.rider.order(id) });
      qc.invalidateQueries({ queryKey: queryKeys.rider.orders });
      toast.success('Stato aggiornato');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  // Verifica codice pickup → server function (atomica + notifiche)
  const verifyPickup = async (code: string) => {
    const { data, error } = await supabase.rpc('verify_pickup_code', {
      p_order_id: id,
      p_code: code,
    });
    if (error) return { ok: false, reason: error.message };
    const result = data as { ok: boolean; reason?: string };
    // Rileggi SEMPRE lo stato (anche su fallimento): se un tentativo precedente
    // ha già cambiato lo stato dell'ordine, l'UI resta coerente.
    qc.invalidateQueries({ queryKey: queryKeys.rider.order(id) });
    qc.invalidateQueries({ queryKey: queryKeys.rider.orders });
    if (result.ok) {
      toast.success('✓ Ritiro confermato');
      setVerifyOpen(null);
    }
    return result;
  };

  // Verifica codice delivery → server function (atomica + notifiche)
  const verifyDelivery = async (code: string) => {
    const { data, error } = await supabase.rpc('verify_delivery_code', {
      p_order_id: id,
      p_code: code,
    });
    if (error) return { ok: false, reason: error.message };
    const result = data as { ok: boolean; reason?: string };
    // Rileggi SEMPRE lo stato (anche su fallimento) per coerenza UI.
    qc.invalidateQueries({ queryKey: queryKeys.rider.order(id) });
    qc.invalidateQueries({ queryKey: queryKeys.rider.orders });
    if (result.ok) {
      toast.success('✓ Consegna confermata!');
      stopSharing();
      setVerifyOpen(null);
      setTimeout(() => router.push('/rider'), 1000);
    }
    return result;
  };

  // GPS sharing — throttle DB writes ogni 30s minimo per non drenare batteria
  // Esperti consultati:
  // - Operations Manager: "GPS heartbeat ogni 5s = rider mob morto in 2h.
  //   Throttle 30s = batteria 6-8h ok."
  // - SRE: "maximumAge 30000 = browser usa fix cached, no GPS request continuo."
  const lastWriteAt = useRef(0);
  const startSharing = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocalizzazione non supportata');
      return;
    }
    setSharing(true);
    const wid = navigator.geolocation.watchPosition(
      async (pos) => {
        const now = Date.now();
        if (now - lastWriteAt.current < 30_000) return; // throttle
        lastWriteAt.current = now;
        await supabase
          .from('orders')
          .update({
            rider_lat: pos.coords.latitude,
            rider_lng: pos.coords.longitude,
            rider_position_updated_at: new Date().toISOString(),
          })
          .eq('id', id);
      },
      (err) => {
        toast.error('Errore GPS: ' + err.message);
        setSharing(false);
      },
      // maximumAge 30s + low-accuracy = ~10x battery improvement
      { enableHighAccuracy: false, maximumAge: 30_000, timeout: 30_000 },
    );
    watchIdRef.current = wid;
  };

  const stopSharing = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setSharing(false);
  };

  useEffect(() => () => stopSharing(), []);

  if (isLoading) return <LoadingState />;
  if (!order) return <EmptyState icon={Package} title="Ordine non trovato" ctaLabel="Tutti gli ordini" ctaHref="/rider" />;

  const subtotal = order.order_items.reduce((s, it) => s + it.quantity * Number(it.unit_price), 0);

  const points: MapPoint[] = [];
  if (order.seller?.store_lat && order.seller?.store_lng) {
    points.push({ lat: order.seller.store_lat, lng: order.seller.store_lng, label: 'Negozio', color: 'indigo' });
  }
  if (order.delivery_lat && order.delivery_lng) {
    points.push({ lat: order.delivery_lat, lng: order.delivery_lng, label: 'Cliente', color: 'rose' });
  }

  // Azioni in base allo stato
  const actions: { label: string; nextStatus: OrderStatus; timestampField?: string; color: string }[] = [];
  if (order.delivery_status === 'ASSIGNED') {
    actions.push({ label: '✋ Ho ritirato l\'ordine', nextStatus: 'PICKED_UP', timestampField: 'picked_up_at', color: 'bg-cyan-600 hover:bg-cyan-700' });
  } else if (order.delivery_status === 'PICKED_UP') {
    actions.push({ label: '🚚 In consegna al cliente', nextStatus: 'OUT_FOR_DELIVERY', color: 'bg-secondary-700 hover:bg-purple-700' });
  } else if (order.delivery_status === 'OUT_FOR_DELIVERY') {
    actions.push({ label: '✅ Consegnato', nextStatus: 'DELIVERED', timestampField: 'delivered_at', color: 'bg-olive-600 hover:bg-olive-700' });
  }

  // Destinazione corrente per il "Naviga"
  const navTarget =
    order.delivery_status === 'OUT_FOR_DELIVERY' || order.delivery_status === 'PICKED_UP'
      ? { lat: order.delivery_lat, lng: order.delivery_lng, label: order.delivery_address }
      : { lat: order.seller?.store_lat, lng: order.seller?.store_lng, label: order.seller?.store_address };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link href="/rider" className="text-sm text-accent-600 hover:underline">← Dashboard</Link>
          <h1 className="text-2xl font-bold text-ink-900 mt-1">
            #{order.id.slice(0, 6).toUpperCase()}
          </h1>
        </div>
        <OrderStatusBadge status={order.delivery_status} />
      </div>

      {/* MAPPA */}
      {points.length > 0 && (
        <div className="bg-white border border-cream-300 rounded-xl overflow-hidden">
          <DeliveryMap points={points} className="w-full h-72 z-0" />
        </div>
      )}

      {/* GPS SHARING */}
      <div className={`rounded-xl p-5 border-2 ${sharing ? 'bg-olive-50 border-olive-300' : 'bg-accent-50 border-accent-300'}`}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="font-bold text-ink-900">
              {sharing ? '📡 Posizione condivisa' : '📍 Condividi posizione'}
            </p>
            <p className="text-sm text-ink-600">
              {sharing
                ? 'Il cliente vede la tua posizione in tempo reale.'
                : 'Attiva il GPS per far vedere al cliente dove sei.'}
            </p>
          </div>
          {sharing ? (
            <button onClick={stopSharing} className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg font-semibold">
              Disattiva
            </button>
          ) : (
            <button onClick={startSharing} className="bg-olive-600 hover:bg-olive-700 text-white px-4 py-2 rounded-lg font-semibold">
              Attiva GPS
            </button>
          )}
        </div>
      </div>

      {/* AZIONE PRINCIPALE */}
      {order.delivery_status === 'ASSIGNED' && (
        <button
          onClick={() => setVerifyOpen('pickup')}
          className="w-full bg-cyan-600 hover:bg-cyan-700 text-white px-6 py-4 rounded-xl font-bold text-lg shadow-lg"
        >
          ✋ Conferma ritiro al negozio
        </button>
      )}
      {order.delivery_status === 'PICKED_UP' && (
        <div className="space-y-2">
          <button
            onClick={() => transition.mutate({ newStatus: 'OUT_FOR_DELIVERY' })}
            disabled={transition.isPending}
            className="w-full bg-secondary-700 hover:bg-purple-700 disabled:opacity-50 text-white px-6 py-4 rounded-xl font-bold text-lg shadow-lg"
          >
            🚚 Sto andando dal cliente
          </button>
          <button
            onClick={() => setVerifyOpen('delivery')}
            className="w-full bg-olive-600 hover:bg-olive-700 text-white px-6 py-4 rounded-xl font-bold text-lg shadow-lg"
          >
            ✅ Conferma consegna al cliente
          </button>
        </div>
      )}
      {order.delivery_status === 'OUT_FOR_DELIVERY' && (
        <button
          onClick={() => setVerifyOpen('delivery')}
          className="w-full bg-olive-600 hover:bg-olive-700 text-white px-6 py-4 rounded-xl font-bold text-lg shadow-lg"
        >
          ✅ Conferma consegna al cliente
        </button>
      )}

      {/* Dialog verifica */}
      <VerifyCodeDialog
        open={verifyOpen === 'pickup'}
        title="Codice ritiro"
        description="Chiedi al negoziante il codice a 6 cifre per confermare il ritiro."
        ctaLabel="Conferma ritiro"
        ctaColor="bg-cyan-600 hover:bg-cyan-700"
        onClose={() => setVerifyOpen(null)}
        onSubmit={verifyPickup}
      />
      <VerifyCodeDialog
        open={verifyOpen === 'delivery'}
        title="Codice consegna"
        description="Chiedi al cliente il codice a 6 cifre per chiudere la consegna."
        ctaLabel="Conferma consegna"
        ctaColor="bg-olive-600 hover:bg-olive-700"
        onClose={() => setVerifyOpen(null)}
        onSubmit={verifyDelivery}
      />

      {/* NAVIGA */}
      {navTarget.lat && navTarget.lng && order.delivery_status !== 'DELIVERED' && (
        <Button
          href={`https://www.google.com/maps/dir/?api=1&destination=${navTarget.lat},${navTarget.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          fullWidth
          size="lg"
        >🧭 Naviga su Google Maps</Button>
      )}

      {/* NEGOZIO */}
      <div className="bg-white border border-cream-300 rounded-xl p-5">
        <h3 className="text-xs uppercase tracking-wide text-ink-500 font-semibold mb-2">Ritira al negozio</h3>
        <p className="font-semibold text-ink-900">{order.seller?.store_name}</p>
        <p className="text-sm text-ink-700">{order.seller?.store_address}</p>
        {order.seller?.store_phone && (
          <a href={`tel:${order.seller.store_phone}`} className="text-sm text-primary-700 hover:underline mt-1 inline-block">
            📞 {order.seller.store_phone}
          </a>
        )}
      </div>

      {/* CLIENTE */}
      <div className="bg-white border border-cream-300 rounded-xl p-5">
        <h3 className="text-xs uppercase tracking-wide text-ink-500 font-semibold mb-2">Consegna a</h3>
        <p className="font-semibold text-ink-900">{order.delivery_full_name}</p>
        <p className="text-sm text-ink-700">{order.delivery_address}, {order.delivery_zip} {order.delivery_city}</p>
        {order.delivery_phone && (
          <a href={`tel:${order.delivery_phone}`} className="text-sm text-primary-700 hover:underline mt-1 inline-block">
            📞 {order.delivery_phone}
          </a>
        )}
        {order.delivery_notes && (
          <p className="text-sm text-ink-600 italic mt-2 bg-accent-50 p-2 rounded">📝 {order.delivery_notes}</p>
        )}
      </div>

      {/* PRODOTTI */}
      <div className="bg-white border border-cream-300 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-cream-200">
          <h3 className="font-semibold text-ink-900">Articoli ({order.order_items.length})</h3>
        </div>
        <div className="divide-y divide-cream-100 text-sm">
          {order.order_items.map((it) => (
            <div key={it.id} className="px-5 py-2.5 flex justify-between">
              <span>{it.products?.name ?? 'Prodotto'} <span className="text-ink-400">×{it.quantity}</span></span>
              <span className="text-ink-600">{formatPrice(Number(it.unit_price) * it.quantity)}</span>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-cream-200 bg-cream-50 text-sm flex justify-between font-bold">
          <span>
            {order.payment_method === 'card'
              ? 'Totale (gia\' pagato online)'
              : 'Totale (da incassare in contanti)'}
          </span>
          <span className="text-primary-800">{formatPrice(order.total_price)}</span>
        </div>
      </div>

      {/* CASH ON DELIVERY: conferma incasso */}
      {order.payment_method === 'cod'
        && (order.delivery_status === 'PICKED_UP' || order.delivery_status === 'OUT_FOR_DELIVERY' || order.delivery_status === 'DELIVERED')
        && !order.cash_confirmed_at && (
          <div className="bg-accent-50 border-2 border-accent-300 rounded-xl p-4 space-y-3">
            <div>
              <p className="font-bold text-accent-900">⚠ Conferma incasso obbligatoria</p>
              <p className="text-sm text-accent-800">
                Devi confermare l&apos;importo ricevuto, con una foto del pagamento. Senza
                conferma l&apos;ordine non viene chiuso e potresti non ricevere il rimborso del
                tuo compenso.
              </p>
            </div>
            <CashConfirmDialog
              orderId={order.id}
              expectedCents={Math.round(Number(order.total_price) * 100)}
              onConfirmed={() => qc.invalidateQueries({ queryKey: queryKeys.rider.order(id) })}
            />
          </div>
        )}

      {order.payment_method === 'cod' && order.cash_confirmed_at && (
        <div className="bg-olive-50 border-2 border-olive-200 rounded-xl p-4 text-sm text-olive-900">
          ✓ Incasso confermato il {new Date(order.cash_confirmed_at).toLocaleString('it-IT')}.
        </div>
      )}
    </div>
  );
}
