'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Package, Store, MapPin, RotateCcw } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import EmptyState from '@/components/EmptyState';
import ErrorState from '@/components/ErrorState';
import { Button } from '@/components/ui/Button';
import { addToCart, clearCart } from '@/lib/cart';
import { formatPrice, formatDate } from '@/lib/format';
import {
  type OrderStatus,
} from '@/lib/order-status';
import { OrderStatusBadge } from '@/components/ui/OrderStatusBadge';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';
import { trackOrderPlaced } from '@/lib/analytics/events';

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
  const qc = useQueryClient();
  useEffect(() => {
    if (searchParams.get('stripe') === 'success') {
      toast.success('Pagamento completato! Il tuo ordine è confermato.');
      // Il webhook Stripe può arrivare con un ritardo di qualche secondo: ri-fetcha
      // gli ordini dopo 2s e 5s per non mostrare "nessun ordine" al rientro (fix #22).
      const t1 = setTimeout(() => qc.invalidateQueries({ queryKey: queryKeys.orders.all }), 2000);
      const t2 = setTimeout(() => qc.invalidateQueries({ queryKey: queryKeys.orders.all }), 5000);
      // Funnel: emette `purchase` (GA4) + `order_placed` una sola volta per
      // sessione Stripe. session_id = transaction_id (dedup lato GA4); il valore
      // arriva dallo stash creato prima del redirect (mc_pending_purchase).
      const sessionId = searchParams.get('session_id') ?? '';
      const dedupKey = `mc_purchase_tracked_${sessionId}`;
      try {
        if (sessionId && !sessionStorage.getItem(dedupKey)) {
          const raw = sessionStorage.getItem('mc_pending_purchase');
          const p = raw ? (JSON.parse(raw) as { valueCents?: number; coupon?: string | null; sellerId?: string }) : null;
          if (p?.valueCents) {
            trackOrderPlaced(sessionId, p.valueCents, 'card', p.sellerId ?? 'multi', { coupon: p.coupon ?? undefined });
          }
          sessionStorage.setItem(dedupKey, '1');
          sessionStorage.removeItem('mc_pending_purchase');
        }
      } catch { /* noop */ }
      // Pulisce il param dall'URL senza ricaricare
      router.replace('/orders');
      return () => { clearTimeout(t1); clearTimeout(t2); };
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
  const { data: orders = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.orders.all,
    queryFn: fetchOrders,
  });

  // Riordino: riusa lo stesso modulo carrello (`@/lib/cart`) del dettaglio
  // ordine — stesso shape di addToCart, nessuna logica duplicata. Svuota il
  // carrello e reinserisce le righe dell'ordine, poi porta a /cart.
  const handleReorder = (order: Order) => {
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
    if (added === 0) {
      toast.error('Nessun prodotto di questo ordine è più disponibile.');
      return;
    }
    toast.success(`${added} ${added === 1 ? 'articolo aggiunto' : 'articoli aggiunti'} al carrello!`);
    router.push('/cart');
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
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={order.seller.store_logo} alt="" loading="lazy" className="w-full h-full object-cover" />
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
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" />
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
