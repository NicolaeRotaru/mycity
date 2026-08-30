'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { riordina } from '@/lib/riordino';
import { Package, Store, MapPin, RotateCcw } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import Image from 'next/image';
import caricatoreFotoRemote from '@/lib/image-loader';
import EmptyState from '@/components/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { clearCart } from '@/lib/cart';
import { chiudiChiaveDelCheckout } from '@/lib/analytics/chiave-checkout';
import { formatPrice, formatDate } from '@/lib/format';
import {
  type OrderStatus,
} from '@/lib/order-status';
import { OrderStatusBadge } from '@/components/ui/OrderStatusBadge';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';
import { trackOrderPlaced } from '@/lib/analytics/events';
// #92 — le miniature si chiedono gia' piccole al server
import { sizedImage } from '@/lib/image-url';

type OrderItem = {
  id: string;
  quantity: number;
  unit_price: number;
  product_id: string | null;
  products: { name: string; images: string[] | null } | null;
};

type Order = {
  id: string;
  total_price: number;
  payment_status: 'PAID' | 'FAILED' | 'PENDING' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
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
        id, quantity, unit_price, product_id,
        products ( name, images )
      )
    `)
    .eq('user_id', user.id)
    // #90 — Un tetto esplicito. Queste pagine leggevano la tabella intera:
    // finche' gli ordini sono cento non si nota, il giorno che sono
    // diecimila la pagina non si apre piu' — cioe' proprio quando serve.
    // Il tetto e' dichiarato qui e mostrato a chi guarda, invece di essere
    // il limite implicito di mille righe di PostgREST, che taglia in
    // silenzio e fa sembrare veri dei numeri che non lo sono.
    .order('created_at', { ascending: false })
      .limit(100);

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
  const qc = useQueryClient();
  useEffect(() => {
    if (searchParams.get('stripe') === 'success') {
      toast.success('Pagamento completato! Il tuo ordine è confermato.');
      // Il carrello si svuota anche sul percorso con la carta. Prima lo faceva
      // solo il contrassegno: chi pagava con la carta tornava e ritrovava tutto
      // dentro, con lo stesso ordine pronto a essere rifatto per sbaglio.
      clearCart();
      // R163 — e con lui la chiave del checkout: la spesa dopo e' un altro
      // checkout, e deve avere un identificativo suo nei conti.
      chiudiChiaveDelCheckout(typeof window === 'undefined' ? null : window.sessionStorage);
      // #116 — Il webhook Stripe crea l'ordine, e puo' metterci qualche
      // secondo. Prima si riprovava due volte (2 s e 5 s) e poi ci si arrendeva:
      // chi rientrava su una rete lenta, o quando Stripe rallentava, leggeva
      // «Non hai ancora ordini» subito dopo aver pagato. Da li' la reazione e'
      // sempre la stessa: si ripaga, o si chiama la banca.
      //
      // Ora si riprova a distanze crescenti fino a circa mezzo minuto, e finche'
      // dura NON si mostra mai lo stato vuoto (vedi `stripeInCorso` sotto).
      const attese = [1000, 2000, 4000, 8000, 15000];
      const timers = attese.map((ms) =>
        setTimeout(() => qc.invalidateQueries({ queryKey: queryKeys.orders.all }), ms),
      );
      // Funnel: `purchase` (GA4) + `order_placed`, uno per ordine creato.
      //
      // #210 — L'importo non arriva piu' dallo stash del browser (era la stima
      // fatta PRIMA di pagare) ma da `orders.total_price`, cioe' la riga che il
      // webhook Stripe ha scritto dopo l'incasso: l'unico numero autorevole.
      //
      // #213 — Un carrello con due negozi crea due ordini: ora sono due eventi
      // col negozio vero, non uno solo col venditore chiamato «multi».
      //
      // #209 (in parte) — Il segno «gia' contato» si scriveva PRIMA che la
      // lettura degli ordini finisse: se la pagina si ricaricava in quel mezzo
      // secondo l'acquisto risultava tracciato senza esserlo mai stato. Ora si
      // scrive dopo, e solo se qualcosa e' stato davvero emesso.
      const sessionId = searchParams.get('session_id') ?? '';
      const dedupKey = `mc_purchase_tracked_${sessionId}`;
      try {
        if (sessionId && !sessionStorage.getItem(dedupKey)) {
          const raw = sessionStorage.getItem('mc_pending_purchase');
          const stash = raw ? (JSON.parse(raw) as { coupon?: string | null }) : null;
          void Promise.resolve(
            supabase
              .from('orders')
              .select('id, total_price, seller_id')
              .eq('stripe_session_id', sessionId),
          )
            .then(({ data }) => {
              const righe = (data ?? []) as Array<{ id: string; total_price: number | string; seller_id: string }>;
              if (righe.length === 0) return;
              const carrelloId = righe[0].id;
              for (const o of righe) {
                trackOrderPlaced(o.id, Math.round(Number(o.total_price ?? 0) * 100), 'card', o.seller_id, {
                  coupon: stash?.coupon ?? undefined,
                  checkoutId: carrelloId,
                });
              }
              try {
                sessionStorage.setItem(dedupKey, '1');
                sessionStorage.removeItem('mc_pending_purchase');
              } catch { /* noop */ }
            })
            .catch(() => { /* niente evento: meglio mancante che sbagliato */ });
        }
      } catch { /* noop */ }
      // #116 — L'indirizzo si ripulisce DOPO l'ultima riprova: prima veniva
      // tolto subito, quindi la pagina non sapeva piu' di essere appena tornata
      // da un pagamento e mostrava lo stato vuoto.
      const pulizia = setTimeout(() => router.replace('/orders'), 30_000);
      return () => { timers.forEach(clearTimeout); clearTimeout(pulizia); };
    }
  }, [searchParams, router, qc]);
  return null;
}

// Stati "in corso" per cui ha senso il tracking live (coerente col copy del
// dettaglio ordine): ordine non ancora consegnato né annullato.
const TRACKABLE: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'NEW', 'ACCEPTED', 'READY', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY',
]);

export default function OrdersPage() {
  const router = useRouter();
  /**
   * #116 — Siamo appena tornati dal pagamento con carta?
   *
   * Si legge dall'indirizzo senza `useSearchParams`, che obbligherebbe a
   * mettere in Suspense tutta la pagina. Vale per una finestra di trenta
   * secondi: dentro quella finestra lo stato «non hai ancora ordini» non si
   * mostra, perche' sarebbe falso e spingerebbe a pagare due volte.
   */
  const [stripeInCorso, setStripeInCorso] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('stripe') !== 'success') return;
    setStripeInCorso(true);
    const t = setTimeout(() => setStripeInCorso(false), 30_000);
    return () => clearTimeout(t);
  }, []);
  const { data: orders = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.orders.all,
    queryFn: fetchOrders,
  });

  // Riordino: riusa lo stesso modulo carrello (`@/lib/cart`) del dettaglio
  // ordine — stesso shape di addToCart, nessuna logica duplicata. Svuota il
  // carrello e reinserisce le righe dell'ordine, poi porta a /cart.
  // #113 — Stessa funzione del dettaglio ordine e della striscia in home:
  // chiede prima di svuotare, e rilegge i prezzi di adesso.
  const handleReorder = async (order: Order) => {
    const aggiunti = await riordina(
      order.order_items.map((it) => ({
        productId: it.product_id ?? '',
        name: it.products?.name ?? '',
        prezzoStorico: Number(it.unit_price),
        image: it.products?.images?.[0],
        quantity: it.quantity,
        sellerId: order.seller_id ?? undefined,
        storeName: order.seller?.store_name ?? undefined,
      })),
    );
    if (aggiunti > 0) router.push('/cart');
  };

  if (isLoading) {
    return <LoadingState />;
  }

  // Distinguo "non autenticato" (→ accedi) da un errore di caricamento reale,
  // invece di mostrare il fuorviante "Non hai ancora ordini".
  if (isError) {
    const isAuth = error instanceof Error && error.message === 'Non autenticato';
    return (
      <div className="py-8">
        {isAuth ? (
          <EmptyState
            icon={Package}
            title="Accedi per vedere i tuoi ordini"
            description="Entra nel tuo account per ritrovare ordini e tracking."
            ctaLabel="Accedi"
            ctaHref="/sign-in?returnTo=/orders"
          />
        ) : (
          <ErrorState
            title="Impossibile caricare gli ordini"
            onRetry={() => refetch()}
          />
        )}
      </div>
    );
  }

  if (orders.length === 0 && stripeInCorso) {
    // #116 — La regola, una sola: dentro la finestra del pagamento non si
    // mostra MAI lo stato vuoto. Chi ha appena pagato non deve leggere «non hai
    // ordini»: deve leggere che stiamo confermando.
    return (
      <div className="py-8">
        <Suspense fallback={null}><StripeReturnHandler /></Suspense>
        <div className="mx-auto max-w-md rounded-2xl border border-cream-300 bg-white p-8 text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-cream-300 border-t-primary-700" aria-hidden />
          <h1 className="font-serif text-xl font-bold text-ink-900">Stiamo confermando il pagamento</h1>
          <p className="mt-2 text-sm text-ink-600">
            Ci vogliono pochi secondi. Non ricaricare la pagina e non pagare di nuovo:
            il tuo ordine comparirà qui appena la banca conferma.
          </p>
        </div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="py-8">
        <Suspense fallback={null}><StripeReturnHandler /></Suspense>
        <EmptyState
          icon={Package}
          title="Non hai ancora ordini"
          description="Quando ordini qualcosa, lo vedrai qui con il tracking in tempo reale."
          ctaLabel="Inizia a esplorare"
          ctaHref="/search"
          secondaryLabel="€5 di benvenuto"
          secondaryHref="/profile/loyalty"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Suspense fallback={null}><StripeReturnHandler /></Suspense>
      <header className="mb-6">
        <p className="text-xs font-bold uppercase tracking-[0.05em] text-primary-700">Attività</p>
        <h1 className="mt-0.5 font-serif text-3xl font-extrabold leading-tight text-ink-900 sm:text-[32px]">
          I tuoi ordini
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          {orders.length === 1 ? '1 ordine' : `${orders.length} ordini`}
        </p>
      </header>

      {orders.map((order) => {
        const status = order.delivery_status;
        const itemCount = order.order_items.reduce((s, i) => s + i.quantity, 0);
        const trackable = TRACKABLE.has(status);
        // Massimo 4 thumbnail; le righe rimanenti diventano un chip "+N".
        const thumbs = order.order_items.slice(0, 4);
        const extra = order.order_items.length - thumbs.length;

        return (
          <div
            key={order.id}
            className="bg-white border border-cream-300 rounded-xl hover:shadow-md hover:border-primary-200 transition-all overflow-hidden"
          >
            {/* HEADER (link al dettaglio): negozio + data + stato */}
            <Link
              href={`/orders/${order.id}`}
              className="px-5 pt-4 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-center gap-4 min-w-0 flex-1">
                <div className="w-12 h-12 rounded-full bg-cream-100 shrink-0 overflow-hidden flex items-center justify-center text-xl">
                  {order.seller?.store_logo ? (
                    <Image src={sizedImage(order.seller.store_logo, 'thumb')} alt="" width={40} height={40} loader={caricatoreFotoRemote} className="w-full h-full object-cover" />
                  ) : <Store size={20} className="text-ink-400" aria-hidden />}
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
              <OrderStatusBadge status={status} size="sm" />
            </Link>

            {/* FOOTER: striscia thumbnail + totale + azioni */}
            <div className="px-5 pb-4 flex flex-wrap items-center gap-3 border-t border-cream-100 pt-3">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="flex gap-1.5">
                  {thumbs.map((it) => {
                    const img = it.products?.images?.[0];
                    return (
                      <div
                        key={it.id}
                        className="relative shrink-0"
                        title={`${it.products?.name ?? 'Prodotto'} ×${it.quantity}`}
                      >
                        <div className="h-12 w-12 overflow-hidden rounded-lg bg-cream-100 flex items-center justify-center">
                          {img ? (
                            <Image src={sizedImage(img, 'thumb')} alt="" width={48} height={48} loader={caricatoreFotoRemote} className="h-full w-full object-cover" />
                          ) : <Package size={18} className="text-ink-400" aria-hidden />}
                        </div>
                        <span className="absolute -top-1.5 -right-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ink-900 px-1 text-[10px] font-bold text-white">
                          {it.quantity}
                        </span>
                      </div>
                    );
                  })}
                  {extra > 0 && (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-cream-100 text-xs font-bold text-ink-500">
                      +{extra}
                    </div>
                  )}
                </div>
                <span className="ml-1 text-lg font-extrabold text-ink-900">
                  {formatPrice(order.total_price)}
                </span>
              </div>

              <div className="flex shrink-0 gap-2">
                {trackable && (
                  <Button variant="secondary" size="sm" icon={MapPin} href={`/orders/${order.id}`}>
                    Traccia
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  icon={RotateCcw}
                  onClick={() => handleReorder(order)}
                >
                  Riordina
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
