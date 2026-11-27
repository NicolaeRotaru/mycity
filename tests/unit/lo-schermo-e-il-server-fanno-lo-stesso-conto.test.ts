import { describe, it, expect } from 'vitest';
import { riepilogoDaMostrare, type IngressiRiepilogo } from '@/lib/ordini/riepilogo-cassa';
import { prezziDelCarrello } from '@/lib/ordini/prezzi';

/**
 * 22/8/2026 — IL PREZZO A SCHERMO E IL PREZZO ADDEBITATO.
 *
 * Non è un timore teorico. È già successo che le due formule divergessero, e
 * quando succede il cliente vede un prezzo e ne paga un altro — il difetto più
 * caro da spiegare a chi compra, perché sembra disonestà e non un errore.
 *
 * Questa prova dà alla cassa lo stesso carrello che dà al server, pretendendo
 * lo stesso centesimo. Cambia una delle due formule e torna rossa.
 *
 * 26/11/2026 (R09-006) — LA PROVA GUARDA IL CONTO CHE LA CASSA USA DAVVERO.
 * Prima controllava `calcolaTotali` (components/checkout/useTotaliCarrello.ts),
 * una copia del conto che nessuna pagina importa: la cassa (app/checkout/page.tsx)
 * mostra `riepilogoDaMostrare` (lib/ordini/riepilogo-cassa.ts). La copia dava
 * anche un significato diverso alle parole: lì «totale» era prima del credito e
 * il credito entrava anche con la carta. Così la prova restava verde qualunque
 * cosa succedesse allo schermo vero. Adesso le stesse verifiche stanno sul conto
 * della cassa, con il credito come lo applica lei: solo quando si usa
 * (contrassegno), mai più del totale.
 */

const NEGOZIO_A = { sellerId: 'a', subtotalCents: 2450, storeLat: 45.0526, storeLng: 9.6929 };
const NEGOZIO_B = { sellerId: 'b', subtotalCents: 1200, storeLat: 45.06, storeLng: 9.7 };
const CASA = { lat: 45.0489, lng: 9.7025 };

type Negozio = typeof NEGOZIO_A;
type Caso = Omit<IngressiRiepilogo, 'gruppi' | 'coordinateNegozio'> & { negozi: Negozio[] };

/** Gli ingressi del conto, come li costruisce la cassa: un gruppo per negozio, le coordinate dai gruppi. */
function ingressi(c: Caso): IngressiRiepilogo {
  const { negozi, ...resto } = c;
  return {
    ...resto,
    gruppi: negozi.map((g) => ({ sellerId: g.sellerId, subtotalCents: g.subtotalCents })),
    coordinateNegozio: (sellerId) => {
      const g = negozi.find((x) => x.sellerId === sellerId);
      return { lat: g?.storeLat ?? null, lng: g?.storeLng ?? null };
    },
  };
}

const base: Omit<Caso, 'negozi'> = {
  consegnaLat: CASA.lat,
  consegnaLng: CASA.lng,
  pickupInStore: false,
  couponSpedizioneGratis: false,
  couponScontoCents: 0,
  consegnaVeloce: false,
  usaCredito: false,
  creditoDisponibileCents: 0,
};

const CASI: Array<[string, Caso]> = [
  ['un negozio solo, consegna a casa', { ...base, negozi: [NEGOZIO_A] }],
  ['due negozi: la spedizione si paga per ciascuno', { ...base, negozi: [NEGOZIO_A, NEGOZIO_B] }],
  ['coupon con spedizione gratis', { ...base, negozi: [NEGOZIO_A, NEGOZIO_B], couponSpedizioneGratis: true, couponScontoCents: 500 }],
  ['ritiro in negozio', { ...base, negozi: [NEGOZIO_A], pickupInStore: true }],
  ['senza coordinate di consegna: tariffa fissa', { ...base, negozi: [NEGOZIO_A], consegnaLat: null, consegnaLng: null }],
  ['sopra la soglia della spedizione gratuita', { ...base, negozi: [{ ...NEGOZIO_A, subtotalCents: 4500 }] }],
  ['uno sconto più grande del carrello: il totale non va sotto zero', { ...base, negozi: [{ ...NEGOZIO_A, subtotalCents: 800 }], couponScontoCents: 50000 }],
  ['la consegna veloce, con due negozi', { ...base, negozi: [NEGOZIO_A, NEGOZIO_B], consegnaVeloce: true }],
];

const cent = (euro: number) => Math.round(euro * 100);

describe('lo schermo e il server fanno lo stesso conto', () => {
  it.each(CASI)('%s', (_nome, caso) => {
    const schermo = riepilogoDaMostrare(ingressi(caso));
    const server = prezziDelCarrello(ingressi(caso));

    // Senza credito la cifra grossa sul pulsante è esattamente l'addebito.
    expect(cent(schermo.totale)).toBe(server.grandTotalCents);
    expect(cent(schermo.subtotale)).toBe(server.grandSubtotalCents);
    expect(cent(schermo.spedizione)).toBe(server.grandShippingCents);
    expect(cent(schermo.feeConsegna)).toBe(server.gruppi.reduce((s, g) => s + g.deliveryFeeCents, 0));
    expect(cent(schermo.scontoCodice)).toBe(server.gruppi.reduce((s, g) => s + g.couponPortionCents, 0));
    expect(cent(schermo.scontoRitiro)).toBe(server.gruppi.reduce((s, g) => s + g.pickupPortionCents, 0));
    expect(schermo.creditoUsato).toBe(0);
  });

  it('le righe del riepilogo tornano col totale mostrato', () => {
    // È la proprietà che rende il riepilogo verificabile a mano: chi somma le
    // righe davanti al pulsante trova la cifra che paga, al centesimo.
    for (const [, caso] of CASI) {
      for (const credito of [{ usaCredito: false, creditoDisponibileCents: 0 }, { usaCredito: true, creditoDisponibileCents: 700 }]) {
        const t = riepilogoDaMostrare(ingressi({ ...caso, ...credito }));
        const righe = cent(t.subtotale) + cent(t.spedizione) + cent(t.feeConsegna) - cent(t.scontoRitiro) - cent(t.scontoCodice) - cent(t.creditoUsato);
        expect(righe).toBe(cent(t.totale));
      }
    }
  });

  it('il totale non va mai sotto zero, nemmeno con uno sconto enorme', () => {
    const t = riepilogoDaMostrare(ingressi({ ...base, negozi: [{ ...NEGOZIO_A, subtotalCents: 500 }], couponScontoCents: 100000 }));
    expect(t.totale).toBeGreaterThanOrEqual(0);
  });

  it('il credito si applica solo quando si usa (contrassegno), dopo il conto e mai più del totale', () => {
    const caso: Caso = { ...base, negozi: [{ ...NEGOZIO_A, subtotalCents: 1000 }], creditoDisponibileCents: 999900 };
    const addebito = prezziDelCarrello(ingressi(caso)).grandTotalCents;

    const contanti = riepilogoDaMostrare(ingressi({ ...caso, usaCredito: true }));
    expect(cent(contanti.creditoUsato)).toBe(addebito);
    expect(contanti.totale).toBe(0);

    // Con la carta il credito non entra: la cifra resta l'addebito intero.
    const carta = riepilogoDaMostrare(ingressi({ ...caso, usaCredito: false }));
    expect(carta.creditoUsato).toBe(0);
    expect(cent(carta.totale)).toBe(addebito);

    // Un credito più piccolo del conto si toglie tutto, e il resto si paga.
    const poco = riepilogoDaMostrare(ingressi({ ...caso, usaCredito: true, creditoDisponibileCents: 300 }));
    expect(cent(poco.creditoUsato)).toBe(300);
    expect(cent(poco.totale)).toBe(addebito - 300);
  });
});
