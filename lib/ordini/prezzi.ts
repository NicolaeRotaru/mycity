import { compensoRiderCents, shippingCentsFor } from '@/lib/shipping';
import { ripartisciCentesimi, riduciAlTetto } from '@/lib/stripe/ripartizione';
import {
  MARKETPLACE_FEE_BPS,
  PICKUP_DISCOUNT_PERCENT,
  PLATFORM_DELIVERY_FEE_CENTS,
  SPESA_SENZA_SUPPLEMENTO_CENTS,
  SUPPLEMENTO_CONSEGNA_CENTS,
  commissioneCents,
} from '@/lib/constants';

/**
 * Il conto della cassa, in un posto solo.
 *
 * 22/8/2026 — LA CASSA ESISTEVA IN DUE COPIE.
 *
 * Il percorso in contanti e quello con carta rifacevano lo stesso conto, riga
 * per riga: spedizione per negozio, sconto del ritiro, fee di consegna, tetto
 * complessivo sugli sconti, ripartizione delle quote col metodo del resto più
 * grande. Duecento righe di aritmetica sui soldi, scritte due volte.
 *
 * Non è un problema estetico. La storia scritta nei commenti di quelle due
 * rotte dice che almeno tre volte una riparazione è stata fatta da una parte
 * sola: lo sconto senza tetto che produceva ordini a totale negativo, gli
 * arrotondamenti indipendenti che non quadravano col totale addebitato, il
 * compenso del fattorino che una rotta scriveva e l'altra no. Ogni volta il
 * cliente pagava un importo diverso a seconda di come sceglieva di pagare.
 *
 * Qui il conto è uno. Le due rotte restano diverse solo dove lo sono davvero:
 * la carta apre una sessione di pagamento, il contante scrive gli ordini,
 * addebita il credito e sa tornare indietro se qualcosa si rompe.
 *
 * La prova che tiene questa cosa in vita sta in
 * `tests/unit/la-cassa-fa-lo-stesso-conto.test.ts`: dà lo stesso carrello a
 * tutte e due le strade e pretende gli stessi centesimi, voce per voce.
 */

export type GruppoDaPrezzare = {
  sellerId: string;
  /** Il subtotale della merce di questo negozio, già scontato e in centesimi. */
  subtotalCents: number;
};

export type CoordinateNegozio = { lat: number | null; lng: number | null };

export type IngressiPrezzo = {
  gruppi: GruppoDaPrezzare[];
  /** Dove sta il negozio, per la distanza. */
  coordinateNegozio: (sellerId: string) => CoordinateNegozio;
  /** Dove va la spesa. Null = tariffa fissa. */
  consegnaLat: number | null;
  consegnaLng: number | null;
  pickupInStore: boolean;
  /**
   * Il codice «Spedizione gratuita» è applicato? Toglie al cliente la consegna di ogni negozio
   * fin dove la paga la commissione di quel negozio (`consegnaDaPagareCents`): il fattorino resta
   * pagato, e quel compenso lo copre la piattaforma, mai il negozio.
   */
  couponSpedizioneGratis: boolean;
  /** Quanto sconta il coupon, in centesimi, sull'intero carrello. */
  couponScontoCents: number;
  /**
   * La consegna è quella veloce (la fascia «Adesso», `ETICHETTA_ADESSO`)? Obbligatorio, senza un
   * valore di comodo: chi chiama deve dirlo, perché la veloce costa un euro in più. Le rotte lo
   * ricavano dalla fascia salvata sull'ordine con `eConsegnaVeloce` (lib/ordini/consegna-veloce).
   */
  consegnaVeloce: boolean;
};

export type PrezzoDiGruppo = {
  sellerId: string;
  subtotalCents: number;
  shippingCents: number;
  deliveryFeeCents: number;
  /** La tariffa di consegna di questo negozio PRIMA del codice «Spedizione gratuita». */
  tariffaConsegnaCents: number;
  couponPortionCents: number;
  pickupPortionCents: number;
  /** Quello che il cliente paga per questo negozio. Mai sotto zero. */
  totalCents: number;
  /** Il compenso del fattorino per questa consegna. */
  riderFeeCents: number;
};

export type EsitoPrezzo = {
  gruppi: PrezzoDiGruppo[];
  grandSubtotalCents: number;
  grandShippingCents: number;
  pickupDiscountCents: number;
  /** Lo sconto DAVVERO applicato, già limitato al tetto. */
  scontoApplicatoCents: number;
  grandTotalCents: number;
};

/**
 * 27/10/2026 — IL CODICE «SPEDIZIONE GRATUITA» REGALA LA CONSEGNA FIN DOVE LA PAGA L'ORDINE.
 *
 * Al lancio la spedizione è zero e il cliente paga solo la consegna, 3 € per negozio, che pagano il
 * fattorino (3 €). Il codice azzerava solo la spedizione: accettato, segnato come usato, e il cliente
 * pagava come chi non ce l'ha. Il primo rimedio azzerava tutta la consegna, e rompeva i bonifici: con
 * la carta il netto del negozio e il compenso del fattorino escono dallo STESSO addebito
 * (`source_transaction`, lib/stripe/payout.ts), e da un addebito Stripe non versa più di quanto ha
 * incassato. 20 € dal fornaio col codice: incasso 20 €, al negozio 18 €, al fattorino 3 € — 21 € di
 * bonifici su 20. Il secondo falliva, e il giro lo ritentava all'infinito.
 *
 * Adesso il codice toglie al cliente la parte di consegna che la piattaforma può regalare con quello
 * che le resta di quell'ordine (commissione più spedizione): da 30 € di spesa per negozio tutta, a
 * 20 € due euro su tre. Il negozio incassa lo stesso netto, il fattorino lo stesso compenso, e i
 * bonifici non superano mai l'addebito. Pagare il resto col saldo della piattaforma è un'altra
 * scelta, e si farebbe in lib/stripe/payout.ts, non qui.
 * Prova: tests/unit/col-codice-spedizione-gratuita-i-bonifici-stanno-nell-addebito.test.ts.
 */
/**
 * 29/10/2026 — LA TARIFFA DELLA CONSEGNA, IN UN POSTO SOLO.
 *
 * Prima la consegna era 3 € fissi qui dentro, e la regola firmata da Nicola il 29/10 (3 € con la
 * fascia, 4 € sotto i 10 € di spesa o con la veloce, mai più di 4 €) non c'era: su ogni ordine
 * piccolo o veloce MyCity incassava un euro in meno. La soglia guarda la merce di QUEL negozio
 * dopo gli sconti, la stessa base su cui computeOrderSplit calcola la commissione. Il ritiro in
 * negozio non ha consegna. Prova: tests/unit/la-consegna-costa-3-o-4-euro-per-negozio.test.ts.
 */
export function tariffaConsegnaCents(a: {
  pickupInStore: boolean;
  merceCents: number;
  consegnaVeloce: boolean;
}): number {
  if (a.pickupInStore) return 0;
  const supplemento = a.consegnaVeloce || a.merceCents < SPESA_SENZA_SUPPLEMENTO_CENTS;
  return PLATFORM_DELIVERY_FEE_CENTS + (supplemento ? SUPPLEMENTO_CONSEGNA_CENTS : 0);
}

function consegnaDaPagareCents(a: {
  pickupInStore: boolean;
  codiceSpedizioneGratis: boolean;
  /** La tariffa piena di questo negozio (`tariffaConsegnaCents`). */
  tariffaCents: number;
  /** La merce del negozio dopo gli sconti: la base su cui computeOrderSplit calcola la commissione. */
  merceCents: number;
  shippingCents: number;
  riderFeeCents: number;
}): number {
  if (a.pickupInStore) return 0;
  if (!a.codiceSpedizioneGratis) return a.tariffaCents;
  // Il codice toglie solo la parte dei 3 € che toglieva prima; il supplemento resta da pagare
  // (scelta dell'AD del 29/10, scritta in DECISIONI).
  const supplementoCents = Math.max(0, a.tariffaCents - PLATFORM_DELIVERY_FEE_CENTS);
  const restaAllaPiattaforma = commissioneCents(Math.max(0, a.merceCents)) + a.shippingCents;
  return (
    supplementoCents
    + Math.min(PLATFORM_DELIVERY_FEE_CENTS, Math.max(0, a.riderFeeCents - restaAllaPiattaforma))
  );
}

/**
 * Da quanta spesa per negozio il codice «Spedizione gratuita» toglie TUTTA la consegna: quella su
 * cui la commissione basta da sola a pagare il fattorino. Si ricava dai due numeri, non si scrive.
 */
export function spesaPerConsegnaGratisColCodiceCents(): number {
  return Math.ceil((compensoRiderCents({ pickupInStore: false }) * 10000) / MARKETPLACE_FEE_BPS);
}

export function prezziDelCarrello(ing: IngressiPrezzo): EsitoPrezzo {
  const subtotali = ing.gruppi.map((g) => g.subtotalCents);
  const grandSubtotalCents = subtotali.reduce((s, x) => s + x, 0);

  const shippingPerGruppo = ing.gruppi.map((g, i) => {
    const coord = ing.coordinateNegozio(g.sellerId);
    return shippingCentsFor({
      subtotal: subtotali[i] / 100,
      storeLat: coord.lat,
      storeLng: coord.lng,
      deliveryLat: ing.consegnaLat,
      deliveryLng: ing.consegnaLng,
      pickupInStore: ing.pickupInStore,
      freeShipping: ing.couponSpedizioneGratis,
    });
  });
  const grandShippingCents = shippingPerGruppo.reduce((s, x) => s + x, 0);

  const pickupDiscountCents = ing.pickupInStore
    ? Math.round(grandSubtotalCents * (PICKUP_DISCOUNT_PERCENT / 100))
    : 0;

  // Il tetto: lo sconto non può superare quello che c'è da pagare, meno un
  // centesimo. Senza, uno sconto più grande del carrello produce un ordine con
  // totale negativo — cioè un negozio che paga il cliente.
  const tettoScontoCents = Math.max(0, grandSubtotalCents + grandShippingCents - 1);
  const scontiLimitati = riduciAlTetto(ing.couponScontoCents, pickupDiscountCents, tettoScontoCents);

  // Le quote per negozio si calcolano dallo sconto GIÀ limitato, col metodo del
  // resto più grande: così la somma delle quote torna al centesimo con
  // l'importo addebitato. Con arrotondamenti indipendenti non tornava.
  const quoteCoupon = ripartisciCentesimi(scontiLimitati.codice, subtotali);
  const quoteRitiro = ripartisciCentesimi(scontiLimitati.ritiro, subtotali);

  const gruppi: PrezzoDiGruppo[] = ing.gruppi.map((g, i) => {
    const couponPortionCents = quoteCoupon[i];
    const pickupPortionCents = quoteRitiro[i];
    // 27/8/2026 (R008) — Il compenso del fattorino era riscritto qui dentro,
    // con il 300 a mano e la motivazione «non importato da lib/shipping per
    // non creare un giro di dipendenze»: motivazione falsa, questo file
    // importa da lib/shipping dalla prima riga. Due copie della stessa cifra
    // vogliono dire che il giorno in cui cambia una resta indietro.
    const riderFeeCents = compensoRiderCents({ pickupInStore: ing.pickupInStore });
    const merceCents = subtotali[i] - couponPortionCents - pickupPortionCents;
    const tariffaCents = tariffaConsegnaCents({
      pickupInStore: ing.pickupInStore,
      merceCents,
      consegnaVeloce: ing.consegnaVeloce,
    });
    const deliveryFeeCents = consegnaDaPagareCents({
      pickupInStore: ing.pickupInStore,
      codiceSpedizioneGratis: ing.couponSpedizioneGratis,
      tariffaCents,
      merceCents,
      shippingCents: shippingPerGruppo[i],
      riderFeeCents,
    });
    return {
      sellerId: g.sellerId,
      subtotalCents: subtotali[i],
      shippingCents: shippingPerGruppo[i],
      deliveryFeeCents,
      tariffaConsegnaCents: tariffaCents,
      couponPortionCents,
      pickupPortionCents,
      totalCents: Math.max(
        0,
        subtotali[i] + shippingPerGruppo[i] + deliveryFeeCents - couponPortionCents - pickupPortionCents,
      ),
      riderFeeCents,
    };
  });

  return {
    gruppi,
    grandSubtotalCents,
    grandShippingCents,
    pickupDiscountCents,
    scontoApplicatoCents: scontiLimitati.codice + scontiLimitati.ritiro,
    grandTotalCents: gruppi.reduce((s, g) => s + g.totalCents, 0),
  };
}

/**
 * Quanto costa in più la consegna veloce su questo carrello: la differenza fra i due conti veri,
 * non un «+1 €» scritto a mano. Zero quando ogni negozio è già sotto i 10 € (la veloce è compresa).
 */
export function supplementoDellaVeloceCents(ing: Omit<IngressiPrezzo, 'consegnaVeloce'>): number {
  const consegna = (e: EsitoPrezzo) => e.gruppi.reduce((s, g) => s + g.deliveryFeeCents, 0);
  return Math.max(
    0,
    consegna(prezziDelCarrello({ ...ing, consegnaVeloce: true }))
      - consegna(prezziDelCarrello({ ...ing, consegnaVeloce: false })),
  );
}
