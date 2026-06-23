'use client';

import { useEffect, useState, use } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import DeliveryMap, { MapPoint } from '@/components/DeliveryMapLazy';
import SimpleQR from '@/components/SimpleQR';
import ConfettiBurst from '@/components/ConfettiBurst';
import { confirmDialog } from '@/components/ConfirmDialog';
import { formatPrice } from '@/lib/format';
import { addToCart, clearCart } from '@/lib/cart';
import { haversineKm, deliveryEtaMinutes } from '@/lib/geo';
import { toast } from 'sonner';
import {
  BUYER_TIMELINE,
  ORDER_STATUS_ICON,
  ORDER_STATUS_LABEL,
  isPastStatus,
  isActiveStatus,
  type OrderStatus,
} from '@/lib/order-status';
import { OrderStatusBadge } from '@/components/ui/OrderStatusBadge';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ContactSheet, type ContactTarget } from '@/components/orders/ContactSheet';
import { friendlyError } from '@/lib/errors';
import EmptyState from '@/components/EmptyState';
import {
  Package, CheckCircle2, Star, Repeat, Undo2, AlertTriangle, FileText,
  Clock, XCircle, Check, MapPin, Phone, Store, Bike, Trash2, Banknote,
  LifeBuoy, MessageCircle, ArrowLeft, ShoppingBag,
} from 'lucide-react';
import { queryKeys } from '@/lib/queries/keys';

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
  invoice_pdf_url: string | null;
  invoice_number: string | null;
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
      invoice_pdf_url, invoice_number,
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

// Timestamp del singolo step della timeline (se registrato).
const STEP_TIMESTAMP: Partial<Record<OrderStatus, keyof OrderRow>> = {
  ACCEPTED: 'accepted_at',
  READY: 'ready_at',
  PICKED_UP: 'picked_up_at',
  DELIVERED: 'delivered_at',
};

export default function BuyerOrderDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const { id } = params;
  const router = useRouter();
  const qc = useQueryClient();

  const { data: order, isLoading, refetch } = useQuery({
    queryKey: queryKeys.orders.detail(id),
    queryFn: () => fetchOrder(id),
  });

  // Behavioral Scientist: gratifica immediata sul primo "ordine fatto".
  // Sessionstorage flag impostato dal checkout → confetti burst una volta sola.
  const [showConfetti, setShowConfetti] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem('mc_just_ordered') === '1') {
      sessionStorage.removeItem('mc_just_ordered');
      setShowConfetti(true);
    }
  }, []);

  // Bottom-sheet di contatto (rider / negozio / assistenza).
  const [contact, setContact] = useState<ContactTarget | null>(null);

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

  // Tutti gli hook DEVONO stare prima degli early return (Rules of Hooks)
  const status = order?.delivery_status;
  const showDeliveryCode = status === 'PICKED_UP' || status === 'OUT_FOR_DELIVERY';

  const { data: deliveryCode } = useQuery({
    queryKey: queryKeys.orders.deliveryCode(id),
    enabled: showDeliveryCode,
    queryFn: async () => {
      const { data } = await supabase
        .from('order_delivery_codes')
        .select('code, verified_at')
        .eq('order_id', id)
        .maybeSingle();
      return data;
    },
  });

  const cancel = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('cancel_order', { p_order_id: id });
      if (error) throw error;
      const r = data as { ok: boolean; reason?: string };
      if (!r.ok) {
        if (r.reason === 'TOO_LATE') throw new Error('Il negozio ha già accettato l\'ordine, non puoi più annullarlo.');
        throw new Error('Impossibile annullare');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.orders.all });
      toast.success('Ordine annullato');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  if (isLoading) return <LoadingState />;
  if (!order || !status) return <div className="container mx-auto py-12 max-w-2xl"><EmptyState icon={Package} title="Ordine non trovato" description="L'ordine non esiste o non hai i permessi per vederlo." ctaLabel="Tutti gli ordini" ctaHref="/orders" /></div>;

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
  const isCancelled = status === 'CANCELED';
  const isCancellable = status === 'NEW';
  const riderPhase = order.rider_id && (status === 'PICKED_UP' || status === 'OUT_FOR_DELIVERY' || status === 'ASSIGNED');

  // ETA rider in minuti: DERIVATA dalla distanza rider→cliente (haversine su
  // rider_lat/lng → delivery_lat/lng) a velocità media urbana (~25 km/h, vedi
  // lib/geo.deliveryEtaMinutes con prep=0: il rider è già in viaggio). Mostrata
  // SOLO in OUT_FOR_DELIVERY e solo se entrambe le coppie di coordinate esistono;
  // altrimenti resta null e il chip "~N min" viene omesso (niente stime finte).
  const riderEtaMin: number | null =
    status === 'OUT_FOR_DELIVERY'
    && order.rider_lat != null && order.rider_lng != null
    && order.delivery_lat != null && order.delivery_lng != null
      ? Math.max(
          1,
          deliveryEtaMinutes(
            haversineKm(order.rider_lat, order.rider_lng, order.delivery_lat, order.delivery_lng),
            0,
          ),
        )
      : null;

  // Stato hero: serif heading + sottotitolo coerenti con lo stato corrente.
  const HeroIcon = isDelivered ? CheckCircle2 : ORDER_STATUS_ICON[status];
  const heroTitle = isDelivered
    ? 'Ordine consegnato!'
    : isCancelled
    ? 'Ordine annullato'
    : status === 'NEW'
    ? 'Ordine confermato!'
    : 'Ordine in corso';

  // Sottotitolo per-stato (frase, non solo la label del badge): comunica cosa
  // sta succedendo adesso. Nessuna data effettiva: lo schema non ha colonna ETA.
  const HERO_SUBTITLE: Partial<Record<OrderStatus, string>> = {
    NEW: 'Il negozio sta confermando il tuo ordine',
    ACCEPTED: 'Il negozio sta preparando il tuo ordine',
    READY: 'Pronto in negozio · un rider sta per ritirarlo',
    ASSIGNED: 'Un rider sta arrivando in negozio',
    PICKED_UP: 'Il rider ha ritirato il tuo ordine',
    OUT_FOR_DELIVERY: 'Il rider è in viaggio verso di te',
    DELIVERED: 'Consegnato — grazie!',
    CANCELED: 'Questo ordine è stato annullato',
  };
  const heroSub = HERO_SUBTITLE[status] ?? ORDER_STATUS_LABEL[status];

  // "Consegna stimata": in OUT_FOR_DELIVERY usiamo l'ETA DERIVATA (rider→cliente)
  // se disponibile ("~N min"); altrimenti una finestra relativa coerente col copy
  // del marketplace. Niente orari assoluti finti: solo derivazioni reali.
  const etaLabel = isDelivered
    ? 'Consegnato'
    : isCancelled
    ? '—'
    : status === 'OUT_FOR_DELIVERY'
    ? (riderEtaMin != null ? `~${riderEtaMin} min` : 'In arrivo a breve')
    : 'Oggi se disponibile · 24-48h';
  const etaCaption = isDelivered ? 'Stato consegna' : 'Consegna stimata';

  // Hint relativo "consegna stimata" da accepted_at/ready_at, quando sensato:
  // una volta accettato/pronto, una finestra indicativa relativa all'evento.
  // Derivato dai soli timestamp esistenti; omesso se mancano o stato terminale.
  const minutesSince = (iso: string | null): number | null =>
    iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : null;
  const prepHint: string | null = (() => {
    if (isDelivered || isCancelled) return null;
    if (status === 'OUT_FOR_DELIVERY' && riderEtaMin != null) return null; // già coperto dal chip ETA
    if (status === 'READY' || status === 'ASSIGNED' || status === 'PICKED_UP') {
      const m = minutesSince(order.ready_at);
      return m != null ? 'Pronto, in consegna a breve' : null;
    }
    if (status === 'ACCEPTED') {
      const m = minutesSince(order.accepted_at);
      return m != null ? 'In preparazione · pronto entro ~30 min' : null;
    }
    return null;
  })();

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

  const orderRef = `#${order.id.slice(0, 6).toUpperCase()}`;

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <ConfettiBurst trigger={showConfetti} />

      <Link href="/orders" className="inline-flex items-center gap-1.5 py-2 text-sm font-medium text-ink-600 hover:text-ink-900">
        <ArrowLeft size={17} strokeWidth={2.2} aria-hidden /> Tutti gli ordini
      </Link>

      {/* HERO STATUS */}
      <Card variant="elevated" padding="lg" className="mt-1">
        <div className="flex flex-wrap items-center gap-4">
          <span
            className={`flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full ${
              isDelivered ? 'bg-olive-100 text-olive-700'
              : isCancelled ? 'bg-rose-50 text-rose-600'
              : 'bg-primary-100 text-primary-700'
            }`}
          >
            <HeroIcon size={28} strokeWidth={2.2} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-serif text-[26px] font-bold text-ink-900">{heroTitle}</h1>
              <OrderStatusBadge status={status} size="sm" />
            </div>
            <p className="mt-1 text-sm text-ink-600">
              Ordine <strong>{orderRef}</strong> · {heroSub}
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs font-bold uppercase tracking-label text-ink-500">{etaCaption}</div>
            <div className="text-base font-bold text-ink-900">{etaLabel}</div>
            {prepHint && <div className="mt-0.5 text-xs text-ink-500">{prepHint}</div>}
          </div>
        </div>
      </Card>

      {/* CALLOUT consegnato: recensione / ripeti / reso / reclamo / fattura */}
      {isDelivered && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-olive-200 bg-olive-50 p-4">
          <p className="inline-flex items-center gap-1.5 text-sm font-medium text-olive-800">
            <CheckCircle2 size={16} strokeWidth={2.2} aria-hidden /> Ordine consegnato! Com&apos;è andata?
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/orders/${id}/review`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-accent-500"
            >
              <Star size={15} strokeWidth={2.2} aria-hidden /> Lascia recensione
            </Link>
            <Button onClick={handleReorder} size="sm">
              <span className="inline-flex items-center gap-1.5"><Repeat size={15} strokeWidth={2.2} aria-hidden /> Ripeti ordine</span>
            </Button>
            <Link
              href={`/orders/${id}/return`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cream-300 bg-white px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-cream-50"
            >
              <Undo2 size={15} strokeWidth={2.2} aria-hidden /> Richiedi reso
            </Link>
            <Link
              href={`/orders/${id}/dispute`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
            >
              <AlertTriangle size={15} strokeWidth={2.2} aria-hidden /> Apri reclamo
            </Link>
            {order.invoice_pdf_url && (
              <a
                href={order.invoice_pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-cream-300 bg-white px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-cream-50"
              >
                <FileText size={15} strokeWidth={2.2} aria-hidden /> Scarica fattura
              </a>
            )}
          </div>
        </div>
      )}

      {/* ANNULLAMENTO (solo NEW) */}
      {isCancellable && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-accent-200 bg-accent-50 p-4">
          <p className="flex items-start gap-1.5 text-sm text-accent-900">
            <Clock size={15} strokeWidth={2.2} className="mt-0.5 shrink-0" aria-hidden />
            <span><strong>In attesa di conferma del negozio.</strong> Puoi annullare l&apos;ordine finché il negozio non lo accetta.</span>
          </p>
          <button
            onClick={async () => {
              const ok = await confirmDialog({
                title: "Annullare l'ordine?",
                message: "Una volta annullato non potrai più recuperarlo. Il negozio verrà avvisato e i prodotti torneranno disponibili.",
                confirmLabel: 'Sì, annulla ordine',
                cancelLabel: 'No, mantieni',
                danger: true,
                icon: Trash2,
              });
              if (ok) cancel.mutate();
            }}
            disabled={cancel.isPending}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            <XCircle size={15} strokeWidth={2.2} aria-hidden /> Annulla ordine
          </button>
        </div>
      )}

      {isCancelled && (
        <div className="mt-4 flex items-center gap-1.5 rounded-xl border-2 border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <XCircle size={15} strokeWidth={2.2} aria-hidden /> Questo ordine è stato annullato.
        </div>
      )}

      {/* CODICE CONSEGNA (visibile quando rider sta arrivando) */}
      {showDeliveryCode && deliveryCode?.code && (
        <div className="mt-4 rounded-2xl bg-gradient-to-br from-olive-500 to-olive-600 p-6 text-white shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-olive-100">Codice consegna</p>
              <p className="my-2 font-mono text-4xl font-extrabold tracking-[0.3em] sm:text-5xl">
                {deliveryCode.code}
              </p>
              <p className="text-sm text-olive-100">
                {deliveryCode.verified_at ? (
                  <span className="inline-flex items-center gap-1.5"><Check size={14} strokeWidth={3} aria-hidden /> Consegna confermata.</span>
                ) : (
                  'Mostra questo codice (o il QR) al rider quando arriva. Senza questo codice, il rider non può chiudere la consegna.'
                )}
              </p>
            </div>
            <div className="shrink-0 rounded-lg bg-white p-2">
              <SimpleQR value={deliveryCode.code} size={120} />
            </div>
          </div>
        </div>
      )}

      {/* DUE COLONNE: timeline + side rail */}
      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[1.3fr_1fr]">
        {/* TIMELINE */}
        <Card variant="bordered" padding="lg">
          <h2 className="mb-4 font-serif text-lg font-bold text-ink-900">Stato dell&apos;ordine</h2>
          {isCancelled ? (
            <div className="text-sm text-rose-700">Questo ordine è stato annullato.</div>
          ) : (
            <ol className="relative">
              {BUYER_TIMELINE.map((step, i) => {
                const past = isPastStatus(status, step);
                const active = isActiveStatus(status, step);
                const isLast = i === BUYER_TIMELINE.length - 1;
                const StepIcon = ORDER_STATUS_ICON[step];
                const tsKey = STEP_TIMESTAMP[step];
                const ts = tsKey ? (order[tsKey] as string | null) : null;
                return (
                  <li key={step} className="flex gap-3.5">
                    {/* Connettore + nodo */}
                    <div className="flex flex-col items-center" aria-hidden>
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                          past
                            ? 'bg-olive-600 text-white'
                            : active
                            ? 'bg-primary-600 text-white ring-4 ring-primary-100'
                            : 'bg-cream-100 text-ink-300'
                        }`}
                      >
                        {past ? <Check size={16} strokeWidth={2.6} /> : <StepIcon size={16} strokeWidth={2.4} />}
                      </span>
                      {!isLast && (
                        <span className={`min-h-[26px] w-0.5 flex-1 ${past ? 'bg-olive-400' : 'bg-cream-300'}`} />
                      )}
                    </div>
                    {/* Testo: stato veicolato anche a parole (non solo via colore) */}
                    <div className="pb-5">
                      <p className={`text-[15px] ${active ? 'font-bold' : 'font-semibold'} ${past || active ? 'text-ink-900' : 'text-ink-400'}`}>
                        {ORDER_STATUS_LABEL[step]}
                      </p>
                      <p className="mt-0.5 text-[13px] text-ink-500">
                        {active ? (HERO_SUBTITLE[status] ?? 'In corso') : past ? 'Completato' : 'In attesa'}
                        {ts && ` · ${new Date(ts).toLocaleString('it-IT')}`}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        {/* SIDE RAIL */}
        <div className="flex flex-col gap-4">
          {/* RIDER CARD — mappa live + contatto rider via bottom-sheet */}
          {riderPhase && (
            <Card variant="elevated" padding="none" className="overflow-hidden">
              {points.length > 0 && (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cream-200 px-4 py-3">
                    <h2 className="inline-flex items-center gap-1.5 font-serif text-base font-bold text-ink-900">
                      <MapPin size={16} strokeWidth={2.2} aria-hidden /> Tracking in tempo reale
                    </h2>
                    {order.rider_position_updated_at && (status === 'PICKED_UP' || status === 'OUT_FOR_DELIVERY') ? (
                      <span className="text-xs text-olive-700">
                        ● agg. {new Date(order.rider_position_updated_at).toLocaleTimeString('it-IT')}
                      </span>
                    ) : status === 'ASSIGNED' ? (
                      <span className="text-xs text-primary-700">● in arrivo al negozio</span>
                    ) : null}
                  </div>
                  <DeliveryMap points={points} className="z-0 h-44 w-full" />
                </div>
              )}
              <div className="flex items-center gap-3 px-4 py-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-100 text-accent-600">
                  <Bike size={20} strokeWidth={2} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-bold text-ink-900">{order.rider?.full_name ?? 'Il tuo rider'}</p>
                    {/* Chip ETA "~N min": backend-gated (nessuna colonna eta a backend).
                        Lo slot esiste e viene popolato solo se l'ETA è ricavabile;
                        in assenza di un valore reale, viene omesso (niente orari finti). */}
                    {riderEtaMin != null && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-olive-100 px-2 py-0.5 text-[11px] font-bold text-olive-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-olive-600" /> ~{riderEtaMin} min
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-ink-500">
                    {status === 'OUT_FOR_DELIVERY' ? 'In viaggio verso di te'
                      : status === 'PICKED_UP' ? 'Ha ritirato l\'ordine'
                      : 'In arrivo al negozio'}
                  </p>
                </div>
                {order.seller?.store_phone && (
                  <button
                    type="button"
                    onClick={() => setContact({
                      kind: 'rider',
                      name: order.rider?.full_name ?? 'Il tuo rider',
                      sub: 'Rider della consegna',
                      phone: order.seller?.store_phone ?? null,
                      orderRef,
                    })}
                    aria-label="Contatta il rider"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-cream-300 bg-white text-primary-700 hover:bg-cream-50"
                  >
                    <Phone size={17} strokeWidth={2.2} aria-hidden />
                  </button>
                )}
              </div>
            </Card>
          )}

          {/* RIEPILOGO + COD callout */}
          <Card variant="bordered" padding="lg">
            <h2 className="mb-3 font-serif text-lg font-bold text-ink-900">Riepilogo</h2>
            <div className="divide-y divide-cream-200">
              {order.order_items.map((it) => {
                const img = it.products?.images?.[0];
                return (
                  <div key={it.id} className="flex items-center gap-2.5 py-2">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-cream-100">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        (<img src={img} alt="" loading="lazy" className="h-full w-full object-cover" />)
                      ) : <Package size={18} className="text-ink-400" aria-hidden />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-ink-900">{it.products?.name ?? 'Prodotto'}</p>
                      <p className="text-xs text-ink-500">× {it.quantity}</p>
                    </div>
                    <span className="text-[13px] font-bold text-ink-900">{formatPrice(Number(it.unit_price) * it.quantity)}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 space-y-1 border-t border-cream-200 pt-3 text-sm">
              <div className="flex justify-between"><span className="text-ink-600">Subtotale</span><span>{formatPrice(subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-ink-600">Spedizione</span><span>{order.shipping_cost > 0 ? formatPrice(order.shipping_cost) : 'GRATUITA'}</span></div>
              <div className="flex justify-between border-t border-cream-300 pt-1 text-base font-bold"><span>Totale</span><span className="text-primary-800">{formatPrice(order.total_price)}</span></div>
            </div>
            {/* COD callout — paga alla consegna in contanti */}
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-olive-50 px-3 py-2.5 text-[13px] font-medium text-olive-800">
              <Banknote size={16} strokeWidth={2.2} className="shrink-0 text-olive-700" aria-hidden />
              Paghi {formatPrice(order.total_price)} in contanti al rider alla consegna.
            </div>
          </Card>

          {/* NEGOZIO + INDIRIZZO */}
          <Card variant="bordered" padding="md">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-cream-100">
                {order.seller?.store_logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  (<img src={order.seller.store_logo} alt="" loading="lazy" className="h-full w-full object-cover" />)
                ) : <Store size={18} className="text-ink-400" aria-hidden />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink-900">{order.seller?.store_name ?? '—'}</p>
                <p className="text-xs text-ink-500">Venditore</p>
              </div>
            </div>
            <div className="mt-2.5 flex items-start gap-2 text-[13px] text-ink-600">
              <MapPin size={15} strokeWidth={2.2} className="mt-0.5 shrink-0 text-primary-600" aria-hidden />
              <span>
                {order.delivery_full_name && <span className="font-medium text-ink-800">{order.delivery_full_name}<br /></span>}
                {order.delivery_address}, {order.delivery_zip} {order.delivery_city}
                {order.delivery_notes && <span className="mt-1 block italic text-ink-500">Note: {order.delivery_notes}</span>}
              </span>
            </div>
          </Card>

          {/* AZIONI */}
          <div className="flex flex-col gap-2.5">
            {isDelivered && (
              <Button variant="primary" size="lg" fullWidth icon={Repeat} onClick={handleReorder}>
                Ordina di nuovo
              </Button>
            )}
            <Button variant="secondary" fullWidth icon={ShoppingBag} href="/">
              Continua lo shopping
            </Button>
            <div className="flex gap-2.5">
              {order.seller?.store_phone && (
                <Button
                  variant="ghost"
                  fullWidth
                  icon={MessageCircle}
                  onClick={() => setContact({
                    kind: 'store',
                    name: order.seller?.store_name ?? 'Il negozio',
                    sub: 'Venditore',
                    phone: order.seller?.store_phone ?? null,
                    orderRef,
                  })}
                >
                  Contatta il negozio
                </Button>
              )}
              <Button variant="ghost" fullWidth icon={LifeBuoy} href="/faq">
                Serve aiuto?
              </Button>
            </div>
          </div>
        </div>
      </div>

      {contact && <ContactSheet target={contact} onClose={() => setContact(null)} />}
    </div>
  );
}
