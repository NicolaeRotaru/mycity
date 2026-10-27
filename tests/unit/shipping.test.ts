import { describe, it, expect } from 'vitest';
import { shippingForEuro, shippingCentsFor } from '@/lib/shipping';

/**
 * Unit test puri per lib/shipping — FONTE UNICA del costo di spedizione,
 * condivisa tra checkout UI e gli endpoint server (sicurezza H1: il server
 * ricalcola sempre l'importo, mai dal client). Senza network / DB.
 */

const PC = { lat: 45.0526, lng: 9.6929 }; // Piacenza centro
const FAR = { lat: 45.07, lng: 9.72 };

describe('shippingForEuro', () => {
  it('è 0 per ritiro in negozio (anche sotto soglia)', () => {
    expect(
      shippingForEuro({
        subtotal: 10,
        storeLat: PC.lat,
        storeLng: PC.lng,
        deliveryLat: FAR.lat,
        deliveryLng: FAR.lng,
        pickupInStore: true,
      }),
    ).toBe(0);
  });

  it('è 0 con coupon free shipping', () => {
    expect(
      shippingForEuro({
        subtotal: 10,
        storeLat: PC.lat,
        storeLng: PC.lng,
        deliveryLat: FAR.lat,
        deliveryLng: FAR.lng,
        pickupInStore: false,
        freeShipping: true,
      }),
    ).toBe(0);
  });

  it('è 0 anche con 30 euro di spesa', () => {
    expect(
      shippingForEuro({
        subtotal: 30,
        storeLat: PC.lat,
        storeLng: PC.lng,
        deliveryLat: FAR.lat,
        deliveryLng: FAR.lng,
        pickupInStore: false,
      }),
    ).toBe(0);
  });

  // 27/10/2026 — Scelta 8 della carta #209: si paga solo la consegna, per negozio. La tariffa a
  // distanza (2,50 € + 1,20 €/km) e quella fissa senza coordinate (4,90 €) non esistono più.
  it('con le coordinate note non parte una tariffa a distanza', () => {
    const expected = 0;
    expect(
      shippingForEuro({
        subtotal: 10,
        storeLat: PC.lat,
        storeLng: PC.lng,
        deliveryLat: FAR.lat,
        deliveryLng: FAR.lng,
        pickupInStore: false,
      }),
    ).toBe(expected);
  });

  it('senza coordinate non parte una tariffa fissa', () => {
    expect(
      shippingForEuro({
        subtotal: 10,
        storeLat: null,
        storeLng: null,
        deliveryLat: FAR.lat,
        deliveryLng: FAR.lng,
        pickupInStore: false,
      }),
    ).toBe(0);
  });
});

describe('shippingCentsFor', () => {
  it('restituisce centesimi interi', () => {
    const cents = shippingCentsFor({
      subtotal: 10,
      storeLat: null,
      storeLng: null,
      deliveryLat: null,
      deliveryLng: null,
      pickupInStore: false,
    });
    expect(cents).toBe(0);
    expect(Number.isInteger(cents)).toBe(true);
  });
});
