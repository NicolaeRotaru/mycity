'use client';

import { useMemo } from 'react';
import { prezziDelCarrello, type EsitoPrezzo } from '@/lib/ordini/prezzi';

/**
 * 22/8/2026 — I TOTALI CHE IL CLIENTE VEDE, CALCOLATI DALLA FUNZIONE DEL SERVER.
 *
 * La pagina del checkout è un file da quasi mille righe che tiene insieme
 * l'indirizzo, la fascia oraria, il coupon, il credito, il ritiro in negozio,
 * le chiamate di pagamento e — in mezzo a tutto questo — il calcolo dei totali
 * mostrati a schermo.
 *
 * Quel calcolo è il pezzo che deve restare allineato al centesimo con il
 * server: se diverge, il cliente vede un prezzo e ne paga un altro. È già
 * successo, ed è il difetto più caro da spiegare a chi compra.
 *
 * Estrarlo qui non è ordine per l'ordine: dentro il file grande non era
 * provabile da solo, e adesso lo è — la prova in
 * `tests/unit/lo-schermo-e-il-server-fanno-lo-stesso-conto.test.ts` dà lo stesso
 * carrello a questo aggancio e alla rotta, e pretende gli stessi centesimi.
 *
 * Non c'è nessuna formula nuova: qui si chiama `prezziDelCarrello`, la stessa
 * identica funzione che il server usa per creare l'ordine.
 */
export type IngressiTotali = {
  gruppi: Array<{ sellerId: string; subtotalEuro: number; storeLat: number | null; storeLng: number | null }>;
  consegnaLat: number | null;
  consegnaLng: number | null;
  pickupInStore: boolean;
  couponSpedizioneGratis: boolean;
  couponScontoEuro: number;
  /** Credito MyCity disponibile, in euro. Zero se non si può usare. */
  creditoDisponibileEuro: number;
};

export type TotaliCarrello = {
  /** I centesimi, che sono la verità: da confrontare col server. */
  centesimi: EsitoPrezzo;
  /** Gli euro, che sono quello che si mostra. */
  subtotale: number;
  spedizione: number;
  costoConsegna: number;
  scontoCoupon: number;
  scontoRitiro: number;
  totale: number;
  creditoApplicato: number;
  totaleFinale: number;
};

export function calcolaTotali(ing: IngressiTotali): TotaliCarrello {
  const centesimi = prezziDelCarrello({
    gruppi: ing.gruppi.map((g) => ({
      sellerId: g.sellerId,
      subtotalCents: Math.round(g.subtotalEuro * 100),
    })),
    coordinateNegozio: (sellerId) => {
      const g = ing.gruppi.find((x) => x.sellerId === sellerId);
      return { lat: g?.storeLat ?? null, lng: g?.storeLng ?? null };
    },
    consegnaLat: ing.consegnaLat,
    consegnaLng: ing.consegnaLng,
    pickupInStore: ing.pickupInStore,
    couponSpedizioneGratis: ing.couponSpedizioneGratis,
    couponScontoCents: Math.round(ing.couponScontoEuro * 100),
  });

  const costoConsegnaCents = centesimi.gruppi.reduce((s, g) => s + g.deliveryFeeCents, 0);
  const scontoCouponCents = centesimi.gruppi.reduce((s, g) => s + g.couponPortionCents, 0);
  const scontoRitiroCents = centesimi.gruppi.reduce((s, g) => s + g.pickupPortionCents, 0);

  // Il credito non entra nel prezzo dell'ordine: è un modo di pagarlo. Per
  // questo si applica DOPO, e mai più del totale.
  const creditoApplicatoCents = Math.min(
    Math.round(ing.creditoDisponibileEuro * 100),
    centesimi.grandTotalCents,
  );

  return {
    centesimi,
    subtotale: centesimi.grandSubtotalCents / 100,
    spedizione: centesimi.grandShippingCents / 100,
    costoConsegna: costoConsegnaCents / 100,
    scontoCoupon: scontoCouponCents / 100,
    scontoRitiro: scontoRitiroCents / 100,
    totale: centesimi.grandTotalCents / 100,
    creditoApplicato: creditoApplicatoCents / 100,
    totaleFinale: Math.max(0, centesimi.grandTotalCents - creditoApplicatoCents) / 100,
  };
}

/** La versione con memoria, per la pagina. Il conto è lo stesso. */
export function useTotaliCarrello(ing: IngressiTotali): TotaliCarrello {
  return useMemo(
    () => calcolaTotali(ing),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      JSON.stringify(ing.gruppi),
      ing.consegnaLat,
      ing.consegnaLng,
      ing.pickupInStore,
      ing.couponSpedizioneGratis,
      ing.couponScontoEuro,
      ing.creditoDisponibileEuro,
    ],
  );
}
