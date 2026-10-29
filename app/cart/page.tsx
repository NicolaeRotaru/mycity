'use client';

import {
  ETICHETTA_VAI_ALLA_CASSA,
  RIGA_COME_SI_CALCOLA,
  RIQUADRO_LO_SAPEVI,
  avvisoSpesaPiccola,
  fraseGiroUnico,
  frasePagamento,
  promessaSpedizione,
  rigaDellaVeloceNelCarrello,
  righeDellaConsegna,
  spiegazioneDellaConsegna,
  VOCE_CONSEGNA,
} from '@/lib/promesse-pubbliche';
import { statoDellaVista } from '@/lib/stato-vista';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { CartItem, getCart, updateQuantity, removeFromCart, cartTotal, cartCount } from '@/lib/cart';
import { formatPrice, pluralize } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import caricatoreFotoRemote from '@/lib/image-loader';
import { FOTO_MANCANTE } from '@/lib/foto-mancante';
import { fetchActiveDiscounts, discountedUnitCents } from '@/lib/promotions';
import { fetchSellerPublicMap, type SellerPublicProfile } from '@/lib/queries/seller-public-profiles';
import ShareCartButton from '@/components/ShareCartButton';
import EmptyState from '@/components/EmptyState';
import { StepIndicator, CHECKOUT_STEPS } from '@/components/checkout/StepIndicator';
import { vaiAlPrimoBlocco } from '@/components/checkout/OrderSummary';
import { CartUpsell } from '@/components/cart/CartUpsell';
import { AlertCircle, Banknote, Check, Lightbulb, Lock, Package, RotateCcw, ShieldCheck, ShoppingCart, Store, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { fondoDellaBarra, corsieSotto } from '@/lib/ui/barra-in-fondo';
import { chiaveDellaRiga, merceCheTengoIo, type TentativoAperto } from '@/lib/ordini/merce-che-tengo-io';
import { seguiAltezza, osservatoreDelBrowser } from '@/lib/altezza-banner';
import { leggiEsitoDellaVeloce, rigaQuandoArrivaNelCarrello } from '@/lib/ordini/consegna-veloce';
import { prezziDelCarrello } from '@/lib/ordini/prezzi';

/**
 * 3/9/2026 — DAL TELEFONO, IL PULSANTE CHE PORTA I SOLDI ERA L'ULTIMA COSA DELLA PAGINA.
 *
 * Sotto i 1024 pixel la pagina è a una colonna sola: prima tutti gli articoli, poi «Completa con»,
 * poi «Continua lo shopping», e solo in fondo il riepilogo con «Procedi al checkout». Chi compra da
 * telefono incontrava quindi due inviti a NON concludere prima di trovare il pulsante per
 * concludere — e per trovarlo doveva scorrere tutto il carrello. Le altre due tappe dello stesso
 * percorso una barra sempre visibile ce l'hanno già: la scheda prodotto (StickyAddToCart) e la
 * cassa. Il carrello era l'unico dei tre passaggi senza.
 *
 * Adesso ce l'ha anche lui, con lo stesso meccanismo: la barra sta sopra la barra a schede e sopra
 * il banner dei cookie (le «corsie» di `lib/ui/barra-in-fondo.ts`), e dichiara quanto è alta perché
 * il pulsante tondo dell'assistenza — che galleggia sopra tutto — sappia di quanto alzarsi. Senza
 * quella dichiarazione gli finirebbe sopra, che è il difetto già curato sulla scheda prodotto.
 */
const CORSIA_DELLA_BARRA = '--altezza-barra-acquisto';

/** Iniziali del negozio per il mini-logo: "Salumeria Verdi" → "SV". */
const storeInitials = (name: string) =>
  name.trim().split(/\s+/).map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase();

/**
 * La frase del carrello vuoto. 6/9/2026: era battuta a mano e prometteva «Spedizione gratis sopra
 * €30» tacendo i 3 € di consegna; da allora la scrive `promessaSpedizione()`. 27/10/2026: la soglia
 * non esiste più (si paga solo la consegna, per negozio), e la frase dice solo quello.
 */
function descrizioneDelCarrelloVuoto(): string {
  return `Scopri i prodotti dei negozi della tua città. ${promessaSpedizione().titolo}.`;
}

/**
 * 6/9/2026 — ALLE UNDICI DI SERA IL CARRELLO DICEVA «CONSEGNA IN 30-60 MIN». LA CASSA DICEVA DOMANI.
 *
 * Le due righe di disponibilità («Disponibile», «Ne restano solo N») chiudevano sempre con la
 * stessa coda, a qualunque ora, perché il numero era scritto lì dentro a mano. Ma il rider non c'è
 * di notte: la cassa offre «Adesso» solo fra le 8 e le 21 (`expressSiPuo`), e passate le 20 parte
 * già da domani (`giornoDiPartenza`). Alle 22:00 la persona leggeva mezz'ora nel carrello e
 * trovava domani mattina allo schermo dopo — la stessa sorpresa all'ultimo passo che sulla
 * spedizione è già stata tolta.
 *
 * Qui non si decide niente di nuovo: si chiede alle due funzioni che la cassa usa davvero, e la
 * mezz'ora viene da `EXPRESS_ETA_LABEL`, dove quel numero è stato deciso una volta sola.
 *
 * `null` = l'ora non è ancora stata letta (il primo disegno arriva dal server, dove non c'è un
 * orologio del quale fidarsi): in quel caso la riga non promette nessun tempo, invece di
 * inventarne uno.
 */
function quandoArrivaScrittoNelCarrello(ora: number | null, veloce: boolean | null): string | null {
  // 29/10/2026 — L'orologio non bastava: a negozio chiuso o senza un fattorino online il carrello
  // prometteva i minuti e il no arrivava all'ultimo tocco in cassa. Ora decide la stessa risposta
  // della cassa e delle rotte (`veloceSiPuo`, letta da /api/consegna/veloce): senza, niente minuti.
  return rigaQuandoArrivaNelCarrello(ora, veloce);
}

export default function CartPage() {
  const [items, setItems] = useState<CartItem[]>([]);
  /**
   * #119 — Quanto ce n'e' davvero, per ogni articolo del carrello.
   *
   * Il pulsante «+» non aveva nessun tetto: si poteva salire a novantanove
   * pezzi di un prodotto che ne ha due. Il blocco arrivava alla fine, al
   * momento di pagare, con un messaggio che non diceva nemmeno quanti se ne
   * potevano prendere: il cliente doveva tornare indietro e indovinare. Il
   * «−» il tetto ce l'aveva (non scende sotto uno): mancava solo dall'altra
   * parte. `null` = disponibilita' illimitata, `undefined` = non ancora letta.
   */
  const [disponibilita, setDisponibilita] = useState<Record<string, number | null>>({});

  /**
   * 3/9/2026 — I pezzi che sta tenendo impegnati QUESTA persona con un
   * pagamento aperto. La giacenza letta qui sopra è già scalata anche dalla sua
   * riserva: senza rimetterceli, chi ha premuto «Paga con carta» e poi è
   * tornato indietro leggeva «Non più disponibile» sul proprio ultimo pezzo, e
   * l'unica cosa che il carrello gli proponeva era toglierlo.
   */
  const [tengoIo, setTengoIo] = useState<Record<string, number>>({});

  /**
   * 6/9/2026 — IL CARRELLO MOSTRAVA IL PREZZO DEL GIORNO IN CUI AVEVI MESSO DENTRO IL PRODOTTO.
   *
   * L'unica lettura dal database chiedeva `id, stock`: tutti i prezzi a video e il totale nascevano
   * da `it.price`, cioè il numero congelato nel browser quando il prodotto è stato aggiunto. La
   * cassa invece rilegge `products.price` e ci applica le promozioni attive — come fanno le due
   * rotte che creano l'ordine. Quindi bastava che il fornaio ritoccasse un prezzo, o che partisse o
   * finisse una promozione, e il totale cambiava al passo dopo: un prodotto entrato a 31 € e oggi
   * scontato del 15% faceva scrivere al carrello 31 € con la spedizione gratis (soglia 30), e alla
   * cassa 26,35 € più 4,90 di spedizione.
   *
   * Qui c'è il prezzo di ADESSO, letto con la stessa funzione della cassa. Vuoto finché non arriva:
   * il carrello non aspetta la rete per disegnarsi.
   */
  const [prezzoDiOggi, setPrezzoDiOggi] = useState<Record<string, number>>({});

  /**
   * 6/9/2026 — LA SPEDIZIONE SCRITTA QUI NON ERA QUELLA CHE SI PAGAVA ALLA CASSA.
   *
   * Questa pagina chiamava `shippingForEuro` con le coordinate sempre a `null`, la cassa con quelle
   * dell'indirizzo salvato: stessa funzione, ingressi diversi, e il prezzo cambiava nell'ultimo
   * passo. Il carrello legge gli stessi due ingressi della cassa: dove sta il negozio e dove
   * consegniamo.
   *
   * 27/10/2026 — Al lancio `shippingForEuro` risponde zero (si paga solo la consegna, 3 € per
   * negozio), ma gli ingressi restano quelli della cassa: il giorno che la spedizione torna a
   * dipendere dalla distanza, carrello e cassa dicono ancora lo stesso numero senza toccare qui.
   */
  const [dovEIlNegozio, setDovEIlNegozio] = useState<Record<string, { lat: number | null; lng: number | null }>>({});
  const [doveConsegniamo, setDoveConsegniamo] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });

  /**
   * Il carrello vero si legge QUI, dopo il primo disegno: `useState([])` parte vuoto perché deve
   * partire da qualcosa, non perché il carrello sia vuoto. Senza questa bandierina il primo render
   * — e l'HTML che parte dal server — diceva «Il tuo carrello è vuoto» a chi ce l'ha pieno.
   */
  const [letto, setLetto] = useState(false);

  /**
   * Che ore sono, per chi sta guardando. Parte da `null` e non da `new Date()` per la stessa
   * ragione di `letto` qui sopra: il primo disegno lo fa il server, e un'ora presa lì sarebbe
   * quella del server, non quella di chi compra — l'HTML arriverebbe con una promessa e il browser
   * la cambierebbe subito dopo.
   *
   * Si rilegge ogni minuto perché un carrello lasciato aperto attraversa le 21: senza il battito,
   * alle 21:05 la pagina prometterebbe ancora mezz'ora solo perché l'ora era stata letta alle 20:59.
   */
  const [oraDiAdesso, setOraDiAdesso] = useState<number | null>(null);
  // La veloce si può mantenere adesso? `null` = non ancora letto o lettura caduta: nessun tempo
  // promesso. La risposta è quella delle rotte (negozi aperti, 8-21, un fattorino online).
  const [veloceSiPuoAdesso, setVeloceSiPuoAdesso] = useState<boolean | null>(null);

  useEffect(() => {
    let vivo = true;
    const leggiLOra = () => {
      setOraDiAdesso(new Date().getHours());
      const negozi = Array.from(new Set(getCart().map((i) => i.sellerId).filter((v): v is string => !!v)));
      if (negozi.length === 0) return;
      fetch(`/api/consegna/veloce?negozi=${negozi.join(',')}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((esito: unknown) => {
          if (vivo) setVeloceSiPuoAdesso(leggiEsitoDellaVeloce(esito));
        })
        .catch(() => {
          if (vivo) setVeloceSiPuoAdesso(null);
        });
    };
    leggiLOra();
    const battito = setInterval(leggiLOra, 60_000);
    return () => {
      vivo = false;
      clearInterval(battito);
    };
  }, []);

  useEffect(() => {
    const refresh = () => {
      setItems(getCart());
      setLetto(true);
    };
    refresh();
    window.addEventListener('cart:updated', refresh);
    return () => window.removeEventListener('cart:updated', refresh);
  }, []);

  /**
   * #119 e, dal 22/8/2026, due difetti che stavano qui dentro.
   *
   * ① LE VARIANTI NON SI GUARDAVANO. Si leggeva solo `products.stock`, ma su un
   *    prodotto con varianti la scorta vera sta su `product_variants`: il
   *    carrello lasciava alzare la quantità oltre quello che c'era, e il muro
   *    arrivava alla cassa. Il checkout la variante la guarda già; qui no.
   *
   * ② LA LETTURA NON SI RIFACEVA AL CAMBIO DI QUANTITÀ. La dipendenza era
   *    `items.length`: togliendo una riga e aggiungendone un'altra il numero
   *    resta uguale, quindi la scorta del prodotto nuovo non veniva mai chiesta.
   *    Adesso dipende dagli identificativi veri.
   */
  const chiaviCarrello = items
    .map((i) => `${i.id}::${i.variantId ?? ''}`)
    .sort()
    .join(',');

  useEffect(() => {
    const carrello = getCart();
    const ids = Array.from(new Set(carrello.map((i) => i.id)));
    const idVarianti = Array.from(
      new Set(carrello.map((i) => i.variantId).filter((v): v is string => !!v)),
    );
    const idNegozi = Array.from(
      new Set(carrello.map((i) => i.sellerId).filter((v): v is string => !!v)),
    );
    if (ids.length === 0) return;
    let vivo = true;
    void (async () => {
      const { supabase } = await import('@/lib/supabase/client');
      // Chi è entrato lo dice la sessione già in memoria: da ospiti non si
      // chiedono le riserve, perché per riservare bisogna aver ordinato.
      const idCliente = (await supabase.auth.getSession()).data.session?.user?.id ?? null;
      const [prodottiRes, variantiRes, tentativiRes, scontiRes, negoziRes, indirizzoRes] = await Promise.all([
        // Il prezzo si legge insieme alla scorta: e' la stessa riga di tabella, non costa un viaggio in piu'.
        supabase.from('products').select('id, stock, price').in('id', ids),
        idVarianti.length > 0
          ? supabase.from('product_variants').select('id, stock').in('id', idVarianti)
          : Promise.resolve({ data: [] as Array<{ id: string; stock: number | null }> }),
        // I propri tentativi di pagamento ancora aperti.
        idCliente
          ? supabase
              .from('pending_checkouts')
              .select('groups')
              .eq('buyer_id', idCliente)
              .eq('status', 'PENDING')
              .limit(10)
          : Promise.resolve({ data: [] as TentativoAperto[] }),
        // Le promozioni attive: stessa funzione della cassa e delle due rotte che creano l'ordine.
        fetchActiveDiscounts(supabase, ids),
        // Dove sta ogni negozio, dalla vista pubblica che leggono anche le due rotte che creano
        // l'ordine (18/10/2026: `profiles`, a profili chiusi, al cliente non le restituisce). Se la
        // lettura cade il carrello si disegna lo stesso: la cifra finale la da' la cassa.
        fetchSellerPublicMap(supabase, idNegozi, 'id, store_lat, store_lng')
          .catch(() => new Map<string, SellerPublicProfile>()),
        // Dove consegniamo: l'indirizzo predefinito, letto con la stessa query della cassa.
        idCliente
          ? supabase
              .from('user_addresses')
              .select('lat, lng')
              .eq('user_id', idCliente)
              .order('is_default', { ascending: false })
              .limit(1)
          : Promise.resolve({ data: [] as Array<{ lat: number | null; lng: number | null }> }),
      ]);
      if (!vivo) return;
      setTengoIo(
        Object.fromEntries(merceCheTengoIo((tentativiRes.data ?? []) as TentativoAperto[])),
      );
      const mappa: Record<string, number | null> = {};
      const prezzi: Record<string, number> = {};
      for (const p of (prodottiRes.data ?? []) as Array<{ id: string; stock: number | null; price: number | string | null }>) {
        mappa[p.id] = p.stock;
        const pieno = Number(p.price ?? NaN);
        // Il prezzo che si mostra e' quello che il server fara' pagare: pieno meno la promozione attiva.
        if (Number.isFinite(pieno)) prezzi[p.id] = discountedUnitCents(pieno, scontiRes.get(p.id) ?? 0) / 100;
      }
      setPrezzoDiOggi(prezzi);
      setDovEIlNegozio(
        Object.fromEntries(
          [...negoziRes.values()].map((n) => [n.id, { lat: n.store_lat ?? null, lng: n.store_lng ?? null }]),
        ),
      );
      const casa = ((indirizzoRes.data ?? []) as Array<{ lat: number | null; lng: number | null }>)[0];
      setDoveConsegniamo({ lat: casa?.lat ?? null, lng: casa?.lng ?? null });
      // La variante si indicizza con la sua chiave di riga, così una riga con
      // variante non eredita la scorta del prodotto intero.
      for (const v of (variantiRes.data ?? []) as Array<{ id: string; stock: number | null }>) {
        mappa[`variante::${v.id}`] = v.stock;
      }
      setDisponibilita(mappa);
    })();
    return () => { vivo = false; };
  }, [chiaviCarrello]);

  /**
   * Il massimo prendibile per quella riga: null/assente = nessun limite noto.
   * Con una variante scelta comanda la scorta della variante, non quella del
   * prodotto intero.
   */
  const massimo = (id: string, variantId?: string | null): number | null => {
    // Quello che tengo impegnato io torna a contare come mio: sull'ultimo pezzo
    // la differenza è fra «non più disponibile» e «lo stai comprando».
    const mio = tengoIo[chiaveDellaRiga(id, variantId)] ?? 0;
    if (variantId) {
      const v = disponibilita[`variante::${variantId}`];
      if (typeof v === 'number') return v + mio;
    }
    const s = disponibilita[id];
    return typeof s === 'number' ? s + mio : null;
  };

  /**
   * La barra in fondo dice quanto è alta, e chi le sta sopra la legge.
   *
   * È la stessa corsia della barra «Aggiungi al carrello»: le due non si incontrano mai (quella vive
   * sulla scheda prodotto, questa nel carrello), quindi la corsia è libera e non ne serve una nuova.
   * Quando la barra non c'è — carrello vuoto, o schermo grande — `seguiAltezza` pubblica zero:
   * dichiarato, non indovinato.
   */
  const barraRef = useRef<HTMLDivElement>(null);
  useEffect(
    () => seguiAltezza(barraRef.current, document.documentElement, osservatoreDelBrowser, CORSIA_DELLA_BARRA),
    [letto, items.length],
  );

  // Feedback al rientro da Stripe Checkout annullato (?stripe=canceled)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe') === 'canceled') {
      toast('Pagamento annullato. Il carrello è ancora qui quando vuoi.');
      window.history.replaceState({}, '', '/cart');
    }
  }, []);

  /**
   * Le righe con il prezzo di ADESSO, non con quello congelato nel browser.
   *
   * Finché la lettura non è tornata, `prezzoDiOggi` è vuoto e qui non cambia niente: la pagina si
   * disegna subito col prezzo che ha, e si corregge da sola quando arriva quello vero.
   */
  const righe: CartItem[] = items.map((it) => {
    const oggi = prezzoDiOggi[it.id];
    return oggi != null && Math.abs(oggi - it.price) >= 0.01 ? { ...it, price: oggi } : it;
  });
  /** Quali prezzi sono cambiati sotto il naso di chi compra: si dice, non si cambia il totale in silenzio. */
  const cambiatoDaQuandoLoHaiMesso = new Map<string, number>(
    items
      .filter((it) => {
        const oggi = prezzoDiOggi[it.id];
        return oggi != null && Math.abs(oggi - it.price) >= 0.01;
      })
      .map((it) => [`${it.id}::${it.variantId ?? ''}`, it.price]),
  );

  const total = cartTotal(righe);
  const count = cartCount(righe);

  // «Vuoto» è un'affermazione sul mondo — ho guardato e non c'è niente — e non si può fare prima di
  // aver guardato. Il verdetto lo dà `statoDellaVista`, che senza `letto` non torna mai «vuoto».
  const vista = statoDellaVista({ letto, quanti: items.length });

  if (vista.mostraScheletro) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-8" aria-busy="true">
        {/* Il titolo non aspetta i dati: e' gia' noto, e questa e' l'unica schermata che il
            server manda. Con il rettangolo grigio al suo posto la pagina arrivava senza h1 —
            senza titolo per Google e per chi naviga il sito per intestazioni. */}
        <h1 className="font-serif text-2xl font-bold text-ink-900 mb-6">Il tuo carrello</h1>
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 skeleton rounded-xl" />
            ))}
          </div>
          <div className="h-64 skeleton rounded-xl" />
        </div>
        <span className="sr-only">Carico il carrello…</span>
      </div>
    );
  }

  if (vista.mostraVuoto) {
    return (
      <div className="container mx-auto py-12 max-w-2xl">
        {/* Anche il carrello vuoto ha il suo titolo: qui il disegno non lo mostra, ma chi
            naviga per intestazioni deve trovarlo lo stesso. */}
        <h1 className="sr-only">Il tuo carrello</h1>
        <EmptyState
          icon={ShoppingCart}
          title="Il tuo carrello è vuoto"
          description={descrizioneDelCarrelloVuoto()}
          ctaLabel="Esplora i prodotti"
          ctaHref="/search"
          secondaryLabel="Vedi i negozi"
          secondaryHref="/stores"
        />
      </div>
    );
  }

  // Raggruppa per negozio (presentazione): usa sellerId/storeName già presenti
  // nel CartItem. Nessuna mutazione di stato — solo il rendering cambia.
  const groupOrder: string[] = [];
  const groupsByStore = new Map<string, { storeName: string; items: CartItem[] }>();
  for (const it of righe) {
    const key = it.sellerId ?? it.storeName ?? '__nostore__';
    if (!groupsByStore.has(key)) {
      groupsByStore.set(key, { storeName: it.storeName ?? 'Negozio', items: [] });
      groupOrder.push(key);
    }
    groupsByStore.get(key)!.items.push(it);
  }
  const groups = groupOrder.map((k) => ({ key: k, ...groupsByStore.get(k)! }));
  const multiStore = groups.length > 1;
  // 107 — Il carrello sommava merce e spedizione e si fermava lì: la consegna compariva solo
  // all'ultimo passo, dove l'abbandono costa di piu'. 29/10/2026 — e poi la contava «negozi × 3 €»
  // a mano, mentre la consegna è 3 € o 4 € per negozio (sotto i 10 € di spesa): adesso il numero
  // viene da `prezziDelCarrello`, lo stesso conto della cassa e delle due rotte.

  /**
   * La spedizione per negozio, con la stessa funzione e gli stessi ingressi della cassa (vedi
   * `dovEIlNegozio`). 27/10/2026 — Al lancio risponde zero: il cliente paga solo la consegna, una
   * per negozio (scelta 8 della carta #209). Non ha una riga sua, perche' a zero scriverebbe
   * «Gratis» accanto a una consegna da pagare: entra nella riga «Consegna MyCity», che dice la
   * cifra intera per farsi portare la spesa, la stessa del riepilogo della cassa.
   */
  const contoConsegna = prezziDelCarrello({
    gruppi: groups.map((g) => ({
      sellerId: g.key,
      subtotalCents: Math.round(g.items.reduce((somma, it) => somma + it.price * it.quantity, 0) * 100),
    })),
    coordinateNegozio: (key) => ({ lat: dovEIlNegozio[key]?.lat ?? null, lng: dovEIlNegozio[key]?.lng ?? null }),
    consegnaLat: doveConsegniamo.lat,
    consegnaLng: doveConsegniamo.lng,
    pickupInStore: false,
    couponSpedizioneGratis: false,
    couponScontoCents: 0,
    // Nel carrello la fascia non è ancora scelta: si conta quella oraria. La veloce sta sotto il
    // totale come scelta, col suo prezzo vero (dalle voci del conto) o «compresa».
    consegnaVeloce: false,
  });
  const vociConsegna = contoConsegna.consegna;
  const supplementoVeloceCents = vociConsegna.supplementoVeloceCents;
  const spiegazione = spiegazioneDellaConsegna(frasePagamento());
  const shippingCost = contoConsegna.grandShippingCents / 100;
  const tariffeConsegnaCents = contoConsegna.gruppi.map((g) => g.deliveryFeeCents);
  const consegnaDaPagare =
    (contoConsegna.grandShippingCents + tariffeConsegnaCents.reduce((somma, x) => somma + x, 0)) / 100;
  const finalTotal = total + consegnaDaPagare;

  /**
   * 6/9/2026 — LA RIGA DICEVA «TOGLILO PER CONTINUARE» E IL PULSANTE LASCIAVA CONTINUARE.
   *
   * Con un articolo esaurito la riga si tingeva di rosso e chiedeva di toglierlo, ma «Procedi al
   * checkout» restava un collegamento acceso: si arrivava alla cassa, e solo lì il muro fermava
   * l'ordine (`handleSubmit` con `stockIssues`, e il pulsante del riepilogo con `aria-disabled`).
   * Non era un vicolo cieco — era un'istruzione che si contraddice da sola, pagata con un
   * passaggio in più proprio in fondo al percorso, dove si abbandona di più.
   *
   * Stessa regola della riga rossa qui sopra (`massimo(...) === 0`), così le due non possono
   * separarsi: finché non si sa quanto ce n'è, `massimo` risponde `null` e non blocca niente.
   */
  const bloccanti = righe.filter((it) => massimo(it.id, it.variantId) === 0);
  /** Cosa c'è scritto sul pulsante quando l'ordine non può partire: dice il gesto, non il divieto. */
  const cosaFarePrima =
    bloccanti.length === 1
      ? 'Togli l’articolo esaurito per continuare'
      : 'Togli gli articoli esauriti per continuare';

  return (
    // Lo spazio in fondo è per la barra fissa del telefono: senza, copre l'ultima riga della pagina.
    <div className="container mx-auto px-4 sm:px-6 py-8 pb-28 lg:pb-8">
      {/* Step indicator condiviso col checkout (carrello = step 1) */}
      <StepIndicator steps={CHECKOUT_STEPS} currentStep={1} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* COLONNA SX: prodotti */}
        <div className="lg:col-span-2 space-y-4">
          <h1 className="font-serif text-2xl font-bold text-ink-900">
            Il tuo carrello <span className="text-ink-500 font-normal font-sans text-lg">({pluralize(count, 'articolo', 'articoli')})</span>
          </h1>

          {/* Più negozi, una consegna sola: il fattorino fa un giro solo (regola del 29/10). */}
          {multiStore && (
            <div className="flex items-center gap-2 rounded-xl border border-cream-300 bg-cream-50 px-4 py-3 text-sm text-ink-600">
              <Package size={16} className="text-ink-500 shrink-0" aria-hidden />
              <span>
                {fraseGiroUnico(groups.length)}
              </span>
            </div>
          )}

          {/* Gruppi per negozio */}
          {groups.map((g, indiceNegozio) => {
            const spesaDelNegozioCents = contoConsegna.gruppi[indiceNegozio]?.subtotalCents ?? 0;
            const spesaPiccola = avvisoSpesaPiccola(spesaDelNegozioCents);
            return (
              <div key={g.key} className="space-y-3">
                {/* Header negozio */}
                <div className="flex items-center gap-2 pt-1">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-[9px] font-bold text-white">
                    {storeInitials(g.storeName)}
                  </span>
                  <span className="text-sm font-bold text-ink-900">
                    {g.storeName}
                    {multiStore && <span className="font-normal text-ink-600"> · {formatPrice(spesaDelNegozioCents / 100)}</span>}
                  </span>
                </div>
                {spesaPiccola && (
                  <p className="rounded-lg border border-cream-300 bg-cream-50 px-3 py-2 text-sm text-ink-700">{spesaPiccola}</p>
                )}

                {g.items.map((item) => (
                  <div key={`${item.id}::${item.variantId ?? ''}`} className="bg-white border border-cream-300 rounded-xl p-4 flex gap-4 hover:shadow-card transition-shadow">
                    <div className="relative w-24 h-24 bg-cream-100 rounded-lg shrink-0 overflow-hidden">
                      <Image
                        src={sizedImage(item.image ?? FOTO_MANCANTE, 'thumb')}
                        alt={item.name}
                        fill
                        sizes="96px"
                        loader={caricatoreFotoRemote}
                        className="object-cover"
                      />
                    </div>
                    <div className="flex-1 flex flex-col justify-between min-w-0">
                      <Link
                        href={`/product/${item.id}`}
                        className="text-base font-semibold leading-snug text-ink-900 hover:text-primary-700 line-clamp-2"
                      >
                        {item.name}
                      </Link>
                      {item.variantLabel && (
                        <p className="text-xs font-semibold text-ink-500">{item.variantLabel}</p>
                      )}
                      {/* 6/9/2026 — Se il prezzo è cambiato da quando l'hai messo dentro, si dice
                          qui e adesso: prima lo si scopriva alla cassa, che è il punto in cui si
                          chiude la pagina. */}
                      {(() => {
                        const prima = cambiatoDaQuandoLoHaiMesso.get(`${item.id}::${item.variantId ?? ''}`);
                        if (prima == null) return null;
                        const sceso = item.price < prima;
                        return (
                          <p className={`text-xs font-semibold ${sceso ? 'text-olive-700' : 'text-amber-700'}`}>
                            {sceso ? 'Buona notizia: il prezzo è sceso' : 'Il prezzo è cambiato'} da{' '}
                            {formatPrice(prima)} a {formatPrice(item.price)}
                          </p>
                        );
                      })()}
                      {/* 22/8/2026 — questa riga diceva «Disponibile» sempre,
                          anche su una riga esaurita. La scorta era già letta
                          qui sopra e serviva solo a limitare il pulsante «+»:
                          la persona leggeva «Disponibile», non riusciva ad
                          alzare la quantità, e non capiva perché. */}
                      {(() => {
                        const rimasti = massimo(item.id, item.variantId);
                        const quando = quandoArrivaScrittoNelCarrello(oraDiAdesso, veloceSiPuoAdesso);
                        if (rimasti === 0) {
                          return (
                            <p role="alert" className="text-xs text-red-600 font-semibold flex items-center gap-1">
                              <AlertCircle size={13} strokeWidth={2.5} aria-hidden />
                              Non più disponibile · toglilo per continuare
                            </p>
                          );
                        }
                        if (rimasti !== null && rimasti < item.quantity) {
                          return (
                            <p className="text-xs text-amber-700 font-semibold flex items-center gap-1">
                              <AlertCircle size={13} strokeWidth={2.5} aria-hidden />
                              Ne restano {rimasti} · abbassa la quantità
                            </p>
                          );
                        }
                        if (rimasti !== null && rimasti <= 3) {
                          return (
                            <p className="text-xs text-amber-700 font-semibold flex items-center gap-1">
                              <AlertCircle size={13} strokeWidth={2.5} aria-hidden />
                              Ne restano solo {rimasti}{quando ? ` · ${quando}` : ''}
                            </p>
                          );
                        }
                        return (
                          <p className="text-xs text-olive-600 font-semibold flex items-center gap-1">
                            <Check size={13} strokeWidth={2.5} aria-hidden /> Disponibile{quando ? ` · ${quando}` : ''}
                          </p>
                        );
                      })()}
                      <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <div className="flex flex-col">
                          <div className="flex items-center border border-cream-300 rounded-full">
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.id, item.quantity - 1, item.variantId)}
                              disabled={item.quantity <= 1}
                              aria-label={`Diminuisci quantità di ${item.name}`}
                              className="w-11 h-11 hover:bg-cream-100 rounded-l-full disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                            >−</button>
                            {/* 22/8/2026 — LA QUANTITA' CAMBIAVA IN SILENZIO.
                                Si premeva «+» e non veniva annunciato niente:
                                chi non vede lo schermo doveva rileggere la riga
                                per capire se il tocco era andato a segno.
                                `<output aria-live>` fa dire al lettore il numero
                                nuovo appena cambia — e' la stessa cosa che fa
                                gia' la scheda prodotto. */}
                            <output
                              aria-live="polite"
                              aria-atomic="true"
                              aria-label={`Quantità di ${item.name}`}
                              className="w-8 text-center font-semibold"
                            >
                              {item.quantity}
                            </output>
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.id, item.quantity + 1, item.variantId)}
                              disabled={massimo(item.id, item.variantId) != null && item.quantity >= (massimo(item.id, item.variantId) as number)}
                              aria-label={`Aumenta quantità di ${item.name}`}
                              className="w-11 h-11 hover:bg-cream-100 rounded-r-full disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                            >+</button>
                          </div>
                          {massimo(item.id, item.variantId) != null && item.quantity >= (massimo(item.id, item.variantId) as number) && (
                            <p className="mt-1 text-xs text-ink-500">
                              {(massimo(item.id, item.variantId) as number) === 1
                                ? 'Ne resta solo uno'
                                : `Disponibili ${massimo(item.id, item.variantId)}`}
                            </p>
                          )}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeFromCart(item.id, item.variantId)}
                            aria-label={`Rimuovi ${item.name} dal carrello`}
                            /* Il bersaglio era alto quanto la riga di testo (20px) e attaccato al «−»:
                               col pollice si toglieva il prodotto invece di scalare la quantita'. Il
                               padding lo porta a 36px, il margine negativo tiene la riga alta com'era, e
                               ml-1+pl-1 lascia il testo dov'e' lasciando 12px fra i due bersagli. */
                            className="text-ink-500 hover:text-secondary-600 text-sm ml-1 pl-1 pr-2 py-2 -my-2 flex items-center gap-1"
                          >
                            <Trash2 size={15} aria-hidden /> Rimuovi
                          </button>
                        </div>
                        <span className="font-bold font-serif text-ink-900 text-lg">{formatPrice(item.price * item.quantity)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}

          {/* Upsell "Completa con" — prodotti reali degli stessi negozi */}
          <CartUpsell items={items} />
        </div>

        {/* COLONNA DX: riepilogo sticky */}
        <div className="space-y-4 lg:sticky lg:top-[var(--header-height)] h-fit">
          <div className="bg-white border border-cream-300 rounded-xl p-6 space-y-4 shadow-card">
            <h2 className="font-serif text-lg font-bold text-ink-900 flex items-center justify-between">
              Riepilogo ordine
              <span className="text-xs font-normal font-sans text-ink-400">{pluralize(count, 'articolo', 'articoli')}</span>
            </h2>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-600">Subtotale</span>
                <span className="font-semibold">{formatPrice(total)}</span>
              </div>
            </div>

            <div className="flex justify-between items-baseline text-sm">
              <span className="text-ink-600">{VOCE_CONSEGNA}</span>
              <span className="font-semibold text-ink-900">{formatPrice(consegnaDaPagare)}</span>
            </div>
            {/* Il dettaglio sta FUORI dalla colonna dei numeri: chi somma la colonna trova il totale.
                Solo le voci che costano qualcosa (`righeDellaConsegna`, dalle voci del conto vero). */}
            {shippingCost === 0 && (
              <ul className="-mt-1 space-y-0.5 text-xs text-ink-500" aria-label="Come è fatta la consegna">
                {righeDellaConsegna(vociConsegna).map((r) => <li key={r}>{r}</li>)}
              </ul>
            )}

            {/* Il totale cambia a ogni «+», «−» e rimozione: qui si dice anche
                a chi non lo vede cambiare. */}
            <p className="sr-only" role="status" aria-live="polite">
              Carrello aggiornato: {count} {count === 1 ? 'articolo' : 'articoli'}, consegna {formatPrice(consegnaDaPagare)}, totale {formatPrice(finalTotal)}
            </p>

            <div className="border-t border-cream-300 pt-3 flex justify-between items-baseline">
              <span className="font-bold">Totale</span>
              <div className="text-right">
                <div className="font-serif text-2xl font-extrabold text-primary-800">{formatPrice(finalTotal)}</div>
                <div className="text-xs tracking-label text-ink-400 uppercase">IVA inclusa</div>
              </div>
            </div>

            {/* La veloce è una scelta della cassa, detta col suo prezzo vero: solo se adesso si può davvero. */}
            {rigaDellaVeloceNelCarrello(veloceSiPuoAdesso, supplementoVeloceCents, vociConsegna.totaleCents) && (
              <p className="text-xs text-ink-600">
                {rigaDellaVeloceNelCarrello(veloceSiPuoAdesso, supplementoVeloceCents, vociConsegna.totaleCents)}
              </p>
            )}

            <details className="text-sm text-ink-600">
              <summary className="flex min-h-[44px] cursor-pointer items-center font-semibold text-ink-800">
                {RIGA_COME_SI_CALCOLA} ›
              </summary>
              <div className="space-y-2 pb-2 text-xs">
                <p>{spiegazione.apertura}</p>
                <ul className="list-disc space-y-1 pl-4">
                  {spiegazione.punti.map((p) => <li key={p}>{p}</li>)}
                </ul>
                <ul className="space-y-0.5">
                  {spiegazione.esempi.map((e) => <li key={e}>{e}</li>)}
                </ul>
                <p>{spiegazione.chiusura}</p>
              </div>
            </details>

            {/* Il pulsante resta raggiungibile da tastiera e dichiara di essere bloccato con
                `aria-disabled` — un elemento `disabled` esce dal giro del Tab e sparisce senza
                spiegazioni. Premendolo si va sulla prima riga da sistemare: è lo stesso
                comportamento della cassa (`vaiAlPrimoBlocco`), non una seconda regola scritta qui. */}
            {bloccanti.length > 0 ? (
              <button
                type="button"
                aria-disabled="true"
                onClick={vaiAlPrimoBlocco}
                className="flex items-center justify-center gap-2 w-full text-center bg-primary-700 text-white py-3.5 rounded-lg font-bold shadow-warm-sm aria-disabled:opacity-50 aria-disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
              >
                <AlertCircle size={16} strokeWidth={2.4} aria-hidden /> {cosaFarePrima}
              </button>
            ) : (
              <Link
                href="/checkout"
                className="flex items-center justify-center gap-2 w-full text-center bg-primary-700 hover:bg-primary-800 text-white py-3.5 rounded-lg font-bold shadow-warm-sm hover:shadow-warm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
              >
                <Lock size={16} strokeWidth={2.4} aria-hidden /> {ETICHETTA_VAI_ALLA_CASSA}
              </Link>
            )}

            {/* Lista spesa condivisibile — Growth PM: viral coefficient,
                Behavioral Scientist: social proof + commitment partner */}
            <div className="text-center pt-1">
              <ShareCartButton items={items} />
            </div>

            <div className="space-y-2 pt-2 text-xs text-ink-500">
              <p className="flex items-center gap-2"><Banknote size={14} className="text-olive-600 shrink-0" aria-hidden /> {frasePagamento()}</p>
              <p className="flex items-center gap-2"><ShieldCheck size={14} className="text-olive-600 shrink-0" aria-hidden /> I tuoi dati sono al sicuro</p>
              {/* 6/9/2026 — QUI SI PROMETTEVA IL RESO ANCHE SU PANE, TORTE E GASTRONOMIA.
                  La riga diceva «Reso facile entro 14 giorni» per qualunque carrello. Sui beni
                  deperibili il diritto di ripensarci non c'è (art. 59 lettera d del Codice del
                  Consumo) e la nostra pagina dei resi lo scrive già; il primo negozio vero è un
                  forno, quindi la riga era sbagliata su ogni suo ordine. In più nessuna pagina del
                  percorso diceva come si fa un reso: adesso ci si arriva da qui.
                  ⚠️ Resta da fare la versione per categoria — mostrarla solo sul non alimentare —
                  che ha bisogno della categoria del prodotto (il carrello non ce l'ha) e di una
                  decisione su quali categorie sono escluse: non è una scelta da prendere qui. */}
              <p className="flex items-start gap-2">
                <RotateCcw size={14} className="text-olive-600 shrink-0 mt-0.5" aria-hidden />
                <span>
                  Reso entro 14 giorni ·{' '}
                  <Link href="/returns" className="font-semibold text-primary-700 underline hover:text-primary-800">
                    alcuni prodotti sono esclusi
                  </Link>
                </span>
              </p>
              <p className="flex items-center gap-2"><Store size={14} className="text-olive-600 shrink-0" aria-hidden /> Supporti il commercio locale</p>
            </div>
          </div>

          {/* Su una colonna sola questo invito stava PRIMA del pulsante d'ordine: l'ultima cosa
              letta prima di decidere era «torna a girare per negozi». Ora viene dopo. */}
          <Link
            href="/"
            className="inline-block text-primary-700 hover:underline font-semibold text-sm"
          >
            ← Continua lo shopping
          </Link>

          <div className="bg-primary-50 border border-primary-200 rounded-xl p-4 text-sm">
            <p className="font-bold text-primary-900 mb-1 flex items-center gap-2">
              <Lightbulb size={16} className="text-primary-700 shrink-0" aria-hidden /> Lo sapevi?
            </p>
            <p className="text-primary-800">
              {RIQUADRO_LO_SAPEVI}
            </p>
          </div>
        </div>
      </div>

      {/* La barra che tiene il totale e il pulsante d'ordine sempre a portata di pollice. Solo sul
          telefono e sul tablet: da 1024 pixel in su il riepilogo è già appiccicato a destra. */}
      <div
        ref={barraRef}
        className="lg:hidden fixed left-0 right-0 z-30 bg-white border-t border-cream-300 shadow-warm-lg px-4 py-3 flex items-center gap-3"
        // Sopra la barra a schede e, quando c'è, sopra il banner dei cookie. La safe-area
        // dell'iPhone la conta `bottom` e nessun altro: contata due volte, la barra galleggia
        // staccata dal fondo.
        style={{ bottom: fondoDellaBarra(corsieSotto(CORSIA_DELLA_BARRA)) }}
        role="region"
        aria-label="Totale e pagamento"
      >
        <div className="leading-tight">
          <div className="text-xs font-semibold uppercase tracking-label text-ink-500">Totale</div>
          <div className="font-serif text-xl font-extrabold text-ink-900">{formatPrice(finalTotal)}</div>
          <div className="text-xs text-ink-500">con la consegna</div>
        </div>
        {bloccanti.length > 0 ? (
          <button
            type="button"
            aria-disabled="true"
            onClick={vaiAlPrimoBlocco}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-primary-700 text-white py-3 rounded-lg font-extrabold text-base aria-disabled:opacity-50 aria-disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
          >
            <AlertCircle size={16} strokeWidth={2.4} aria-hidden /> {cosaFarePrima}
          </button>
        ) : (
          <Link
            href="/checkout"
            className="flex-1 inline-flex items-center justify-center gap-2 bg-primary-700 hover:bg-primary-800 text-white py-3 rounded-lg font-extrabold text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
          >
            <Lock size={16} strokeWidth={2.4} aria-hidden /> {ETICHETTA_VAI_ALLA_CASSA}
          </Link>
        )}
      </div>
    </div>
  );
}
