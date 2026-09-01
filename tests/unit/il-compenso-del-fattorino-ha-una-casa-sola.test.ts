import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 27/8/2026 (R008) — LO STESSO COMPENSO SCRITTO IN DUE POSTI.
 *
 * `lib/constants.ts` dice `COMPENSO_RIDER_CENTS = 300` ed è la casa dichiarata
 * di quel numero. Ma il conto della cassa (`lib/ordini/prezzi.ts`) se lo
 * riscriveva a mano — `return pickupInStore ? 0 : 300;` — con la motivazione
 * «volutamente non importato da lib/shipping per non creare un giro di
 * dipendenze». Motivazione falsa: quel file importa da lib/shipping dalla prima
 * riga.
 *
 * Il danno non era un pagamento sbagliato, perché il campo del conto condiviso
 * non lo leggeva nessuna delle due rotte: era peggio, era un falso senso di
 * sicurezza. Una prova diceva «il compenso c'è» su un numero che non arrivava
 * in nessun ordine, mentre le rotte se lo ricalcolavano per conto loro. Il
 * giorno in cui Nicola cambia il compenso, un pezzo resta indietro e nessuno
 * se ne accorge.
 *
 * Questa prova sposta il numero nella sua casa e pretende che TUTTI lo
 * seguano.
 */

const COMPENSO_DI_PROVA = 777;

vi.mock('@/lib/constants', async (originale) => {
  const vero = await originale<typeof import('@/lib/constants')>();
  return { ...vero, COMPENSO_RIDER_CENTS: COMPENSO_DI_PROVA };
});

beforeEach(() => {
  vi.resetModules();
});

describe('il compenso del fattorino', () => {
  it('nel conto della cassa e quello deciso in lib/constants, non una copia', async () => {
    const { prezziDelCarrello } = await import('@/lib/ordini/prezzi');
    const esito = prezziDelCarrello({
      gruppi: [{ sellerId: 'negozio-1', subtotalCents: 2000 }],
      coordinateNegozio: () => ({ lat: 45.05, lng: 9.69 }),
      consegnaLat: null,
      consegnaLng: null,
      pickupInStore: false,
      couponSpedizioneGratis: false,
      couponScontoCents: 0,
    });
    expect(
      esito.gruppi[0].riderFeeCents,
      'il conto della cassa tiene una sua copia del compenso: cambiarlo in un posto solo non basta piu',
    ).toBe(COMPENSO_DI_PROVA);
  });

  it('e la stessa cifra che dice lib/shipping, che e quella scritta sull ordine', async () => {
    const { prezziDelCarrello } = await import('@/lib/ordini/prezzi');
    const { compensoRiderCents } = await import('@/lib/shipping');
    const esito = prezziDelCarrello({
      gruppi: [{ sellerId: 'negozio-1', subtotalCents: 2000 }],
      coordinateNegozio: () => ({ lat: null, lng: null }),
      consegnaLat: null,
      consegnaLng: null,
      pickupInStore: false,
      couponSpedizioneGratis: false,
      couponScontoCents: 0,
    });
    expect(esito.gruppi[0].riderFeeCents).toBe(compensoRiderCents({ pickupInStore: false }));
  });

  it('sul ritiro in negozio non c e consegna, quindi non c e compenso', async () => {
    const { prezziDelCarrello } = await import('@/lib/ordini/prezzi');
    const esito = prezziDelCarrello({
      gruppi: [{ sellerId: 'negozio-1', subtotalCents: 2000 }],
      coordinateNegozio: () => ({ lat: null, lng: null }),
      consegnaLat: null,
      consegnaLng: null,
      pickupInStore: true,
      couponSpedizioneGratis: false,
      couponScontoCents: 0,
    });
    expect(esito.gruppi[0].riderFeeCents).toBe(0);
  });
});
