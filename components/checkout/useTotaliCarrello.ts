'use client';

import { useMemo } from 'react';
import { prezziDelCarrello, type EsitoPrezzo } from '@/lib/ordini/prezzi';

/**
 * ⚠️ 26/11/2026 (R09-006) — QUESTO NON È IL CONTO CHE IL CLIENTE VEDE. NON USARLO.
 *
 * Nessuna pagina importa questo file. La cassa (app/checkout/page.tsx) mostra
 * `riepilogoDaMostrare` (lib/ordini/riepilogo-cassa.ts), ed è lì che si cambia
 * il totale a schermo; la prova «lo schermo fa lo stesso conto del server»
 * (`tests/unit/lo-schermo-e-il-server-fanno-lo-stesso-conto.test.ts`) guarda
 * quello. Le parole qui hanno un altro significato: «totale» è il conto PRIMA
 * del credito (in `riepilogoDaMostrare` è quello dopo), e il credito entra anche
 * con la carta (la cassa lo applica solo al contrassegno). Collegarlo a una
 * pagina cambierebbe il totale mostrato senza che nessuno se ne accorga.
 *
 * Resta solo perché due prove lo importano ancora
 * (`la-consegna-costa-3-o-4-euro-per-negozio.test.ts`,
 * `la-consegna-e-una-sola-per-tutto-il-carrello.test.ts`, che controllano anche
 * `riepilogoDaMostrare`): tolte da lì le righe di `calcolaTotali`, il file si
 * cancella.
 *
 * (22/8/2026 — nato come estrazione del conto dalla pagina del checkout; la
 * pagina poi è passata a `riepilogoDaMostrare` e questa copia è rimasta sola.)
 */
export type IngressiTotali = {
  gruppi: Array<{ sellerId: string; subtotalEuro: number; storeLat: number | null; storeLng: number | null }>;
  consegnaLat: number | null;
  consegnaLng: number | null;
  pickupInStore: boolean;
  couponSpedizioneGratis: boolean;
  couponScontoEuro: number;
  /** La fascia scelta è la veloce («Adesso»)? Obbligatorio: cambia la consegna. */
  consegnaVeloce: boolean;
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
    consegnaVeloce: ing.consegnaVeloce,
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

/** @deprecated Nessuna pagina la usa: la cassa mostra `riepilogoDaMostrare` (lib/ordini/riepilogo-cassa.ts). */
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
      ing.consegnaVeloce,
      ing.creditoDisponibileEuro,
    ],
  );
}
