import { describe, it, expect } from 'vitest';
import { calcolaTotali } from '@/components/checkout/useTotaliCarrello';
import { prezziDelCarrello } from '@/lib/ordini/prezzi';

/**
 * 22/8/2026 — IL PREZZO A SCHERMO E IL PREZZO ADDEBITATO.
 *
 * Il calcolo dei totali mostrati stava dentro la pagina del checkout, un file
 * da quasi mille righe. Lì dentro non era provabile da solo: si poteva solo
 * leggerlo e sperare che fosse allineato al server.
 *
 * Non è un timore teorico. È già successo che le due formule divergessero, e
 * quando succede il cliente vede un prezzo e ne paga un altro — il difetto più
 * caro da spiegare a chi compra, perché sembra disonestà e non un errore.
 *
 * Adesso il conto è estratto, e questa prova gli dà lo stesso carrello che dà
 * al server, pretendendo lo stesso centesimo. Cambia una delle due formule e
 * torna rossa.
 */

const NEGOZIO_A = { sellerId: 'a', subtotalEuro: 24.5, storeLat: 45.0526, storeLng: 9.6929 };
const NEGOZIO_B = { sellerId: 'b', subtotalEuro: 12.0, storeLat: 45.06, storeLng: 9.7 };
const CASA = { lat: 45.0489, lng: 9.7025 };

function comeIlServer(ing: Parameters<typeof calcolaTotali>[0]) {
  return prezziDelCarrello({
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
}

const CASI: Array<[string, Parameters<typeof calcolaTotali>[0]]> = [
  [
    'un negozio solo, consegna a casa',
    {
      gruppi: [NEGOZIO_A],
      consegnaLat: CASA.lat,
      consegnaLng: CASA.lng,
      pickupInStore: false,
      couponSpedizioneGratis: false,
      couponScontoEuro: 0,
      creditoDisponibileEuro: 0,
    },
  ],
  [
    'due negozi: la spedizione si paga per ciascuno',
    {
      gruppi: [NEGOZIO_A, NEGOZIO_B],
      consegnaLat: CASA.lat,
      consegnaLng: CASA.lng,
      pickupInStore: false,
      couponSpedizioneGratis: false,
      couponScontoEuro: 0,
      creditoDisponibileEuro: 0,
    },
  ],
  [
    'coupon con spedizione gratis',
    {
      gruppi: [NEGOZIO_A, NEGOZIO_B],
      consegnaLat: CASA.lat,
      consegnaLng: CASA.lng,
      pickupInStore: false,
      couponSpedizioneGratis: true,
      couponScontoEuro: 5,
      creditoDisponibileEuro: 0,
    },
  ],
  [
    'ritiro in negozio',
    {
      gruppi: [NEGOZIO_A],
      consegnaLat: CASA.lat,
      consegnaLng: CASA.lng,
      pickupInStore: true,
      couponSpedizioneGratis: false,
      couponScontoEuro: 0,
      creditoDisponibileEuro: 0,
    },
  ],
  [
    'senza coordinate di consegna: tariffa fissa',
    {
      gruppi: [NEGOZIO_A],
      consegnaLat: null,
      consegnaLng: null,
      pickupInStore: false,
      couponSpedizioneGratis: false,
      couponScontoEuro: 0,
      creditoDisponibileEuro: 0,
    },
  ],
  [
    'sopra la soglia della spedizione gratuita',
    {
      gruppi: [{ ...NEGOZIO_A, subtotalEuro: 45 }],
      consegnaLat: CASA.lat,
      consegnaLng: CASA.lng,
      pickupInStore: false,
      couponSpedizioneGratis: false,
      couponScontoEuro: 0,
      creditoDisponibileEuro: 0,
    },
  ],
  [
    'uno sconto più grande del carrello: il totale non va sotto zero',
    {
      gruppi: [{ ...NEGOZIO_A, subtotalEuro: 8 }],
      consegnaLat: CASA.lat,
      consegnaLng: CASA.lng,
      pickupInStore: false,
      couponSpedizioneGratis: false,
      couponScontoEuro: 500,
      creditoDisponibileEuro: 0,
    },
  ],
];

describe('lo schermo e il server fanno lo stesso conto', () => {
  it.each(CASI)('%s', (_nome, ingressi) => {
    const schermo = calcolaTotali(ingressi);
    const server = comeIlServer(ingressi);

    expect(schermo.centesimi.grandTotalCents).toBe(server.grandTotalCents);
    expect(schermo.centesimi.grandSubtotalCents).toBe(server.grandSubtotalCents);
    expect(schermo.centesimi.grandShippingCents).toBe(server.grandShippingCents);
    expect(schermo.centesimi.scontoApplicatoCents).toBe(server.scontoApplicatoCents);
    expect(schermo.centesimi.gruppi.map((g) => g.totalCents)).toEqual(
      server.gruppi.map((g) => g.totalCents),
    );
  });

  it('la somma dei totali per negozio torna al totale generale', () => {
    // È la proprietà che rende possibile addebitare per negozio senza che al
    // cliente manchi o avanzi un centesimo.
    for (const [, ingressi] of CASI) {
      const t = calcolaTotali(ingressi);
      const somma = t.centesimi.gruppi.reduce((s, g) => s + g.totalCents, 0);
      expect(somma).toBe(t.centesimi.grandTotalCents);
    }
  });

  it('il totale non va mai sotto zero, nemmeno con uno sconto enorme', () => {
    const t = calcolaTotali({
      gruppi: [{ ...NEGOZIO_A, subtotalEuro: 5 }],
      consegnaLat: CASA.lat,
      consegnaLng: CASA.lng,
      pickupInStore: false,
      couponSpedizioneGratis: false,
      couponScontoEuro: 1000,
      creditoDisponibileEuro: 0,
    });
    expect(t.totale).toBeGreaterThanOrEqual(0);
    expect(t.totaleFinale).toBeGreaterThanOrEqual(0);
  });

  it('il credito si applica dopo, e mai più del totale', () => {
    const t = calcolaTotali({
      gruppi: [{ ...NEGOZIO_A, subtotalEuro: 10 }],
      consegnaLat: CASA.lat,
      consegnaLng: CASA.lng,
      pickupInStore: false,
      couponSpedizioneGratis: false,
      couponScontoEuro: 0,
      creditoDisponibileEuro: 9999,
    });
    expect(t.creditoApplicato).toBe(t.totale);
    expect(t.totaleFinale).toBe(0);
  });
});
