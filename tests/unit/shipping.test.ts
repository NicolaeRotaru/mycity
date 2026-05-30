import { describe, it, expect } from 'vitest';
import { shippingForEuro, shippingCentsFor } from '@/lib/shipping';
import { FREE_SHIPPING_THRESHOLD, SHIPPING_PER_ORDER } from '@/lib/constants';
import { haversineKm, riderFee } from '@/lib/geo';

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

  it('è 0 al raggiungimento della soglia di spedizione gratuita', () => {
    expect(
      shippingForEuro({
        subtotal: FREE_SHIPPING_THRESHOLD,
        storeLat: PC.lat,
        storeLng: PC.lng,
        deliveryLat: FAR.lat,
        deliveryLng: FAR.lng,
        pickupInStore: false,
      }),
    ).toBe(0);
  });

  it('usa la tariffa distanza-based quando le coordinate sono note', () => {
    const expected = riderFee(haversineKm(PC.lat, PC.lng, FAR.lat, FAR.lng));
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

  it('ripiega sulla tariffa flat quando mancano le coordinate', () => {
    expect(
      shippingForEuro({
        subtotal: 10,
        storeLat: null,
        storeLng: null,
        deliveryLat: FAR.lat,
        deliveryLng: FAR.lng,
        pickupInStore: false,
      }),
    ).toBe(SHIPPING_PER_ORDER);
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
    expect(cents).toBe(Math.round(SHIPPING_PER_ORDER * 100));
    expect(Number.isInteger(cents)).toBe(true);
  });
});
