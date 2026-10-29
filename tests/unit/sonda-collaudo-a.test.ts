import { describe, it, expect } from 'vitest';
import { prezziDelCarrello, type IngressiPrezzo } from '@/lib/ordini/prezzi';
import { compensoTrattenutoCents } from '@/lib/shipping';
const ing = (merci: number[], o: Partial<IngressiPrezzo> = {}): IngressiPrezzo => ({
  gruppi: merci.map((c, i) => ({ sellerId: `negozio-${i}`, subtotalCents: c })),
  coordinateNegozio: () => ({ lat: null, lng: null }),
  consegnaLat: null, consegnaLng: null, pickupInStore: false,
  couponSpedizioneGratis: false, couponScontoCents: 0, consegnaVeloce: false, ...o,
});
describe('sonda collaudo A', () => {
  it('15 + 12 euro: il cliente paga 4 euro e il fattorino prende 4 euro (3 per il giro + 1 per il negozio in piu)', () => {
    const e = prezziDelCarrello(ing([1500, 1200]));
    expect(e.grandDeliveryFeeCents).toBe(400);
    expect(e.gruppi.map((g) => g.riderFeeCents).reduce((s, x) => s + x, 0)).toBe(400);
  });
  it('variante: 15 + 6 euro con la veloce fa 5, la veloce e compresa anche se il negozio piccolo non e il primo', () => {
    expect(prezziDelCarrello(ing([1500, 600], { consegnaVeloce: true })).grandDeliveryFeeCents).toBe(500);
    expect(prezziDelCarrello(ing([600, 1500], { consegnaVeloce: true })).grandDeliveryFeeCents).toBe(500);
  });
  it('fatto logistica.compenso-fattorino (29/10 23:04): 3 euro per il giro e 1 per ogni negozio in piu, anche in contanti', () => {
    // Col contrassegno il fattorino si tiene quello scritto su ogni ordine (rider_fee_cents).
    const giro = (merci: number[], o: Partial<IngressiPrezzo> = {}) =>
      prezziDelCarrello(ing(merci, o)).gruppi.reduce(
        (s, g) => s + compensoTrattenutoCents({ rider_fee_cents: g.riderFeeCents, pickup_in_store: false }),
        0,
      );
    expect(giro([1500])).toBe(300);
    expect(giro([1500, 1200])).toBe(400);
    expect(giro([1500, 1200, 2000])).toBe(500);
    // La veloce e la spesa sotto i 10 euro restano a MyCity: il compenso non cambia.
    expect(giro([500, 600, 700], { consegnaVeloce: true })).toBe(500);
    expect(giro([1500, 1200], { couponSpedizioneGratis: true })).toBe(400);
    // I 3 euro del giro stanno sull'ordine che porta la base della consegna (la spesa piu alta).
    expect(prezziDelCarrello(ing([1200, 1500])).gruppi.map((g) => g.riderFeeCents)).toEqual([100, 300]);
    expect(prezziDelCarrello(ing([1500, 1200], { pickupInStore: true })).gruppi.map((g) => g.riderFeeCents)).toEqual([0, 0]);
  });
});
