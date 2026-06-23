'use client';

import { useEffect, useRef, useState, use } from 'react';
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
import {
  Package, Radio, MapPin, PackageCheck, Bike, CircleCheck, Navigation, Phone,
  StickyNote, Banknote, Check, ChevronLeft, Store, MessageSquare, Clock,
} from 'lucide-react';
import { haversineKm, deliveryEtaMinutes } from '@/lib/geo';
import { queryKeys } from '@/lib/queries/keys';

type OrderRow = {
  id: string;
  user_id: string;
  seller_id: string;
  total_price: number;
  shipping_cost: number;
  delivery_status: OrderStatus;
  created_at: string;
  accepted_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  canceled_at: string | null;
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

// Segmenti progresso consegna (il rider parte da ASSIGNED).
const FLOW: OrderStatus[] = ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'];

export default function RiderOrderDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
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
          created_at, accepted_at, ready_at, picked_up_at, delivered_at, canceled_at,
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

  // Rilascio ordine: il rider non puo' completarlo → torna READY per altri rider (P2).
  const release = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('rider_release_order', { p_order_id: id });
      if (error) throw new Error(error.message);
      const r = data as { ok: boolean; reason?: string };
      if (!r.ok) throw new Error(r.reason ?? 'Impossibile rilasciare');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.rider.orders });
      toast.success('Ordine rilasciato: tornerà disponibile per altri rider');
      router.push('/rider');
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
      toast.success('Ritiro confermato');
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
      toast.success('Consegna confermata!');
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
  if (!order) return <EmptyState icon={Package} title="Ordine non trovato" ctaLabel="Tutte le consegne" ctaHref="/rider" />;

  const points: MapPoint[] = [];
  if (order.seller?.store_lat && order.seller?.store_lng) {
    // Store marker → terracotta (primary). 'amber' key maps to primary-600 in DeliveryMap.
    points.push({ lat: order.seller.store_lat, lng: order.seller.store_lng, label: 'Negozio', color: 'amber' });
  }
  if (order.delivery_lat && order.delivery_lng) {
    // Customer marker → olive. 'emerald' key maps to olive-600 in DeliveryMap.
    points.push({ lat: order.delivery_lat, lng: order.delivery_lng, label: 'Cliente', color: 'emerald' });
  }

  const done = order.delivery_status === 'DELIVERED';
  const stepIdx = FLOW.indexOf(order.delivery_status);
  // Step 0 (ASSIGNED) → target negozio; gli step successivi → target cliente.
  const targetIsStore = order.delivery_status === 'ASSIGNED';

  // Destinazione corrente per il "Naviga"
  const navTarget = targetIsStore
    ? { lat: order.seller?.store_lat, lng: order.seller?.store_lng }
    : { lat: order.delivery_lat, lng: order.delivery_lng };
  const callPhone = targetIsStore ? order.seller?.store_phone : order.delivery_phone;

  // Distanza·ETA della tratta negozio → cliente (entrambe le coordinate note):
  // stima la lunghezza della consegna per la pill sulla mappa. Senza prep time.
  const sLat = order.seller?.store_lat;
  const sLng = order.seller?.store_lng;
  const tripKm = sLat && sLng && order.delivery_lat && order.delivery_lng
    ? haversineKm(sLat, sLng, order.delivery_lat, order.delivery_lng)
    : null;
  const tripEta = tripKm !== null ? deliveryEtaMinutes(tripKm, 0) : null;

  return (
    <div className="flex min-h-screen flex-col pb-[calc(80px+env(safe-area-inset-bottom,0px))]">
      {/* MAPPA in testa (map-led) */}
      <div className="relative">
        {points.length > 0 ? (
          <DeliveryMap points={points} className="z-0 h-56 w-full" />
        ) : (
          <div className="flex h-56 w-full flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-olive-100 to-cream-200 px-6 text-center text-ink-500">
            <MapPin size={28} aria-hidden />
            <p className="text-sm font-semibold text-ink-700">Mappa non disponibile</p>
            <p className="text-xs text-ink-500">
              Manca la posizione GPS per questo ordine. Usa l&apos;indirizzo qui sotto e tocca &quot;Naviga&quot;.
            </p>
          </div>
        )}
        {/* Pill distanza · ETA della tratta (se entrambe le coordinate note). */}
        {tripKm !== null && tripEta !== null && (
          <span className="absolute bottom-3 left-3 z-[1] inline-flex items-center gap-1.5 rounded-full bg-ink-900/80 px-3 py-1.5 text-xs font-semibold text-white">
            <Bike size={13} aria-hidden /> {tripKm.toFixed(1).replace('.', ',')} km
            <span className="text-white/50">·</span>
            <Clock size={13} aria-hidden /> ~{tripEta} min
          </span>
        )}
        {/* Back flottante */}
        <Link
          href="/rider"
          aria-label="Torna alle consegne"
          className="absolute left-3 top-3 z-[1] inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface-0/95 text-ink-700 shadow-warm-sm hover:bg-surface-0"
        >
          <ChevronLeft size={20} aria-hidden />
        </Link>
        <span className="absolute right-3 top-3 z-[1] rounded-full bg-ink-900/80 px-3 py-1.5 text-xs font-semibold text-white">
          #{order.id.slice(0, 6).toUpperCase()}
        </span>
      </div>

      <div className="flex-1 px-4 pt-4">
        {/* Stato + progresso segmentato */}
        <div className="mb-3 flex items-center justify-between">
          <OrderStatusBadge status={order.delivery_status} />
        </div>
        <div className="mb-[18px] flex items-center gap-1">
          {FLOW.map((s, i) => (
            <div
              key={s}
              className={`h-[5px] flex-1 rounded-full ${i <= stepIdx ? 'bg-olive-500' : 'bg-cream-300'}`}
            />
          ))}
        </div>

        {/* Card target unica con azioni Naviga / Chiama */}
        {!done && (
          <div className="mb-3.5 rounded-xl border border-cream-300 bg-surface-0 p-4 shadow-warm">
            <p className="mb-1 text-[12px] font-bold uppercase tracking-[0.03em] text-ink-400">
              {targetIsStore ? 'Ritira al negozio' : 'Consegna al cliente'}
            </p>
            <p className="flex items-center gap-1.5 font-serif text-xl font-bold text-ink-900">
              {targetIsStore
                ? <><Store size={18} className="text-primary-600" aria-hidden /> {order.seller?.store_name}</>
                : order.delivery_full_name}
            </p>
            <p className="mb-3 mt-0.5 text-sm text-ink-600">
              {targetIsStore
                ? order.seller?.store_address
                : `${order.delivery_address}, ${order.delivery_zip ?? ''} ${order.delivery_city ?? ''}`}
            </p>
            <div className="flex gap-2">
              {navTarget.lat && navTarget.lng && (
                <Button
                  href={`https://www.google.com/maps/dir/?api=1&destination=${navTarget.lat},${navTarget.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="secondary"
                  size="sm"
                  icon={Navigation}
                  fullWidth
                >
                  Naviga
                </Button>
              )}
              {callPhone && (
                <Button href={`tel:${callPhone}`} variant="secondary" size="sm" icon={Phone} fullWidth>
                  Chiama
                </Button>
              )}
              {callPhone && (
                <Button
                  href={`sms:${callPhone}`}
                  variant="secondary"
                  size="sm"
                  icon={MessageSquare}
                  fullWidth
                >
                  Chat
                </Button>
              )}
            </div>
            {!targetIsStore && order.delivery_notes && (
              <p className="mt-3 flex items-start gap-1.5 rounded-md bg-accent-50 p-2.5 text-[13px] italic text-ink-700">
                <StickyNote size={14} className="mt-0.5 shrink-0" aria-hidden /> {order.delivery_notes}
              </p>
            )}
          </div>
        )}

        {/* GPS SHARING */}
        {!done && (
          <div className={`mb-3.5 rounded-xl border-2 p-4 ${sharing ? 'border-olive-300 bg-olive-50' : 'border-accent-300 bg-accent-50'}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-bold text-ink-900">
                  {sharing
                    ? <><Radio size={16} strokeWidth={2.2} aria-hidden /> Posizione condivisa</>
                    : <><MapPin size={16} strokeWidth={2.2} aria-hidden /> Condividi posizione</>}
                </p>
                <p className="text-[13px] text-ink-600">
                  {sharing ? 'Il cliente vede dove sei in tempo reale.' : 'Attiva il GPS per il cliente.'}
                </p>
              </div>
              {sharing ? (
                <button onClick={stopSharing} className="shrink-0 rounded-lg bg-secondary-600 px-4 py-2 font-semibold text-white hover:bg-secondary-700">
                  Disattiva
                </button>
              ) : (
                <button onClick={startSharing} className="shrink-0 rounded-lg bg-olive-600 px-4 py-2 font-semibold text-white hover:bg-olive-700">
                  Attiva GPS
                </button>
              )}
            </div>
          </div>
        )}

        {/* Riepilogo ordine */}
        <div className="mb-3.5 rounded-xl border border-cream-300 bg-surface-0 p-4">
          <div className="mb-1.5 flex justify-between text-sm">
            <span className="text-ink-500">Articoli</span>
            <span className="font-semibold text-ink-900">{order.order_items.length} prodotti</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-ink-500">Il tuo compenso</span>
            <span className="font-bold text-olive-700">{formatPrice(order.shipping_cost || 0)}</span>
          </div>
          {order.payment_method === 'cod' && (
            <div className="mt-2.5 flex items-center gap-2 rounded-md bg-accent-100 px-3 py-2.5">
              <Banknote size={18} className="text-accent-800" aria-hidden />
              <span className="text-[13px] text-accent-900">
                Incassa <strong>{formatPrice(order.total_price)}</strong> in contanti dal cliente.
              </span>
            </div>
          )}
        </div>

        {/* CASH ON DELIVERY: conferma incasso */}
        {order.payment_method === 'cod'
          && (order.delivery_status === 'PICKED_UP' || order.delivery_status === 'OUT_FOR_DELIVERY' || order.delivery_status === 'DELIVERED')
          && !order.cash_confirmed_at && (
            <div className="mb-3.5 space-y-3 rounded-xl border-2 border-accent-300 bg-accent-50 p-4">
              <div>
                <p className="flex items-center gap-1.5 font-bold text-accent-900"><Banknote size={16} strokeWidth={2.2} aria-hidden /> Conferma incasso</p>
                <p className="text-sm text-accent-800">
                  Conferma l&apos;importo ricevuto in contanti per chiudere l&apos;ordine. La foto è facoltativa.
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
          <div className="mb-3.5 flex items-center gap-1.5 rounded-xl border-2 border-olive-200 bg-olive-50 p-4 text-sm text-olive-900">
            <Check size={15} strokeWidth={2.5} className="shrink-0" aria-hidden /> Incasso confermato il {new Date(order.cash_confirmed_at).toLocaleString('it-IT')}.
          </div>
        )}

        {/* Stato completato — serif */}
        {done && (
          <div className="py-5 text-center">
            <span className="mb-3 inline-flex h-16 w-16 items-center justify-center rounded-full bg-olive-100">
              <Check size={32} strokeWidth={3} className="text-olive-700" aria-hidden />
            </span>
            <p className="font-serif text-[22px] font-extrabold text-ink-900">Consegna completata!</p>
            <p className="mt-1 text-sm text-ink-500">Hai guadagnato {formatPrice(order.shipping_cost || 0)}.</p>
          </div>
        )}

        {/* Rilascio ordine (solo all'inizio) */}
        {order.delivery_status === 'ASSIGNED' && (
          <button
            onClick={() => { if (confirm('Rilasciare questo ordine? Tornerà disponibile per altri rider.')) release.mutate(); }}
            disabled={release.isPending}
            className="mb-2 w-full rounded-xl border border-secondary-300 px-6 py-3 font-semibold text-secondary-700 hover:bg-secondary-50 disabled:opacity-50"
          >
            Non posso completarlo — rilascia ordine
          </button>
        )}

        {/* Dettaglio articoli */}
        <details className="mb-3.5 rounded-xl border border-cream-300 bg-surface-0 px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink-900">Articoli ({order.order_items.length})</summary>
          <div className="mt-2 divide-y divide-cream-100 text-sm">
            {order.order_items.map((it) => (
              <div key={it.id} className="flex justify-between py-2">
                <span>{it.products?.name ?? 'Prodotto'} <span className="text-ink-400">×{it.quantity}</span></span>
                <span className="text-ink-600">{formatPrice(Number(it.unit_price) * it.quantity)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between border-t border-cream-200 pt-2 text-sm font-bold">
            <span>{order.payment_method === 'card' ? 'Totale (già pagato online)' : 'Totale (da incassare)'}</span>
            <span className="text-primary-800">{formatPrice(order.total_price)}</span>
          </div>
        </details>
      </div>

      {/* FOOTER STICKY — azione primaria per stato */}
      {!done && (
        <div
          className="fixed bottom-0 left-1/2 z-sticky w-full max-w-[480px] -translate-x-1/2 border-t border-cream-200 bg-surface-0 px-4 py-3"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
        >
          {order.delivery_status === 'ASSIGNED' && (
            <Button onClick={() => setVerifyOpen('pickup')} variant="primary" size="lg" icon={PackageCheck} fullWidth>
              Conferma ritiro al negozio
            </Button>
          )}
          {order.delivery_status === 'PICKED_UP' && (
            <div className="flex flex-col gap-2">
              <Button
                onClick={() => transition.mutate({ newStatus: 'OUT_FOR_DELIVERY' })}
                loading={transition.isPending}
                variant="secondary"
                size="lg"
                icon={Bike}
                fullWidth
              >
                Sto andando dal cliente
              </Button>
              <Button onClick={() => setVerifyOpen('delivery')} variant="success" size="lg" icon={CircleCheck} fullWidth>
                Conferma consegna
              </Button>
            </div>
          )}
          {order.delivery_status === 'OUT_FOR_DELIVERY' && (
            <Button onClick={() => setVerifyOpen('delivery')} variant="success" size="lg" icon={CircleCheck} fullWidth>
              Conferma consegna al cliente
            </Button>
          )}
        </div>
      )}
      {done && (
        <div
          className="fixed bottom-0 left-1/2 z-sticky w-full max-w-[480px] -translate-x-1/2 border-t border-cream-200 bg-surface-0 px-4 py-3"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <Button href="/rider" variant="primary" size="lg" fullWidth>Torna alle consegne</Button>
        </div>
      )}

      {/* Dialog verifica */}
      <VerifyCodeDialog
        open={verifyOpen === 'pickup'}
        title="Codice ritiro"
        description="Chiedi al negoziante il codice a 6 cifre per confermare il ritiro."
        ctaLabel="Conferma ritiro"
        ctaColor="bg-primary-700 hover:bg-primary-800"
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
    </div>
  );
}
