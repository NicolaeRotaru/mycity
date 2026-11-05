import { describe, it, expect } from 'vitest';
import { prezziDelCarrello, consegnaDopoLAnnullo, type IngressiPrezzo } from '@/lib/ordini/prezzi';
import { computeOrderSplit } from '@/lib/stripe/client';

/**
 * S01 — prove che mancavano sui prezzi del carrello.
 *  · 2600: il conto della consegna nei carrelli vecchi, con un annullo fatto
 *    senza ricalcolo (i rimasti tengono la consegna di prima), resta fissato.
 *  · 1949: la prova «col codice i bonifici non superano l'addebito» con ingressi
 *    completi: niente NaN che la fa passare per finta.
 */
const ingressi = (merci: number[], o: Partial<IngressiPrezzo> = {}): IngressiPrezzo => ({
  gruppi: merci.map((s, i) => ({ sellerId: `s${i}`, subtotalCents: s })),
  coordinateNegozio: () => ({ lat: null, lng: null }),
  consegnaLat: null,
  consegnaLng: null,
  pickupInStore: false,
  couponSpedizioneGratis: false,
  couponScontoCents: 0,
  consegnaVeloce: false,
  ...o,
});

function carrelloVecchio(merci: number[]) {
  const e = prezziDelCarrello(ingressi(merci));
  // Il primo negozio è stato annullato SENZA ricalcolo: gli altri tengono la consegna di allora.
  return e.gruppi.map((g, i) => ({
    id: `o${i}`, spesaCents: g.subtotalCents, merceCents: g.subtotalCents, shippingCents: g.shippingCents,
    deliveryFeeCents: g.deliveryFeeCents, riderFeeCents: g.riderFeeCents, giaAnnullato: i === 0,
  }));
}

describe('2600 — carrelli vecchi con un annullo fatto senza ricalcolo, poi un secondo annullo', () => {
  it('quattro negozi (15, 12, 20, 9 €): non si sposta niente, chi se ne va rende la sua consegna', () => {
    const c = consegnaDopoLAnnullo({ ordini: carrelloVecchio([1500, 1200, 2000, 900]), annullaId: 'o1', consegnaVeloce: false, pickupInStore: false });
    expect(c).toEqual({
      rimasti: [
        { id: 'o2', deliveryFeeCents: 300, riderFeeCents: 300, deltaCents: 0 },
        { id: 'o3', deliveryFeeCents: 200, riderFeeCents: 100, deltaCents: 0 },
      ],
      annullato: { id: 'o1', deliveryFeeCents: 100, riderFeeCents: 0, deltaCents: 0 },
      differenzaCents: 0,
    });
  });
  it('tre negozi (15, 12, 20 €): lo stesso', () => {
    const c = consegnaDopoLAnnullo({ ordini: carrelloVecchio([1500, 1200, 2000]), annullaId: 'o1', consegnaVeloce: false, pickupInStore: false });
    expect(c).toEqual({
      rimasti: [{ id: 'o2', deliveryFeeCents: 300, riderFeeCents: 300, deltaCents: 0 }],
      annullato: { id: 'o1', deliveryFeeCents: 100, riderFeeCents: 0, deltaCents: 0 },
      differenzaCents: 0,
    });
  });
  it('tre negozi piccoli (8, 6, 7 €): il conto non si riconosce e non si tocca', () => {
    expect(consegnaDopoLAnnullo({ ordini: carrelloVecchio([800, 600, 700]), annullaId: 'o1', consegnaVeloce: false, pickupInStore: false })).toBeNull();
  });
});

describe('1949 — col codice «Spedizione gratuita» i bonifici restano nell addebito, con numeri veri', () => {
  it('da 5 a 40 € di spesa: consegna finita e negozio + fattorino ≤ incassato', () => {
    for (let spesa = 500; spesa <= 4000; spesa += 50) {
      const [g] = prezziDelCarrello(ingressi([spesa], { couponSpedizioneGratis: true })).gruppi;
      expect(Number.isFinite(g.deliveryFeeCents), `consegna non finita a ${spesa}`).toBe(true);
      expect(Number.isFinite(g.totalCents)).toBe(true);
      const { sellerPayoutCents } = computeOrderSplit({ totalCents: g.totalCents, deliveryFeeCents: g.deliveryFeeCents, shippingCents: g.shippingCents });
      expect(sellerPayoutCents + g.riderFeeCents, `bonifici oltre l addebito a ${spesa}`).toBeLessThanOrEqual(g.totalCents);
    }
  });
});
