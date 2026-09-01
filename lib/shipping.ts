import { COMPENSO_RIDER_CENTS, FREE_SHIPPING_THRESHOLD, SHIPPING_PER_ORDER } from './constants';
import { haversineKm, prezzoSpedizioneEuro } from './geo';

/**
 * Calcolo spedizione per un gruppo (un venditore). FONTE UNICA condivisa tra
 * client (checkout UI) e server (/api/stripe/checkout, /api/orders/cod) così
 * che l'importo mostrato all'utente coincida sempre con quello addebitato.
 *
 * Regole (identiche alla UI originale):
 *  - ritiro in negozio o coupon FREE_SHIPPING → 0
 *  - subtotale ≥ soglia spedizione gratuita → 0
 *  - coordinate negozio+consegna note → tariffa distanza (prezzoSpedizioneEuro)
 *  - altrimenti → tariffa flat di fallback
 *
 * SICUREZZA: il server passa SEMPRE il subtotale e le coordinate ricalcolati
 * dal DB, mai valori provenienti dal client.
 */
export function shippingForEuro(opts: {
  subtotal: number;
  storeLat: number | null;
  storeLng: number | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  pickupInStore: boolean;
  freeShipping?: boolean;
}): number {
  const { subtotal, storeLat, storeLng, deliveryLat, deliveryLng, pickupInStore, freeShipping } = opts;
  if (pickupInStore || freeShipping) return 0;
  if (subtotal >= FREE_SHIPPING_THRESHOLD) return 0;
  if (storeLat && storeLng && deliveryLat && deliveryLng) {
    return prezzoSpedizioneEuro(haversineKm(storeLat, storeLng, deliveryLat, deliveryLng));
  }
  return SHIPPING_PER_ORDER;
}

/** Come shippingForEuro ma restituisce centesimi interi. */
export function shippingCentsFor(opts: Parameters<typeof shippingForEuro>[0]): number {
  return Math.round(shippingForEuro(opts) * 100);
}

/**
 * Quanto va pagato al fattorino per questa consegna, in centesimi.
 *
 * È una cosa diversa da `shippingForEuro`, che dice quanto paga il CLIENTE.
 * Le due venivano confuse: il compenso del fattorino si leggeva dal prezzo di
 * spedizione pagato dal cliente, e sopra la soglia della spedizione gratuita
 * quel prezzo è zero. Risultato: su ogni ordine sopra i 30 euro il fattorino
 * consegnava e non veniva pagato.
 *
 * Poi il compenso è stato staccato dal prezzo pagato dal cliente, ma è rimasto
 * legato alla distanza — e il conto continuava a non tornare, perché con la
 * spedizione gratis l'unica cosa disponibile per pagarlo erano i 3 euro di fee
 * di consegna: oltre i 420 metri non bastavano più.
 *
 * Adesso il compenso è FISSO (Nicola, 20/8/2026). La distanza non c'entra più:
 * la fee di consegna che la piattaforma trattiene copre il compenso da sola,
 * su ogni ordine, anche quando il cliente non paga spedizione.
 *
 * Con il ritiro in negozio non c'è consegna, quindi non c'è compenso.
 */
export function compensoRiderCents(opts: {
  pickupInStore: boolean;
}): number {
  return opts.pickupInStore ? 0 : COMPENSO_RIDER_CENTS;
}

/**
 * Il compenso già deciso per UNA consegna, in euro (#163).
 *
 * `compensoRiderCents` dice quanto SPETTA a un ordine nuovo; questa dice
 * quanto è stato scritto sull'ordine e quindi quanto verrà davvero versato o
 * trattenuto dal contante. Le due cose divergono negli ordini vecchi, e la
 * pagina dei guadagni deve mostrare la seconda.
 *
 * Il ripiego su `shipping_cost` copre le consegne fatte prima della migrazione
 * 111, quando il compenso non aveva una colonna sua: è lo stesso ripiego di
 * `releaseRiderPayout`, così la pagina e il bonifico dicono lo stesso numero.
 *
 * Perché serviva: la pagina sommava `shipping_cost`, cioè quanto ha pagato il
 * CLIENTE per la spedizione. Sopra i 30 euro di spesa quella cifra è zero,
 * mentre il compenso c'è: il fattorino vedeva consegne da 0,00 € e un totale
 * più basso del dovuto — sul numero in base al quale decide se continuare a
 * lavorare con noi.
 */
export function compensoConsegnaEuro(o: {
  rider_fee_cents?: number | null;
  shipping_cost?: number | string | null;
}): number {
  return o.rider_fee_cents != null ? o.rider_fee_cents / 100 : Number(o.shipping_cost || 0);
}

/**
 * Quanto contante il fattorino si TIENE su una consegna pagata alla consegna,
 * in centesimi — e quindi quanto NON deve rimettere.
 *
 * 22/8/2026 — PERCHE' QUESTA FUNZIONE HA CAMBIATO CASA.
 *
 * Lo stesso numero era calcolato in tre posti con tre regole diverse:
 *   · il riquadro dell'incasso del fattorino pre-riempiva il TOTALE del cliente;
 *   · la rotta che registra l'incasso si aspettava il totale MENO il compenso;
 *   · la pagina delle rimesse toglieva la SPEDIZIONE pagata dal cliente, che
 *     sopra i 30 euro e' zero.
 *
 * Il costo: su ogni consegna in contanti partiva l'allarme «l'incasso non
 * quadra» — il 100% di quelle a domicilio, non un caso di bordo. L'allarme
 * antifrode diventava rumore costante, la quadratura giornaliera nasceva rossa
 * per costruzione, e l'amministratore che vedeva lo scarto esitava a confermare
 * la rimessa: finche' non la conferma, il negozio non viene pagato.
 *
 * Adesso e' una definizione sola, in un posto solo. Il ripiego su
 * `shipping_cost` copre le consegne fatte prima della migrazione 111, quando il
 * compenso non aveva una colonna sua. Sul ritiro in negozio non c'e' consegna,
 * quindi non c'e' compenso.
 */
export function compensoTrattenutoCents(o: {
  rider_fee_cents?: number | null;
  shipping_cost?: number | string | null;
  pickup_in_store?: boolean | null;
}): number {
  if (o.pickup_in_store) return 0;
  return o.rider_fee_cents != null
    ? Math.max(0, o.rider_fee_cents)
    : Math.max(0, Math.round(Number(o.shipping_cost ?? 0) * 100));
}

/** Ordine visto dal lato «contanti»: quanto vale e quanto spetta al fattorino. */
type OrdineInContanti = {
  total_price?: number | string | null;
  rider_fee_cents?: number | null;
  shipping_cost?: number | string | null;
  pickup_in_store?: boolean | null;
};

/**
 * 30/8/2026 (R120) — QUANTO SE NE TIENE DAVVERO, E QUANTO RESTA DOVUTO.
 *
 * Sul contrassegno il fattorino non riceve un bonifico: si tiene il compenso
 * dal contante che ha in mano. La regola dava per scontato che il contante ci
 * fosse — e `compensoTrattenutoCents` non guarda affatto il totale dell'ordine.
 *
 * Ma `total_price` e' il totale DOPO lo scomputo del credito MyCity, e in cassa
 * la spunta «usa il credito» e' accesa di default. Con 50 € di credito e un
 * ordine da 22 € in contrassegno l'ordine nasce a zero: il fattorino consegna,
 * non gli mette in mano niente nessuno, e non ha da cosa trattenersi i suoi 3 €.
 * Succedeva anche a meta': residuo 2 €, compenso 3 € → ne perdeva 1.
 *
 * Quello che si tiene e' il MINIMO fra il compenso e il contante; la differenza
 * e' un debito verso di lui, che passa dal giro dei bonifici come gli altri.
 */
export function compensoDalContante(o: OrdineInContanti): {
  /** Quanto riesce a togliersi dal contante che ha in mano. */
  trattenutoCents: number;
  /** Quanto gli resta da versare per bonifico, perche' il contante non bastava. */
  residuoDovutoCents: number;
} {
  const dovutoCents = compensoTrattenutoCents(o);
  const contanteInManoCents = Math.max(0, Math.round(Number(o.total_price ?? 0) * 100));
  const trattenutoCents = Math.min(dovutoCents, contanteInManoCents);
  return { trattenutoCents, residuoDovutoCents: dovutoCents - trattenutoCents };
}

/** Quanto contante deve tornare indietro da una consegna pagata alla consegna. */
export function contanteDaRimettereCents(o: OrdineInContanti): number {
  const contanteInManoCents = Math.max(0, Math.round(Number(o.total_price ?? 0) * 100));
  return contanteInManoCents - compensoDalContante(o).trattenutoCents;
}

/**
 * COSA DICO AL CLIENTE DELLA SPEDIZIONE — la parola derivata dallo stesso numero che paga.
 *
 * ── Il difetto che ha prodotto questa funzione ───────────────────────────────────────────────
 * Nel carrello la parola e il numero avevano due basi diverse. `freeShipping` guardava il totale di
 * TUTTO il carrello (`total >= 30`); `shippingCost` sommava `shippingForEuro` per ogni gruppo-negozio,
 * e quella azzera solo se il subtotale DEL SINGOLO negozio supera la soglia.
 *
 * Il caso, coi numeri veri: 20 € dal fornaio più 15 € dal macellaio fanno 35 €, quindi la riga
 * stampava «Gratis*» — e dentro il totale c'erano 4,90 + 4,90 = **9,80 € di spedizione**, senza una
 * riga che li spiegasse. Il cliente legge «gratis» e paga dieci euro.
 *
 * ── Perché una funzione e non due righe corrette nel carrello ───────────────────────────────
 * Perché la stessa domanda la fanno il carrello, il checkout e la mail di conferma, e la risposta
 * era scritta a mano in ognuno. La regola non è «controlla meglio»: è che la parola deve nascere dal
 * numero, non accanto al numero. Qui non si può dire «gratis» avendo un costo in mano — la funzione
 * riceve il costo e basta.
 *
 * 🟢 Pura: nessuna rete, nessun orologio. Una prova la ESEGUE.
 */
export interface DettoDellaSpedizione {
  /** true SOLO se non si paga niente. Deriva dal costo, non da una soglia riletta a parte. */
  gratis: boolean;
  /** La parola da stampare: «Gratis» oppure l'importo. Mai «Gratis» con un costo in mano. */
  etichetta: string;
  /** La nota da mettere sotto, quando serve. Stringa vuota quando non serve. */
  nota: string;
  /** Il numero, per chi deve sommarlo: è lo stesso da cui viene l'etichetta. */
  costo: number;
}

export function dettoDellaSpedizione(opts: {
  /** Il costo totale della spedizione, già calcolato con `shippingForEuro` per ogni negozio. */
  costo: number;
  /** Quanti negozi ci sono nel carrello: cambia solo la nota, mai la parola. */
  negozi?: number;
  /** Come si scrive un importo. Iniettato così questa resta pura e la prova non dipende dal locale. */
  formatta: (euro: number) => string;
}): DettoDellaSpedizione {
  const costo = Number.isFinite(opts.costo) ? Math.max(0, opts.costo) : 0;
  const negozi = Math.max(1, Math.trunc(opts.negozi ?? 1));
  const gratis = costo === 0;

  if (gratis) {
    return {
      gratis: true,
      etichetta: 'Gratis',
      // L'asterisco orfano di prima non spiegava niente: la nota adesso dice la regola per esteso,
      // e compare quando c'è più di un negozio, cioè quando la soglia si applica a ciascuno.
      nota: negozi > 1 ? `Gratis sopra i ${FREE_SHIPPING_THRESHOLD} € di spesa nello stesso negozio` : '',
      costo: 0,
    };
  }

  return {
    gratis: false,
    etichetta: opts.formatta(costo),
    nota:
      negozi > 1
        ? `${negozi} negozi: la soglia dei ${FREE_SHIPPING_THRESHOLD} € vale per ciascuno`
        : `Gratis sopra i ${FREE_SHIPPING_THRESHOLD} € di spesa`,
    costo,
  };
}
