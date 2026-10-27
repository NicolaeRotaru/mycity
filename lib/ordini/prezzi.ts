import { compensoRiderCents, shippingCentsFor } from '@/lib/shipping';
import { ripartisciCentesimi, riduciAlTetto } from '@/lib/stripe/ripartizione';
import { PICKUP_DISCOUNT_PERCENT, PLATFORM_DELIVERY_FEE_CENTS } from '@/lib/constants';

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
   * Il codice «Spedizione gratuita» è applicato? Toglie al cliente la consegna di ogni negozio:
   * il fattorino resta pagato, e quel compenso lo copre la piattaforma, non il negozio.
   */
  couponSpedizioneGratis: boolean;
  /** Quanto sconta il coupon, in centesimi, sull'intero carrello. */
  couponScontoCents: number;
};

export type PrezzoDiGruppo = {
  sellerId: string;
  subtotalCents: number;
  shippingCents: number;
  deliveryFeeCents: number;
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

  /**
   * 27/10/2026 — IL CODICE «SPEDIZIONE GRATUITA» TOGLIE LA CONSEGNA.
   *
   * Al lancio la spedizione è zero per tutti e il cliente paga solo la consegna, 3 € per negozio.
   * Il codice azzerava soltanto la spedizione: veniva accettato, segnato come usato, e il cliente
   * pagava 23 € su 20 € di spesa, come chi il codice non ce l'ha. Adesso azzera la consegna.
   *
   * Chi paga il regalo: la piattaforma. La consegna è un suo incasso e non entra nel netto del
   * negozio (`computeOrderSplit`), quindi azzerarla qui lascia il negozio com'è. Il compenso del
   * fattorino resta quello di sempre (`riderFeeCents` qui sotto): non dipende dal codice del cliente.
   * La prova è tests/unit/il-codice-spedizione-gratuita-toglie-davvero-la-consegna.test.ts.
   */
  const consegnaDaPagare = ing.pickupInStore || ing.couponSpedizioneGratis ? 0 : PLATFORM_DELIVERY_FEE_CENTS;

  const gruppi: PrezzoDiGruppo[] = ing.gruppi.map((g, i) => {
    const deliveryFeeCents = consegnaDaPagare;
    const couponPortionCents = quoteCoupon[i];
    const pickupPortionCents = quoteRitiro[i];
    return {
      sellerId: g.sellerId,
      subtotalCents: subtotali[i],
      shippingCents: shippingPerGruppo[i],
      deliveryFeeCents,
      couponPortionCents,
      pickupPortionCents,
      totalCents: Math.max(
        0,
        subtotali[i] + shippingPerGruppo[i] + deliveryFeeCents - couponPortionCents - pickupPortionCents,
      ),
      // 27/8/2026 (R008) — Il compenso del fattorino era riscritto qui dentro,
      // con il 300 a mano e la motivazione «non importato da lib/shipping per
      // non creare un giro di dipendenze»: motivazione falsa, questo file
      // importa da lib/shipping dalla prima riga. Due copie della stessa cifra
      // vogliono dire che il giorno in cui cambia una resta indietro.
      riderFeeCents: compensoRiderCents({ pickupInStore: ing.pickupInStore }),
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
