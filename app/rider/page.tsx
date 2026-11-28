'use client';

import { useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Store, MapPin, ArrowRight, Power, Package, ChefHat, Star, Banknote,
  AlertTriangle, RotateCcw, Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDate, formatPrice, formatPriceFromCents } from '@/lib/format';
import { type OrderStatus } from '@/lib/order-status';
import { OrderStatusBadge } from '@/components/ui/OrderStatusBadge';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { vistaDaQuery } from '@/lib/vista-query';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { conNegozioSePossibile } from '@/lib/queries/negozio-dell-ordine';
import { useProfile } from '@/components/hooks/useProfile';
import { trackRiderOrderAccepted } from '@/lib/analytics/events';
import { compensoConsegnaEuro } from '@/lib/shipping';
import { fasciaLeggibile } from '@/lib/ordini/fascia-leggibile';
import CashConfirmDialog from '@/components/rider/CashConfirmDialog';
import {
  CHIAVE_INCASSI_DA_DICHIARARE,
  INDIRIZZO_INCASSI_DA_DICHIARARE,
  riquadroDegliIncassi,
} from '@/lib/rider/incasso-alla-consegna';
import type { IncassoDaDichiarare } from '@/lib/rider/leggi-incassi-da-dichiarare';

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
  delivery_slot?: string | null;
  created_at?: string | null;
  seller: {
    store_name: string | null;
    store_logo: string | null;
    store_address: string | null;
  } | null;
  order_items: { id: string; quantity: number }[];
};

/** La fascia scelta dal cliente, nel giorno vero: senza, il fattorino non sa quando passare. */
function RigaFascia({ ordine }: { ordine: { delivery_slot?: string | null; created_at?: string | null } }) {
  const fascia = fasciaLeggibile(ordine);
  if (!fascia) return null;
  return (
    <p className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink-800">
      <Clock size={14} aria-hidden className="shrink-0 text-primary-600" /> Consegna: {fascia}
    </p>
  );
}

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

/** Il riquadro «Sei online / Sei offline»: offline è una card, online è un fondo pieno a gradiente (non una card). */
function RiquadroOnline({ online, children }: { online: boolean; children: React.ReactNode }) {
  const classi = 'flex items-center justify-between px-5 py-[18px]';
  if (online) {
    return <div className={cn(classi, 'rounded-2xl bg-gradient-to-br from-olive-600 to-olive-700 text-white shadow-warm')}>{children}</div>;
  }
  return <Card variant="surface" radius="2xl" padding="none" className={cn(classi, 'text-ink-900')}>{children}</Card>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.03em] text-ink-700">{children}</p>
  );
}

/** 5/11/2026 — Le consegne del fattorino ancora aperte: tutto tranne consegnato e annullato. */
const STATI_DELLE_MIE_CONSEGNE_APERTE = ['NEW', 'ACCEPTED', 'READY', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'];

/**
 * R04-007 — La presa è persa perché l'ordine non si può più prendere: l'ha preso un altro
 * fattorino (GIA_PRESO) o non è più pronto (NON_PIU_DISPONIBILE, migrazione 661). Non è solo un
 * messaggio: quell'ordine in bacheca è un dato vecchio, e si toglie.
 */
class OrdineNonPiuPrendibile extends Error {}

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
  // R03-005 — Quante letture di fila sono tornate senza i negozi: decide l'attesa prima della prossima.
  const lettureSenzaNegozi = useRef(0);
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
            delivery_city, delivery_address, payment_method, user_id, rider_id, seller_id,
            delivery_slot, created_at,
            order_items ( id, quantity )
          `)
          .eq('rider_id', user.id)
          // 5/11/2026 — Solo le consegne ancora aperte: la bacheca rileggeva ogni minuto tutta la
          // storia del fattorino (2.000 consegne per mostrarne una). La storia sta nella sua pagina.
          .in('delivery_status', STATI_DELLE_MIE_CONSEGNE_APERTE)
          .order('created_at', { ascending: true }),
      ]);
      if (miei.error) throw miei.error;
      // 18/10/2026 — Il negozio delle consegne prese arriva dalla vetrina pubblica,
      // non da `profiles` (lib/queries/negozio-dell-ordine.ts): regge anche quando
      // `profiles` si chiude.
      let negoziNonLetti = false;
      const mieiColNegozio = await conNegozioSePossibile(
        supabase,
        (miei.data ?? []) as unknown as Array<Omit<AvailableOrder, 'seller'> & { seller_id: string | null; rider_id: string | null }>,
        'id, store_name, store_logo, store_address',
        () => { negoziNonLetti = true; },
      );
      lettureSenzaNegozi.current = negoziNonLetti ? lettureSenzaNegozi.current + 1 : 0;

      return {
        // 5/11/2026 — La vista esiste in produzione da tempo (migrazione 122): una lettura caduta
        // non è «nessun ordine pronto». Si segna come lettura parziale e la bacheca lo dice, tenendo
        // visibili le consegne del fattorino.
        liberi: (bacheca.data ?? []) as unknown as OrdineLibero[],
        bachecaGuasta: !!bacheca.error,
        miei: mieiColNegozio as (AvailableOrder & { rider_id: string | null })[],
        negoziNonLetti,
      };
    },
    // dashboard rider: 1 min è sufficiente. R20-007 — Ma se la vista dei negozi è caduta la lettura
    // è parziale (consegne senza il nome del negozio): si riprova dopo pochi secondi.
    // R03-005 — Non ogni 5 secondi per sempre: con la vista giù a lungo l'attesa raddoppia a ogni
    // lettura parziale (5, 10, 20, 40 s) fino al minuto normale, e torna da capo quando risponde.
    refetchInterval: (q) =>
      q.state.data?.negoziNonLetti
        ? Math.min(5_000 * 2 ** Math.max(lettureSenzaNegozi.current - 1, 0), 60_000)
        : 60_000,
    refetchOnWindowFocus: true, // appena torna sulla tab fa refresh subito
    staleTime: 15_000,
  });

  // Preferenze del rider: online/offline e zone preferite (dalla pagina Disponibilità).
  // Una lettura caduta (anche getUser() senza rete) non è «sei offline»: l'errore sale, e senza
  // un dato già letto la scheda dice che non lo sa, con «Riprova».
  const letturaPref = useQuery({
    queryKey: queryKeys.rider.pref,
    queryFn: async () => {
      const { data: { user }, error: erroreUtente } = await supabase.auth.getUser();
      if (!user) throw erroreUtente ?? new Error('Non autenticato');
      const { data, error } = await supabase
        .from('profiles')
        .select('rider_is_online, rider_zones')
        .eq('id', user.id)
        .single();
      if (error) throw error;
      return { online: !!data?.rider_is_online, zones: (data?.rider_zones as string[] | null) ?? [] };
    },
    staleTime: 30_000,
  });
  const pref = letturaPref.data;
  /**
   * R04-011 — Una lettura senza dato è CADUTA anche prima che `isError` si accenda: durante
   * l'attesa del nuovo tentativo (il QueryProvider rifà una volta, dopo un secondo) e quando senza
   * rete la lettura resta in pausa. In quei momenti la scheda scriveva «Sei offline».
   */
  const letturaCaduta = (q: { isError: boolean; failureCount: number; fetchStatus: string }) =>
    q.isError || q.failureCount > 0 || q.fetchStatus === 'paused';
  // R04-011 — Tre valori, non due: senza un dato letto lo stato non è «offline», è «non so».
  const statoOnline: 'online' | 'offline' | 'non-so' = pref ? (pref.online ? 'online' : 'offline') : 'non-so';
  const statoOnlineIgnoto = statoOnline === 'non-so' && letturaCaduta(letturaPref);
  const online = statoOnline === 'online';
  const zones = pref?.zones ?? [];

  // Rating del rider (media + conteggio) per il badge in testata.
  // Una lettura caduta non è «nessuna recensione»: l'errore sale e la testata lo dice.
  const letturaVoto = useQuery({
    queryKey: queryKeys.rider.ratingSummary,
    queryFn: async () => {
      const { data: { user }, error: erroreUtente } = await supabase.auth.getUser();
      if (!user) throw erroreUtente ?? new Error('Non autenticato');
      const { data, error } = await supabase.from('rider_reviews').select('rating').eq('rider_id', user.id);
      if (error) throw error;
      const rows = (data ?? []) as { rating: number }[];
      if (rows.length === 0) return { avg: 0, count: 0 };
      return { avg: rows.reduce((s, r) => s + Number(r.rating), 0) / rows.length, count: rows.length };
    },
    staleTime: 60_000,
  });
  const rating = letturaVoto.data;
  // R04-011 — Anche il voto: il nuovo tentativo dopo un errore non è «nessuna recensione».
  const votoIgnoto = !rating && letturaCaduta(letturaVoto);

  /**
   * 15/10/2026 (R33) — I CONTANTI ANCORA DA DICHIARARE.
   *
   * Qui sotto la bacheca toglie i consegnati (`myActive`): giusto per le
   * consegne in corso, ma un ordine in contanti chiuso col codice prima di
   * dichiarare l'incasso spariva dalla vista, e la rimessa della sera lo
   * saltava — il negozio non veniva pagato e nessuno lo ricordava al
   * fattorino. Adesso restano qui, in cima, finche' non li conferma. La
   * lettura passa dal server: dopo sette giorni la regola sugli ordini glieli
   * nasconderebbe, e con loro l'unico modo di rimediare.
   */
  const letturaIncassi = useQuery({
    queryKey: CHIAVE_INCASSI_DA_DICHIARARE,
    queryFn: async (): Promise<IncassoDaDichiarare[]> => {
      const risposta = await fetch(INDIRIZZO_INCASSI_DA_DICHIARARE, { cache: 'no-store' });
      if (!risposta.ok) throw new Error('Non riesco a leggere gli incassi da confermare');
      const corpo = (await risposta.json()) as { incassi?: IncassoDaDichiarare[] };
      return Array.isArray(corpo.incassi) ? corpo.incassi : [];
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
  // 16/10/2026 — Prima qui si prendeva solo il dato: con la lettura fallita il
  // riquadro spariva e la bacheca sembrava pulita. «Nessun incasso» e «non lo
  // so» adesso sono due stati diversi, decisi da `riquadroDegliIncassi`.
  const riquadroIncassi = riquadroDegliIncassi<IncassoDaDichiarare>(letturaIncassi);
  const incassiDaDichiarare = riquadroIncassi.incassi;

  // Statistiche di oggi: consegne completate + incasso del giorno.
  const letturaOggi = useQuery({
    queryKey: queryKeys.rider.todayStats,
    queryFn: async () => {
      // R20-004 — Senza rete getUser() risponde «nessun utente» con un errore: non è «oggi 0,00 €».
      // La lettura cade (il riquadro dice «—») e si rilegge quando la rete torna o col «Riprova».
      const { data: { user }, error: erroreUtente } = await supabase.auth.getUser();
      if (!user) throw erroreUtente ?? new Error('Non autenticato');
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from('orders')
        .select('shipping_cost, rider_fee_cents, delivered_at')
        .eq('rider_id', user.id)
        .eq('delivery_status', 'DELIVERED')
        .gte('delivered_at', start.toISOString());
      // R20-004 — Una lettura caduta non è «oggi 0,00 €»: l'errore sale e il riquadro dice «—».
      if (error) throw error;
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
  const today = letturaOggi.data;

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
  const bachecaGuasta = letturaBacheca.data?.bachecaGuasta ?? false;

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
      // Onda 2 (R11-006) — `insieme`: gli altri ordini pronti dello stesso carrello presi con questo.
      const esito = data as { ok: boolean; id?: string; motivo?: string; insieme?: unknown } | null;
      if (!esito?.ok || !esito.id) {
        // R04-007 — Già preso da un altro, o non più pronto (annullato, tornato in preparazione).
        if (esito?.motivo === 'GIA_PRESO') throw new OrdineNonPiuPrendibile('Ordine già preso da un altro rider');
        if (esito?.motivo === 'NON_PIU_DISPONIBILE') {
          // R04-011 — `prendi_ordine` (661) risponde così anche quando l'ordine è GIÀ di chi chiama: un
          // doppio tocco su «Accetta», o la presa fatta da un'altra scheda. Prima di dire «non è più
          // disponibile» si guarda se è già suo (gli ordini suoi il fattorino li legge): se sì, è suo.
          // Solo se è ancora una consegna aperta: un ordine suo ma annullato non è «già tuo».
          const { data: { user: io } } = await supabase.auth.getUser();
          const { data: giaMio } = io
            ? await supabase
                .from('orders')
                .select('id')
                .eq('id', orderId)
                .eq('rider_id', io.id)
                .in('delivery_status', STATI_DELLE_MIE_CONSEGNE_APERTE)
                .maybeSingle()
            : { data: null };
          if ((giaMio as { id?: string } | null)?.id === orderId) return { id: orderId, giaTuo: true, insieme: 0 };
          throw new OrdineNonPiuPrendibile('Questo ordine non è più disponibile: non è più tra quelli pronti da prendere');
        }
        throw new Error(
          esito?.motivo === 'NON_FATTORINO'
            ? 'Il tuo profilo fattorino non è ancora approvato'
            // R03-018 (migrazione 270) — patente o polizza scadute, o mancanti per scooter e auto.
            : esito?.motivo === 'DOCUMENTI_SCADUTI'
              ? 'Patente o polizza RC scadute: carica il documento nuovo dal profilo per tornare a prendere consegne'
              // R03-009 — «Già preso» solo quando `prendi_ordine` lo dice (GIA_PRESO, qui sopra).
              // Una risposta vuota, storta o con un motivo che non conosciamo non è «l'ha preso un
              // altro»: si dice che la presa non è riuscita, senza inventare il perché.
              : "Non siamo riusciti a prendere l'ordine. Riprova.",
        );
      }
      const data2 = { id: esito.id, giaTuo: false, insieme: Array.isArray(esito.insieme) ? esito.insieme.length : 0 };

      // #44 — Qui c'era una chiamata a `notify()` dal browser. Non ha mai
      // funzionato: la tabella delle notifiche non ha nessuna regola che
      // permetta a una persona di scriverne una a un'altra, quindi il database
      // rifiutava e la funzione si mangiava l'errore. Sembrava fatto e non era
      // fatto. La notifica vera la scrive il trigger sul cambio di stato
      // dell'ordine (migrazione 086), lato server, dove i permessi ci sono.
      return data2;
    },
    onSuccess: (data) => {
      // R04-011 — Un ordine già suo non è una presa nuova: non si conta di nuovo e si dice com'è.
      if (!data.giaTuo) trackRiderOrderAccepted(data.id);
      qc.invalidateQueries({ queryKey: queryKeys.rider.orders });
      // R11-006 — Con la stessa presa sono arrivati gli altri ordini pronti dello stesso cliente: lo si dice,
      // o il fattorino scopre solo nell'elenco che deve passare anche da un altro negozio.
      toast.success(
        data.giaTuo
          ? 'Questo ordine è già tuo.'
          : data.insieme > 0
            ? `Ordine assegnato a te, insieme ${data.insieme === 1 ? 'a un altro ordine pronto' : `ad altri ${data.insieme} ordini pronti`} dello stesso cliente: un giro solo.`
            : 'Ordine assegnato a te!',
      );
      router.push(`/rider/orders/${data.id}`);
    },
    // R04-007 — Un «Accetta» perso perché l'ordine non si può più prendere: esce subito
    // dall'elenco e la bacheca si rilegge, invece di restare lì col suo «Accetta» fino al giro dopo.
    onError: (err: unknown, orderId: string) => {
      if (err instanceof OrdineNonPiuPrendibile) {
        qc.setQueryData<typeof letturaBacheca.data>(queryKeys.rider.orders, (prima) =>
          prima ? { ...prima, liberi: prima.liberi.filter((o) => o.id !== orderId) } : prima,
        );
        void qc.invalidateQueries({ queryKey: queryKeys.rider.orders });
      }
      toast.error(friendlyError(err));
    },
  });

  // Toggle online/offline: stesso update profilo della pagina Disponibilità.
  const toggleOnline = useMutation({
    // R20-002 — Senza rete la richiesta restava in pausa: interruttore grigio, nessun messaggio, e
    // poi si accendeva da solo quando la rete tornava. Adesso parte lo stesso e, se non arriva,
    // l'errore di rete diventa l'avviso «Problema di connessione» (non «Non autenticato»).
    networkMode: 'always',
    mutationFn: async (next: boolean) => {
      const { data: { user }, error: erroreUtente } = await supabase.auth.getUser();
      if (!user) throw erroreUtente ?? new Error('Non autenticato');
      const { error } = await supabase.from('profiles').update({ rider_is_online: next }).eq('id', user.id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      // R04-015 — La scrittura è riuscita: lo stato nuovo è quello vero. Si mette subito nella scheda,
      // poi si rilegge: se la rilettura cade la scheda non torna sul vecchio stato.
      qc.setQueryData<{ online: boolean; zones: string[] }>(queryKeys.rider.pref, (prima) =>
        prima ? { ...prima, online: next } : prima,
      );
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
        // R20-004 — Il «Riprova» rilegge anche gli incassi di oggi: aperti senza rete, restavano «—».
        onRetry={() => { void letturaOggi.refetch(); void letturaBacheca.refetch(); }}
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
          ) : votoIgnoto ? (
            <p className="text-xs text-ink-500">
              Non riesco a leggere il tuo voto ·{' '}
              <button type="button" className="font-semibold text-olive-700 underline" onClick={() => { void letturaVoto.refetch(); }}>
                Riprova
              </button>
            </p>
          ) : (
            <p className="text-xs text-ink-500">Pronto a consegnare</p>
          )}
        </div>
      </div>

      {/* Online toggle card — gradiente olive quando online, switch iOS */}
      <div className="px-4 pb-4">
        {statoOnlineIgnoto ? (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl border border-secondary-200 bg-secondary-50 px-5 py-[18px] text-ink-900">
            <div>
              <p className="font-serif text-lg font-extrabold">Non so se sei online</p>
              <p className="mt-0.5 text-xs text-ink-600">Non riesco a leggere il tuo stato. Riprova fra un momento.</p>
            </div>
            <Button
              variant="secondary"
              icon={RotateCcw}
              loading={letturaPref.isFetching}
              onClick={() => { void letturaPref.refetch(); }}
            >
              Riprova
            </Button>
          </div>
        ) : statoOnline === 'non-so' ? (
          // R04-011 — La prima lettura sta ancora arrivando: non si dice «Sei offline» e non si
          // offre l'interruttore finché lo stato non si sa.
          <Card variant="surface" radius="2xl" padding="none" aria-live="polite" className="px-5 py-[18px] text-ink-900">
            <p className="font-serif text-lg font-extrabold">Controllo se sei online…</p>
            <p className="mt-0.5 text-xs text-ink-500">Un momento: sto leggendo il tuo stato.</p>
          </Card>
        ) : (
        <RiquadroOnline online={online}>
          <div>
            <p className="font-serif text-lg font-extrabold">{online ? 'Sei online' : 'Sei offline'}</p>
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
            // R20-002 — Alto 44 px (era 32): si tocca col pollice anche in strada.
            className={`relative h-11 w-[76px] shrink-0 rounded-full transition-colors disabled:opacity-60 ${
              online ? 'bg-white/30' : 'bg-cream-300'
            }`}
          >
            <span
              className="absolute top-[3px] h-[38px] w-[38px] rounded-full bg-white shadow-sm-neutral transition-all"
              style={{ left: online ? '35px' : '3px' }}
            />
          </button>
        </RiquadroOnline>
        )}
      </div>

      {/* Stat di oggi: 3-up */}
      <div className="mb-[18px] grid grid-cols-3 gap-2 px-4">
        {[
          // R20-004 — «—» finché non c'è un numero (in caricamento o con la lettura caduta), non 0.
          ['Oggi', today ? formatPrice(today.earned) : '—'],
          ['Consegne', today ? String(today.count) : '—'],
          ['Rating', rating && rating.count > 0 ? rating.avg.toFixed(1).replace('.', ',') : '—'],
        ].map(([label, value]) => (
          <Card key={label} variant="surface" radius="lg" padding="none" className="px-3 py-2.5 text-center">
            <p className="font-serif text-[17px] font-extrabold text-ink-900">{value}</p>
            <p className="text-2xs font-bold uppercase tracking-[0.03em] text-ink-400">{label}</p>
          </Card>
        ))}
      </div>

      {/* Lettura degli incassi fallita: si dice, invece di far sparire il riquadro. */}
      {riquadroIncassi.stato === 'non-so' && (
        <div className="mb-[18px] px-4">
          <div role="alert" className="rounded-xl border border-secondary-200 bg-secondary-50 p-3.5">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
              <AlertTriangle size={16} className="shrink-0 text-secondary-600" aria-hidden />
              Non riesco a controllare gli incassi da confermare
            </p>
            <p className="mb-2.5 mt-1 text-[12.5px] leading-relaxed text-ink-600">
              Non so se hai consegne in contanti ancora da confermare. Riprova fra un momento.
            </p>
            <Button
              variant="secondary"
              icon={RotateCcw}
              loading={letturaIncassi.isFetching}
              onClick={() => { void letturaIncassi.refetch(); }}
            >
              Riprova
            </Button>
          </div>
        </div>
      )}

      {/* R33 — Consegne chiuse con i contanti ancora da confermare. */}
      {incassiDaDichiarare.length > 0 && (
        <div className="mb-[18px] px-4">
          <SectionLabel>Incassi da confermare ({incassiDaDichiarare.length})</SectionLabel>
          <p className="mb-2.5 text-[12.5px] leading-relaxed text-ink-600">
            Consegne chiuse senza la conferma dei contanti. Finché non le confermi, il negozio non viene pagato.
          </p>
          <div className="flex flex-col gap-2.5">
            {incassiDaDichiarare.map((x) => (
              <div key={x.id} className="rounded-xl border-2 border-accent-300 bg-accent-50 p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <Badge variant="cod" icon={Banknote}>Contanti</Badge>
                  <span className="font-mono text-[11px] text-ink-400">#{x.id.slice(0, 6).toUpperCase()}</span>
                </div>
                <p className="text-sm font-semibold text-ink-900">{x.storeName ?? 'Negozio'}</p>
                <p className="mb-2.5 text-[12.5px] text-ink-600">
                  {x.deliveredAt ? <>Consegnato il {formatDate(x.deliveredAt)} · </> : null}
                  da rimettere <strong>{formatPriceFromCents(x.expectedCents)}</strong>
                </p>
                <CashConfirmDialog
                  orderId={x.id}
                  expectedCents={x.expectedCents}
                  compensoTenutoCents={x.compensoTenutoCents}
                  residuoDovutoCents={x.residuoDovutoCents}
                  onConfirmed={() => { qc.invalidateQueries({ queryKey: CHIAVE_INCASSI_DA_DICHIARARE }); }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Consegne attive (le tue). 5/11/2026 — Tutte, non solo la prima: chi ne prende due (o i
          due negozi dello stesso carrello) vedeva solo la più vecchia, e la seconda restava ferma. */}
      {myActive.length > 0 && (
        <div className="mb-[18px] px-4">
          <SectionLabel>{myActive.length === 1 ? 'La tua consegna' : `Le tue consegne (${myActive.length})`}</SectionLabel>
          <div className="flex flex-col gap-2.5">
            {myActive.map((activeOne) => (
          <Link
            key={activeOne.id}
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
            <RigaFascia ordine={activeOne} />
            <div className="mt-3 flex items-center justify-between border-t border-cream-200 pt-3">
              <span className="text-sm font-bold text-olive-700">{formatPrice(compensoConsegnaEuro(activeOne))}</span>
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-primary-700">
                Continua <ArrowRight size={16} aria-hidden />
              </span>
            </div>
          </Link>
            ))}
          </div>
        </div>
      )}

      {/* Ordini disponibili / offline empty state */}
      {online ? (
        <div className="px-4">
          {/* 5/11/2026 — Qui c'era un riquadro del giro con una percentuale di efficienza: prendeva i primi due
              ordini dell'elenco senza guardare nessuna distanza, e la percentuale era scritta fissa. */}
          {bachecaGuasta && (
            <div role="alert" className="mb-3.5 rounded-xl border border-secondary-200 bg-secondary-50 p-3.5">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                <AlertTriangle size={16} className="shrink-0 text-secondary-600" aria-hidden />
                Non riesco a leggere gli ordini disponibili
              </p>
              <p className="mb-2.5 mt-1 text-[12.5px] leading-relaxed text-ink-600">
                Potrebbero esserci ordini pronti che non vedi. Riprova fra un momento.
              </p>
              <Button
                variant="secondary"
                icon={RotateCcw}
                loading={letturaBacheca.isFetching}
                onClick={() => { void letturaBacheca.refetch(); }}
              >
                Riprova
              </Button>
            </div>
          )}

          <SectionLabel>Ordini disponibili ({available.length})</SectionLabel>
          {available.length === 0 && bachecaGuasta ? null : available.length === 0 ? (
            <Card variant="surface" radius="xl" padding="none" className="p-8 text-center text-sm text-ink-500">
              Nessun ordine pronto al momento. Riprova tra un po'.
            </Card>
          ) : (
            <div className="flex flex-col gap-2.5">
              {available.map((o) => (
                <Card key={o.id} variant="surface" radius="xl" padding="none" className="p-3.5">
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
                  <RigaFascia ordine={o} />
                  <div className="mt-3 flex items-center justify-between">
                    <div>
                      <p className="text-[11px] text-ink-400">Compenso</p>
                      <p className="font-serif text-lg font-extrabold text-olive-700">{formatPrice(compensoConsegnaEuro(o))}</p>
                    </div>
                    {/* R04-007 — Gira solo il pulsante dell'ordine che si sta prendendo; gli altri
                        restano fermi e spenti finché la presa non torna (una presa alla volta). */}
                    <Button
                      variant="accent"
                      onClick={() => claim.mutate(o.id)}
                      loading={claim.isPending && claim.variables === o.id}
                      disabled={claim.isPending && claim.variables !== o.id}
                    >
                      Accetta
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* In preparazione — visibili ma non claimabili */}
          {inPrep.length > 0 && (
            <div className="mt-[18px]">
              <SectionLabel>In preparazione · attendi</SectionLabel>
              <div className="flex flex-col gap-2.5">
                {/* R20-002 — Niente più opacity-75: targhetta e compenso scendevano sotto 4,5:1. */}
                {inPrep.map((o) => (
                  <Card key={o.id} variant="surface" radius="xl" padding="none" className="p-3.5">
                    <div className="mb-2 flex items-center justify-between">
                      <Badge variant="local" icon={ChefHat}>In preparazione</Badge>
                      <span className="font-bold text-olive-700">{formatPrice(compensoConsegnaEuro(o))}</span>
                    </div>
                    <DeliveryRoute
                      store={o.store_name ?? 'Negozio'}
                      cust={`${o.delivery_city ?? 'Piacenza'}${o.delivery_zip ? ' · ' + o.delivery_zip : ''}`}
                      small
                    />
                    <RigaFascia ordine={o} />
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : statoOnline !== 'offline' ? null : (
        <div className="px-4">
          <Card variant="surface" radius="xl" padding="none" className="px-5 py-8 text-center">
            <span className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-full bg-olive-50">
              <Power size={26} className="text-olive-600" aria-hidden />
            </span>
            <p className="font-bold text-ink-900">Sei offline</p>
            <p className="mt-1 text-[13px] text-ink-500">Vai online per vedere gli ordini disponibili nella tua zona.</p>
            <p className="mt-3 text-xs text-ink-500">
              Gestisci orari e zone nella pagina{' '}
              <Link href="/rider/availability" className="text-olive-700 underline">Turni</Link>.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
