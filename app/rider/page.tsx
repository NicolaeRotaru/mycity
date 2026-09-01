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
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { vistaDaQuery } from '@/lib/vista-query';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { useProfile } from '@/components/hooks/useProfile';
import { trackRiderOrderAccepted } from '@/lib/analytics/events';
import { compensoConsegnaEuro } from '@/lib/shipping';

/**
 * Un ordine libero come lo vede il fattorino PRIMA di accettarlo: negozio,
 * zona, importo, compenso. Nessun recapito — quelli arrivano dopo (#18, #32).
 */
type OrdineLibero = {
  id: string;
  seller_id: string;
  store_name: string | null;
  store_address: string | null;
  delivery_city: string | null;
  delivery_zip: string | null;
  delivery_status: OrderStatus;
  payment_method: string | null;
  total_price: number;
  shipping_cost: number;
  rider_fee_cents: number | null;
  delivery_slot: string | null;
  articoli: number;
  created_at: string;
};

type AvailableOrder = {
  id: string;
  total_price: number;
  shipping_cost: number;
  rider_fee_cents: number | null;
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
  /**
   * #18 e #32 — Due letture separate, e non e' un dettaglio tecnico.
   *
   * Prima era una sola: «gli ordini liberi della citta' PIU' i miei», e portava
   * indietro la riga intera — nome, indirizzo di casa e telefono di ogni
   * cliente in attesa. Per decidere se accettare una consegna quei dati non
   * servono: servono il negozio, la zona, l'importo e la fascia oraria. E dal
   * momento in cui il fattorino accetta, i recapiti gli arrivano eccome.
   *
   * Ora: la bacheca degli ordini liberi viene da una vista che i recapiti non
   * li ha proprio (`ordini_disponibili_rider`), e la riga intera si legge solo
   * sugli ordini che quel fattorino ha preso.
   */
  const letturaBacheca = useQuery({
    queryKey: queryKeys.rider.orders,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');

      const [bacheca, miei] = await Promise.all([
        supabase
          .from('ordini_disponibili_rider')
          .select('id, seller_id, store_name, store_address, delivery_city, delivery_zip, delivery_status, payment_method, total_price, shipping_cost, rider_fee_cents, delivery_slot, articoli, created_at')
          .order('created_at', { ascending: true }),
        supabase
          .from('orders')
          .select(`
            id, total_price, shipping_cost, rider_fee_cents, delivery_status,
            delivery_city, delivery_address, payment_method, user_id, rider_id,
            seller:profiles!orders_seller_id_fkey ( store_name, store_logo, store_address ),
            order_items ( id, quantity )
          `)
          .eq('rider_id', user.id)
          .order('created_at', { ascending: true }),
      ]);
      if (miei.error) throw miei.error;

      return {
        // La vista puo' non esistere ancora (migrazione 122 da applicare): in
        // quel caso la bacheca resta vuota e il fattorino vede solo i suoi
        // ordini, invece di vedere un errore.
        liberi: (bacheca.data ?? []) as unknown as OrdineLibero[],
        miei: (miei.data ?? []) as unknown as (AvailableOrder & { rider_id: string | null })[],
      };
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
        .select('shipping_cost, rider_fee_cents, delivered_at')
        .eq('rider_id', user.id)
        .eq('delivery_status', 'DELIVERED')
        .gte('delivered_at', start.toISOString());
      // 22/8/2026 — IL TOTALE DELLA GIORNATA SOMMAVA `shipping_cost`, cioe'
      // quanto ha pagato il CLIENTE per la spedizione: sopra i 30 euro e' zero.
      // Il fattorino chiudeva una giornata di consegne con un totale piu' basso
      // del dovuto, sul numero in base al quale decide se continuare a lavorare
      // con noi.
      const rows = (data ?? []) as { shipping_cost: number | null; rider_fee_cents: number | null }[];
      return { count: rows.length, earned: rows.reduce((s, o) => s + compensoConsegnaEuro(o), 0) };
    },
    staleTime: 30_000,
  });

  // Priorità per zona: gli ordini che cadono in una zona preferita vanno PRIMA
  // (la disponibilità promette "riceverai prima le consegne in queste zone").
  // #18 — La zona preferita si riconosce da citta' e CAP, non dall'indirizzo
  // di casa: quello arriva solo dopo aver accettato.
  const inPreferredZone = (o: { delivery_city: string | null; delivery_zip?: string | null; delivery_address?: string | null }) => {
    if (zones.length === 0) return false;
    const hay = `${o.delivery_zip ?? ''} ${o.delivery_city ?? ''} ${o.delivery_address ?? ''}`.toLowerCase();
    return zones.some((z) => hay.includes(z.toLowerCase()));
  };
  const byZone = <T extends { delivery_city: string | null; delivery_zip?: string | null }>(a: T, b: T) =>
    (inPreferredZone(b) ? 1 : 0) - (inPreferredZone(a) ? 1 : 0);

  /**
   * 27/8/2026 (R087) — «NESSUN ORDINE PRONTO» A CHI GLI ORDINI CE LI AVEVA.
   *
   * Qui prima c'era `datiRider?.miei ?? []`: con la lettura fallita quei due ripieghi
   * trasformavano un guasto di rete in due elenchi vuoti, e la pagina scriveva al fattorino
   * che non c'è lavoro. Lui è in strada, col telefono, e non ha modo di sapere che bastava
   * riprovare: chiude l'app, e le consegne restano ferme.
   *
   * Il verdetto adesso viene da `vistaDaQuery`, la stessa dell'area venditore: l'errore batte
   * tutto, e il ramo dell'errore sta PRIMA di qualunque cosa disegni un elenco vuoto.
   */
  const vistaBacheca = vistaDaQuery(letturaBacheca);
  const orders = letturaBacheca.data?.miei ?? [];
  const liberi = letturaBacheca.data?.liberi ?? [];

  // Gli ordini annullati (CANCELED) non sono consegne attive: restano visibili
  // solo a buyer (proprietario) e admin, non al rider.
  const myActive   = orders.filter((o) => o.rider_id && o.delivery_status !== 'DELIVERED' && o.delivery_status !== 'CANCELED');
  const available  = liberi.filter((o) => o.delivery_status === 'READY').sort(byZone);
  const inPrep     = liberi.filter((o) => o.delivery_status === 'ACCEPTED').sort(byZone);
  const activeOne  = myActive[0];

  const claim = useMutation({
    mutationFn: async (orderId: string) => {
      /*
       * La presa passa da `prendi_ordine` (migrazione 123), non piu' da un
       * UPDATE diretto.
       *
       * Perche': la 122 ha stretto la lettura di `orders` a «solo gli ordini
       * che sono miei», per togliere dalla bacheca nome, telefono e indirizzo
       * dei clienti. In PostgreSQL pero' anche il WHERE di un UPDATE passa
       * dalle policy di lettura: su un ordine libero `rider_id` e' vuoto, la
       * riga non si vede, e l'UPDATE aggiornava zero righe. Il fattorino
       * vedeva l'ordine sulla bacheca e si sentiva rispondere «gia' preso».
       *
       * La funzione gira coi permessi del proprietario, controlla da sola che
       * sia un fattorino approvato, e resta atomica: chi arriva secondo trova
       * l'ordine gia' assegnato.
       */
      const { data, error } = await supabase.rpc('prendi_ordine', { p_order_id: orderId });
      if (error) throw error;
      const esito = data as { ok: boolean; id?: string; motivo?: string } | null;
      if (!esito?.ok || !esito.id) {
        throw new Error(
          esito?.motivo === 'NON_FATTORINO'
            ? 'Il tuo profilo fattorino non è ancora approvato'
            : 'Ordine già preso da un altro rider',
        );
      }
      const data2 = { id: esito.id };

      // #44 — Qui c'era una chiamata a `notify()` dal browser. Non ha mai
      // funzionato: la tabella delle notifiche non ha nessuna regola che
      // permetta a una persona di scriverne una a un'altra, quindi il database
      // rifiutava e la funzione si mangiava l'errore. Sembrava fatto e non era
      // fatto. La notifica vera la scrive il trigger sul cambio di stato
      // dell'ordine (migrazione 086), lato server, dove i permessi ci sono.
      return data2;
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

  if (vistaBacheca.mostraScheletro) return <LoadingState />;
  if (vistaBacheca.mostraErrore) {
    return (
      <ErrorState
        title="Non riesco a leggere gli ordini"
        description="La lettura non è riuscita, quindi non so quali consegne ci sono. Non vuol dire che non ce ne siano: riprova fra un momento."
        onRetry={() => { void letturaBacheca.refetch(); }}
      />
    );
  }

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
              <span className="text-sm font-bold text-olive-700">{formatPrice(compensoConsegnaEuro(activeOne))}</span>
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
            const sum = batch.reduce((t, o) => t + compensoConsegnaEuro(o), 0);
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
                  {/* #18 — Zona e CAP, non l'indirizzo di casa: quello compare
                      appena l'ordine e' suo. */}
                  <DeliveryRoute
                    store={o.store_name ?? 'Negozio'}
                    cust={`${o.delivery_city ?? 'Piacenza'}${o.delivery_zip ? ' · ' + o.delivery_zip : ''}`}
                    small
                  />
                  <div className="mt-3 flex items-center justify-between">
                    <div>
                      <p className="text-[11px] text-ink-400">Compenso</p>
                      <p className="font-serif text-lg font-extrabold text-olive-700">{formatPrice(compensoConsegnaEuro(o))}</p>
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
                      <span className="font-bold text-olive-700">{formatPrice(compensoConsegnaEuro(o))}</span>
                    </div>
                    <DeliveryRoute
                      store={o.store_name ?? 'Negozio'}
                      cust={`${o.delivery_city ?? 'Piacenza'}${o.delivery_zip ? ' · ' + o.delivery_zip : ''}`}
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
