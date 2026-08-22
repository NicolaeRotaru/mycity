import { shippingCentsFor } from '@/lib/shipping';
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
  /** Il coupon copre la spedizione? */
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

/** Il compenso del fattorino: fisso, e zero sul ritiro in negozio. */
function compensoFattorinoCents(pickupInStore: boolean): number {
  // Volutamente non importato da lib/shipping per non creare un giro di
  // dipendenze fra i due file: è una costante, non una regola che cambia.
  return pickupInStore ? 0 : 300;
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
    const deliveryFeeCents = ing.pickupInStore ? 0 : PLATFORM_DELIVERY_FEE_CENTS;
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
      riderFeeCents: compensoFattorinoCents(ing.pickupInStore),
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
