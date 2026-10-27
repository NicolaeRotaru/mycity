import { COMPENSO_RIDER_CENTS } from './constants';

/** Gli ingressi del conto della spedizione di un gruppo (un negozio). */
export type IngressiSpedizione = {
  subtotal: number;
  storeLat: number | null;
  storeLng: number | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  pickupInStore: boolean;
  freeShipping?: boolean;
};

/**
 * La spedizione che il cliente paga per un gruppo (un negozio) OLTRE alla consegna. FONTE UNICA:
 * la usano la cassa e, attraverso `prezziDelCarrello`, le due rotte che creano l'ordine, così
 * l'importo mostrato coincide sempre con quello addebitato.
 *
 * 27/10/2026 — DA OGGI È ZERO, SEMPRE.
 *
 * Qui c'erano la soglia dei 30 euro per negozio e la tariffa a distanza (2,50 € più 1,20 € al
 * chilometro, 4,90 € senza coordinate). Sotto i 30 euro il cliente pagava quella spedizione PIÙ i
 * 3 euro di consegna: 20 euro di spesa a 5 km facevano 11,50 € di consegna. Nicola ha firmato
 * un'altra promessa (scelta 8 della carta #209, 26/10): il cliente paga solo la consegna,
 * `PLATFORM_DELIVERY_FEE_CENTS` per negozio, sempre — la aggiunge `prezziDelCarrello` — e col
 * ritiro in negozio niente. La prova è tests/unit/al-lancio-si-paga-solo-la-consegna.test.tsx.
 *
 * La funzione resta perché è il punto unico da cui passa la spedizione: la colonna
 * `shipping_cost` dell'ordine e la riga «Spedizione» di Stripe nascono da qui. Se un giorno
 * tornasse una spedizione a pagamento, torna qui e da nessun'altra parte. Gli ingressi restano
 * quelli di prima perché li passano già tutti i chiamanti.
 *
 * ⚠️ Un codice «spedizione gratis» adesso non toglie niente: la consegna resta. Se debba azzerare
 * anche i 3 euro, che pagano il fattorino, è una scelta di soldi e non di codice.
 */
export function shippingForEuro(_opts: IngressiSpedizione): number {
  return 0;
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
