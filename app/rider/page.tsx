'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Store, MapPin, Navigation, ArrowRight, Layers, Power, Package, ChefHat, Star, Banknote,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { type OrderStatus } from '@/lib/order-status';
import { OrderStatusBadge } from '@/components/ui/OrderStatusBadge';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { notify } from '@/lib/notifications';
import { LoadingState } from '@/components/ui/LoadingState';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { useProfile } from '@/components/hooks/useProfile';
import { trackRiderOrderAccepted } from '@/lib/analytics/events';

type AvailableOrder = {
  id: string;
  total_price: number;
  shipping_cost: number;
  delivery_status: OrderStatus;
  delivery_city: string | null;
  delivery_address: string | null;
  payment_method: string | null;
  user_id: string;
  seller: {
    store_name: string | null;
    store_logo: string | null;
    store_address: string | null;
  } | null;
  order_items: { id: string; quantity: number }[];
};

/** Riga negozio → cliente, replica del DeliveryRoute del design kit rider. */
function DeliveryRoute({ store, cust, small }: { store: string; cust: string; small?: boolean }) {
  return (
    <div className={`flex flex-col ${small ? 'gap-1.5' : 'gap-2'}`}>
      <div className="flex items-center gap-2.5">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700">
          <Store size={13} strokeWidth={2.2} aria-hidden />
        </span>
        <span className="text-sm font-semibold text-ink-900">{store}</span>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-olive-100 text-olive-700">
          <MapPin size={13} strokeWidth={2.2} aria-hidden />
        </span>
        <span className="text-[13px] text-ink-600">{cust}</span>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.03em] text-ink-700">{children}</p>
  );
}

export default function RiderDashboardPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { profile, userEmail } = useProfile();

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
          delivery_city, delivery_address, payment_method, user_id, rider_id,
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
  const activeOne  = myActive[0];

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
      trackRiderOrderAccepted(data.id);
      qc.invalidateQueries({ queryKey: queryKeys.rider.orders });
      toast.success('Ordine assegnato a te!');
      router.push(`/rider/orders/${data.id}`);
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  // Toggle online/offline: stesso update profilo della pagina Disponibilità.
  const toggleOnline = useMutation({
    mutationFn: async (next: boolean) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { error } = await supabase.from('profiles').update({ rider_is_online: next }).eq('id', user.id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      qc.invalidateQueries({ queryKey: queryKeys.rider.pref });
      toast.success(next ? 'Sei online! Ora ricevi le consegne disponibili.' : 'Sei offline.');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  if (isLoading) return <LoadingState />;

  const riderName = profile?.full_name || profile?.email || userEmail || 'Rider';
  const firstName = riderName.trim().split(/\s+/)[0];
  const initials =
    riderName.trim().split(/\s+/).map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase() || 'R';

  return (
    <div className="pb-5">
      {/* Header rider: avatar + saluto + rating */}
      <div className="flex items-center gap-3 px-5 pb-3.5 pt-4">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-sm font-bold text-white">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-ink-900">Ciao, {firstName}</p>
          {rating && rating.count > 0 ? (
            <Link href="/rider/reviews" className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-700">
              <Star size={12} className="text-accent-500" fill="currentColor" aria-hidden />
              {rating.avg.toFixed(1).replace('.', ',')} · {rating.count} {rating.count === 1 ? 'recensione' : 'recensioni'}
            </Link>
          ) : (
            <p className="text-xs text-ink-500">Pronto a consegnare</p>
          )}
        </div>
      </div>

      {/* Online toggle card — gradiente olive quando online, switch iOS */}
      <div className="px-4 pb-4">
        <div
          className={`flex items-center justify-between rounded-2xl px-5 py-[18px] ${
            online
              ? 'bg-gradient-to-br from-olive-600 to-olive-700 text-white shadow-warm'
              : 'border border-cream-300 bg-surface-0 text-ink-900'
          }`}
        >
          <div>
            <p className="font-serif text-[18px] font-extrabold">{online ? 'Sei online' : 'Sei offline'}</p>
            <p className={`mt-0.5 text-xs ${online ? 'text-white/85' : 'text-ink-500'}`}>
              {online ? 'Ricevi le consegne disponibili' : 'Vai online per iniziare'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={online}
            aria-label={online ? 'Vai offline' : 'Vai online'}
            disabled={toggleOnline.isPending}
            onClick={() => toggleOnline.mutate(!online)}
            className={`relative h-8 w-[58px] shrink-0 rounded-full transition-colors disabled:opacity-60 ${
              online ? 'bg-white/30' : 'bg-cream-300'
            }`}
          >
            <span
              className="absolute top-[3px] h-[26px] w-[26px] rounded-full bg-white shadow-sm transition-all"
              style={{ left: online ? '29px' : '3px' }}
            />
          </button>
        </div>
      </div>

      {/* Stat di oggi: 3-up */}
      <div className="mb-[18px] grid grid-cols-3 gap-2 px-4">
        {[
          ['Oggi', formatPrice(today?.earned ?? 0)],
          ['Consegne', String(today?.count ?? 0)],
          ['Rating', rating && rating.count > 0 ? rating.avg.toFixed(1).replace('.', ',') : '—'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-cream-300 bg-surface-0 px-3 py-2.5 text-center">
            <p className="font-serif text-[17px] font-extrabold text-ink-900">{value}</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.03em] text-ink-400">{label}</p>
          </div>
        ))}
      </div>

      {/* Consegna attiva (la tua) */}
      {activeOne && (
        <div className="mb-[18px] px-4">
          <SectionLabel>La tua consegna</SectionLabel>
          <Link
            href={`/rider/orders/${activeOne.id}`}
            className="block rounded-xl border-2 border-accent-400 bg-surface-0 p-4 shadow-warm transition-shadow hover:shadow-warm-lg"
          >
            <div className="mb-2.5 flex items-center justify-between">
              <OrderStatusBadge status={activeOne.delivery_status} size="sm" />
              <span className="font-mono text-[11px] text-ink-400">#{activeOne.id.slice(0, 6).toUpperCase()}</span>
            </div>
            <DeliveryRoute
              store={activeOne.seller?.store_name ?? 'Negozio'}
              cust={`${activeOne.delivery_address ?? ''}${activeOne.delivery_city ? ', ' + activeOne.delivery_city : ''}`}
            />
            <div className="mt-3 flex items-center justify-between border-t border-cream-200 pt-3">
              <span className="text-sm font-bold text-olive-700">{formatPrice(activeOne.shipping_cost || 4.9)}</span>
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-primary-700">
                Continua <ArrowRight size={16} aria-hidden />
              </span>
            </div>
          </Link>
        </div>
      )}

      {/* Ordini disponibili / offline empty state */}
      {online ? (
        <div className="px-4">
          {/* Giro intelligente: batch quando ci sono ≥2 ordini disponibili */}
          {available.length >= 2 && (() => {
            const batch = available.slice(0, 2);
            const sum = batch.reduce((t, o) => t + Number(o.shipping_cost || 4.9), 0);
            return (
              <div className="mb-3.5 rounded-xl border border-primary-300 bg-gradient-to-br from-primary-50 to-cream-50 p-3.5">
                <div className="mb-2 flex items-center gap-2">
                  <span className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-primary-600 text-white">
                    <Layers size={16} strokeWidth={2.2} aria-hidden />
                  </span>
                  <span className="text-sm font-extrabold text-ink-900">Giro intelligente · 2 consegne</span>
                  <span className="ml-auto rounded-full bg-surface-0 px-2 py-[3px] text-[11px] font-bold text-primary-700">
                    +15% efficienza
                  </span>
                </div>
                <p className="mb-2.5 text-[12.5px] leading-relaxed text-ink-600">
                  Due consegne pronte vicine tra loro. Accetta la prima e continua col giro per ottimizzare i km.
                </p>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs text-ink-500">
                    <Navigation size={13} className="text-ink-400" aria-hidden /> Stesso giro
                  </span>
                  <span className="text-base font-extrabold text-olive-700">{formatPrice(sum)}</span>
                </div>
              </div>
            );
          })()}

          <SectionLabel>Ordini disponibili ({available.length})</SectionLabel>
          {available.length === 0 ? (
            <div className="rounded-xl border border-cream-300 bg-surface-0 p-8 text-center text-sm text-ink-500">
              Nessun ordine pronto al momento. Riprova tra un po'.
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {available.map((o) => (
                <div key={o.id} className="rounded-xl border border-cream-300 bg-surface-0 p-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="new" icon={Package}>Pronto</Badge>
                      {o.payment_method === 'cod' && (
                        <Badge variant="cod" icon={Banknote}>Contanti</Badge>
                      )}
                    </div>
                    <span className="font-mono text-[11px] text-ink-400">#{o.id.slice(0, 6).toUpperCase()}</span>
                  </div>
                  <DeliveryRoute
                    store={o.seller?.store_name ?? 'Negozio'}
                    cust={`${o.delivery_address ?? ''}${o.delivery_city ? ', ' + o.delivery_city : ''}`}
                    small
                  />
                  <div className="mt-3 flex items-center justify-between">
                    <div>
                      <p className="text-[11px] text-ink-400">Compenso</p>
                      <p className="font-serif text-lg font-extrabold text-olive-700">{formatPrice(o.shipping_cost || 4.9)}</p>
                    </div>
                    <Button
                      variant="accent"
                      onClick={() => claim.mutate(o.id)}
                      loading={claim.isPending}
                    >
                      Accetta
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* In preparazione — visibili ma non claimabili */}
          {inPrep.length > 0 && (
            <div className="mt-[18px]">
              <SectionLabel>In preparazione · attendi</SectionLabel>
              <div className="flex flex-col gap-2.5">
                {inPrep.map((o) => (
                  <div key={o.id} className="rounded-xl border border-cream-300 bg-surface-0 p-3.5 opacity-75">
                    <div className="mb-2 flex items-center justify-between">
                      <Badge variant="local" icon={ChefHat}>In preparazione</Badge>
                      <span className="font-bold text-olive-700">{formatPrice(o.shipping_cost || 4.9)}</span>
                    </div>
                    <DeliveryRoute
                      store={o.seller?.store_name ?? 'Negozio'}
                      cust={`${o.delivery_address ?? ''}${o.delivery_city ? ', ' + o.delivery_city : ''}`}
                      small
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="px-4">
          <div className="rounded-xl border border-cream-300 bg-surface-0 px-5 py-8 text-center">
            <span className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-full bg-olive-50">
              <Power size={26} className="text-olive-600" aria-hidden />
            </span>
            <p className="font-bold text-ink-900">Sei offline</p>
            <p className="mt-1 text-[13px] text-ink-500">Vai online per vedere gli ordini disponibili nella tua zona.</p>
            <p className="mt-3 text-xs text-ink-500">
              Gestisci orari e zone nella pagina{' '}
              <Link href="/rider/availability" className="text-olive-700 underline">Turni</Link>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
