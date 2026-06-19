'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Store, Package, ChefHat, Clock, Play, Star } from 'lucide-react';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import {
  type OrderStatus,
} from '@/lib/order-status';
import { OrderStatusBadge } from '@/components/ui/OrderStatusBadge';
import { notify } from '@/lib/notifications';
import { LoadingState } from '@/components/ui/LoadingState';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';

type AvailableOrder = {
  id: string;
  total_price: number;
  shipping_cost: number;
  delivery_status: OrderStatus;
  delivery_city: string | null;
  delivery_address: string | null;
  user_id: string;
  seller: {
    store_name: string | null;
    store_logo: string | null;
    store_address: string | null;
  } | null;
  order_items: { id: string; quantity: number }[];
};

export default function RiderDashboardPage() {
  const qc = useQueryClient();
  const router = useRouter();

  // Ordini ACCEPTED/READY senza rider + i miei ordini attivi
  const { data: orders = [], isLoading } = useQuery({
    queryKey: queryKeys.rider.orders,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, total_price, shipping_cost, delivery_status,
          delivery_city, delivery_address, user_id, rider_id,
          seller:profiles!orders_seller_id_fkey ( store_name, store_logo, store_address ),
          order_items ( id, quantity )
        `)
        .or(`and(delivery_status.in.(ACCEPTED,READY),rider_id.is.null),rider_id.eq.${user.id}`)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as (AvailableOrder & { rider_id: string | null })[];
    },
    refetchInterval: 60_000,   // dashboard rider: 1 min è sufficiente
    refetchOnWindowFocus: true, // appena torna sulla tab fa refresh subito
    staleTime: 15_000,
  });

  // Preferenze del rider: online/offline e zone preferite (dalla pagina Disponibilità).
  const { data: pref } = useQuery({
    queryKey: queryKeys.rider.pref,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { online: false, zones: [] as string[] };
      const { data } = await supabase
        .from('profiles')
        .select('rider_is_online, rider_zones')
        .eq('id', user.id)
        .single();
      return { online: !!data?.rider_is_online, zones: (data?.rider_zones as string[] | null) ?? [] };
    },
    staleTime: 30_000,
  });
  const online = pref?.online ?? false;
  const zones = pref?.zones ?? [];

  // Rating del rider (media + conteggio) per il badge in testata.
  const { data: rating } = useQuery({
    queryKey: queryKeys.rider.ratingSummary,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { avg: 0, count: 0 };
      const { data } = await supabase.from('rider_reviews').select('rating').eq('rider_id', user.id);
      const rows = (data ?? []) as { rating: number }[];
      if (rows.length === 0) return { avg: 0, count: 0 };
      return { avg: rows.reduce((s, r) => s + Number(r.rating), 0) / rows.length, count: rows.length };
    },
    staleTime: 60_000,
  });

  // Statistiche di oggi: consegne completate + incasso del giorno.
  const { data: today } = useQuery({
    queryKey: queryKeys.rider.todayStats,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { count: 0, earned: 0 };
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { data } = await supabase
        .from('orders')
        .select('shipping_cost, delivered_at')
        .eq('rider_id', user.id)
        .eq('delivery_status', 'DELIVERED')
        .gte('delivered_at', start.toISOString());
      const rows = (data ?? []) as { shipping_cost: number | null }[];
      return { count: rows.length, earned: rows.reduce((s, o) => s + Number(o.shipping_cost || 0), 0) };
    },
    staleTime: 30_000,
  });

  // Priorità per zona: gli ordini che cadono in una zona preferita vanno PRIMA
  // (la disponibilità promette "riceverai prima le consegne in queste zone").
  const inPreferredZone = (o: { delivery_address: string | null; delivery_city: string | null }) => {
    if (zones.length === 0) return false;
    const hay = `${o.delivery_address ?? ''} ${o.delivery_city ?? ''}`.toLowerCase();
    return zones.some((z) => hay.includes(z.toLowerCase()));
  };
  const byZone = <T extends { delivery_address: string | null; delivery_city: string | null }>(a: T, b: T) =>
    (inPreferredZone(b) ? 1 : 0) - (inPreferredZone(a) ? 1 : 0);

  // Gli ordini annullati (CANCELED) non sono consegne attive: restano visibili
  // solo a buyer (proprietario) e admin, non al rider.
  const myActive   = orders.filter((o) => o.rider_id && o.delivery_status !== 'DELIVERED' && o.delivery_status !== 'CANCELED');
  const available  = orders.filter((o) => !o.rider_id && o.delivery_status === 'READY').sort(byZone);
  const inPrep     = orders.filter((o) => !o.rider_id && o.delivery_status === 'ACCEPTED').sort(byZone);

  const claim = useMutation({
    mutationFn: async (orderId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      // Atomic claim: solo se rider_id e' ancora NULL
      const { data, error } = await supabase
        .from('orders')
        .update({ rider_id: user.id, delivery_status: 'ASSIGNED' })
        .eq('id', orderId)
        .is('rider_id', null)
        .eq('delivery_status', 'READY')
        .select()
        .single();
      if (error) throw error;
      if (!data) throw new Error('Ordine già preso da un altro rider');

      // Notifiche buyer + seller
      notify({
        userId: data.user_id,
        title: 'Un rider ha preso il tuo ordine',
        body: `Sta andando al negozio per ritirarlo`,
        link: `/orders/${data.id}`,
      });
      notify({
        userId: data.seller_id,
        title: 'Rider in arrivo',
        body: `Un rider sta venendo a ritirare l'ordine #${data.id.slice(0, 6).toUpperCase()}`,
        link: `/seller/orders/${data.id}`,
      });
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.rider.orders });
      toast.success('Ordine assegnato a te!');
      router.push(`/rider/orders/${data.id}`);
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const goOnline = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { error } = await supabase.from('profiles').update({ rider_is_online: true }).eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.rider.pref });
      toast.success('Sei online! Ora ricevi le consegne disponibili.');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-ink-900">Dashboard rider</h1>
            <p className="text-sm text-ink-500">Prendi gli ordini pronti e portali ai clienti.</p>
          </div>
          {rating && rating.count > 0 && (
            <Link
              href="/rider/reviews"
              className="inline-flex items-center gap-1.5 rounded-full bg-accent-50 px-3 py-1.5 text-sm font-bold text-accent-800 ring-1 ring-accent-200 hover:bg-accent-100 transition-colors"
            >
              <Star size={15} strokeWidth={2.2} className="text-accent-500" fill="currentColor" aria-hidden />
              {rating.avg.toFixed(1)}
              <span className="font-normal text-accent-700">· {rating.count}</span>
            </Link>
          )}
        </div>
        {/* Mini-stat di oggi */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white border border-cream-300 rounded-xl px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-ink-500">Consegne oggi</p>
            <p className="text-2xl font-extrabold font-serif text-ink-900">{today?.count ?? 0}</p>
          </div>
          <div className="bg-white border border-cream-300 rounded-xl px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-ink-500">Guadagno oggi</p>
            <p className="text-2xl font-extrabold font-serif text-olive-600">{formatPrice(today?.earned ?? 0)}</p>
          </div>
        </div>
      </div>

      {/* MIEI ORDINI ATTIVI */}
      <section>
        <h2 className="font-bold text-ink-900 mb-3">Le tue consegne attive ({myActive.length})</h2>
        {myActive.length === 0 ? (
          <div className="bg-white border border-cream-300 rounded-xl p-8 text-center text-ink-500">
            Nessuna consegna in corso. Prendi un ordine qui sotto per iniziare.
          </div>
        ) : (
          <div className="space-y-2">
            {myActive.map((o) => {
              return (
                <Link
                  key={o.id}
                  href={`/rider/orders/${o.id}`}
                  className="block bg-white border-2 border-accent-300 rounded-xl px-5 py-4 hover:shadow-md transition-all"
                >
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <OrderStatusBadge status={o.delivery_status} size="sm" />
                        <span className="text-xs font-mono text-ink-400">#{o.id.slice(0, 6).toUpperCase()}</span>
                      </div>
                      <p className="font-semibold text-ink-900 flex items-center gap-1.5"><Store size={15} strokeWidth={2.2} className="shrink-0 text-ink-500" aria-hidden /> {o.seller?.store_name}</p>
                      <p className="text-sm text-ink-500 truncate">→ {o.delivery_address}, {o.delivery_city}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-ink-500">Compenso</p>
                      <p className="font-bold text-olive-600">{formatPrice(o.shipping_cost || 4.9)}</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {!online ? (
        <section className="bg-gradient-to-br from-olive-50 to-olive-100 border-2 border-olive-200 rounded-2xl p-8 text-center">
          <p className="text-xl font-extrabold font-serif text-ink-900 mb-1">Sei offline</p>
          <p className="text-sm text-ink-600 mb-4">Vai online per vedere e accettare le consegne disponibili.</p>
          <button
            onClick={() => goOnline.mutate()}
            disabled={goOnline.isPending}
            className="inline-flex items-center gap-2 bg-olive-500 hover:bg-olive-600 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-bold shadow"
          >
            <Play size={16} strokeWidth={2.2} aria-hidden /> Vai online
          </button>
          <p className="mt-3 text-xs text-ink-500">
            Gestisci orari e zone nella pagina <Link href="/rider/availability" className="text-olive-700 underline">Disponibilità</Link>.
          </p>
        </section>
      ) : (
       <>
      {/* ORDINI DISPONIBILI */}
      <section>
        <h2 className="font-bold text-ink-900 mb-3">Ordini disponibili ({available.length})</h2>
        {available.length === 0 ? (
          <div className="bg-white border border-cream-300 rounded-xl p-8 text-center text-ink-500">
            Nessun ordine pronto al momento. Riprova tra un po'.
          </div>
        ) : (
          <div className="space-y-2">
            {available.map((o) => (
              <div
                key={o.id}
                className="bg-white border border-cream-300 rounded-xl px-5 py-4 hover:shadow-md transition-all"
              >
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700 ring-1 ring-violet-200">
                        <Package size={12} strokeWidth={2.4} aria-hidden /> Pronto
                      </span>
                      <span className="text-xs font-mono text-ink-400">#{o.id.slice(0, 6).toUpperCase()}</span>
                    </div>
                    <p className="font-semibold text-ink-900 flex items-center gap-1.5"><Store size={15} strokeWidth={2.2} className="shrink-0 text-ink-500" aria-hidden /> {o.seller?.store_name}</p>
                    <p className="text-xs text-ink-500">{o.seller?.store_address}</p>
                    <p className="text-sm text-ink-700 mt-1">→ {o.delivery_address}, {o.delivery_city}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs text-ink-500">Compenso</p>
                      <p className="font-bold text-olive-600">{formatPrice(o.shipping_cost || 4.9)}</p>
                    </div>
                    <button
                      onClick={() => claim.mutate(o.id)}
                      disabled={claim.isPending}
                      className="bg-accent-500 hover:bg-accent-600 disabled:opacity-50 text-white px-5 py-3 rounded-lg font-semibold whitespace-nowrap"
                    >
                      Accetta
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ORDINI IN PREPARAZIONE — visibili ma non ancora claimabili */}
      {inPrep.length > 0 && (
        <section>
          <h2 className="font-bold text-ink-900 mb-3">
            In preparazione ({inPrep.length})
            <span className="ml-2 text-xs font-normal text-ink-500">aspetta che il negozio li renda pronti</span>
          </h2>
          <div className="space-y-2">
            {inPrep.map((o) => (
              <div
                key={o.id}
                className="bg-white border border-cream-300 rounded-xl px-5 py-4 opacity-80"
              >
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-800 ring-1 ring-primary-200">
                        <ChefHat size={12} strokeWidth={2.4} aria-hidden /> In preparazione
                      </span>
                      <span className="text-xs font-mono text-ink-400">#{o.id.slice(0, 6).toUpperCase()}</span>
                    </div>
                    <p className="font-semibold text-ink-900 flex items-center gap-1.5"><Store size={15} strokeWidth={2.2} className="shrink-0 text-ink-500" aria-hidden /> {o.seller?.store_name}</p>
                    <p className="text-xs text-ink-500">{o.seller?.store_address}</p>
                    <p className="text-sm text-ink-700 mt-1">→ {o.delivery_address}, {o.delivery_city}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs text-ink-500">Compenso</p>
                      <p className="font-bold text-olive-600">{formatPrice(o.shipping_cost || 4.9)}</p>
                    </div>
                    <button
                      disabled
                      className="inline-flex items-center gap-1.5 bg-cream-200 text-ink-400 px-5 py-3 rounded-lg font-semibold whitespace-nowrap cursor-not-allowed"
                    >
                      <Clock size={15} strokeWidth={2.2} aria-hidden /> Attendi
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      </>
      )}
    </div>
  );
}
