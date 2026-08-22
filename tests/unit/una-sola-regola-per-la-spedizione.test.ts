import { describe, it, expect } from 'vitest';
import { shippingForEuro, shippingCentsFor } from '@/lib/shipping';
import { FREE_SHIPPING_THRESHOLD, SHIPPING_PER_ORDER, PICKUP_DISCOUNT_PERCENT } from '@/lib/constants';
import { haversineKm, prezzoSpedizioneEuro } from '@/lib/geo';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * #3 — La formula della spedizione era scritta due volte: una in
 * `lib/shipping.ts` (che usa il server quando crea l'ordine) e una dentro la
 * pagina del checkout, con le due costanti — 4,90 e il 10% del ritiro —
 * ricopiate a mano.
 *
 * Due copie della stessa regola sono due regole. Quando divergono, il cliente
 * vede un prezzo e ne paga un altro: è il difetto più costoso da spiegare a chi
 * compra, e il più facile da introdurre (basta cambiarne una).
 *
 * Questa prova mette a confronto la fonte unica con il calcolo «a mano» che
 * stava nella pagina: se qualcuno riscrive la formula da qualche parte e cambia
 * un numero, uno dei due lati si muove e il confronto diventa rosso.
 */

const NEGOZIO = { lat: 45.0526, lng: 9.6934 };   // Piacenza centro
const CASA = { lat: 45.0701, lng: 9.7120 };      // ~2,4 km

describe('la spedizione la calcola un posto solo', () => {
  it('sotto la soglia, senza coordinate, vale la tariffa fissa condivisa', () => {
    const costo = shippingForEuro({
      subtotal: 10, storeLat: null, storeLng: null,
      deliveryLat: null, deliveryLng: null, pickupInStore: false,
    });
    expect(costo).toBe(SHIPPING_PER_ORDER);
  });

  it('sopra la soglia la spedizione è gratis', () => {
    const costo = shippingForEuro({
      subtotal: FREE_SHIPPING_THRESHOLD, storeLat: NEGOZIO.lat, storeLng: NEGOZIO.lng,
      deliveryLat: CASA.lat, deliveryLng: CASA.lng, pickupInStore: false,
    });
    expect(costo).toBe(0);
  });

  it('col ritiro in negozio non si paga consegna', () => {
    expect(shippingForEuro({
      subtotal: 5, storeLat: NEGOZIO.lat, storeLng: NEGOZIO.lng,
      deliveryLat: CASA.lat, deliveryLng: CASA.lng, pickupInStore: true,
    })).toBe(0);
  });

  it('con le coordinate note il prezzo è quello della distanza, allo stesso centesimo', () => {
    const dallaFonteUnica = shippingForEuro({
      subtotal: 12, storeLat: NEGOZIO.lat, storeLng: NEGOZIO.lng,
      deliveryLat: CASA.lat, deliveryLng: CASA.lng, pickupInStore: false,
    });
    // Il calcolo che stava scritto dentro la pagina del checkout.
    const comeFacevaLaPagina = prezzoSpedizioneEuro(haversineKm(NEGOZIO.lat, NEGOZIO.lng, CASA.lat, CASA.lng));
    expect(dallaFonteUnica).toBe(comeFacevaLaPagina);
  });

  it('il coupon «spedizione gratis» azzera anche con le coordinate note', () => {
    expect(shippingForEuro({
      subtotal: 12, storeLat: NEGOZIO.lat, storeLng: NEGOZIO.lng,
      deliveryLat: CASA.lat, deliveryLng: CASA.lng, pickupInStore: false, freeShipping: true,
    })).toBe(0);
  });

  it('i centesimi sono gli euro arrotondati, senza sorprese di virgola', () => {
    const opts = {
      subtotal: 12, storeLat: NEGOZIO.lat, storeLng: NEGOZIO.lng,
      deliveryLat: CASA.lat, deliveryLng: CASA.lng, pickupInStore: false,
    };
    expect(shippingCentsFor(opts)).toBe(Math.round(shippingForEuro(opts) * 100));
  });

  it('lo sconto del ritiro è una costante condivisa, non un numero scritto nella pagina', () => {
    // Il controllo è sulla FORMA, non sul valore: lo sconto deve venire da un
    // posto solo, così cambiarlo è una riga sola. Prima qui c'era scritto 10,
    // e quando Nicola il 20/8 ha messo da parte il ritiro (sconto a 0) questa
    // prova è diventata rossa pur essendo tutto giusto: fissava un numero che
    // non era il punto. Il valore vero lo controlla
    // `ritiro-in-negozio-messo-da-parte.test.ts`, che sa perché è quello.
    expect(typeof PICKUP_DISCOUNT_PERCENT).toBe('number');
    expect(PICKUP_DISCOUNT_PERCENT).toBeGreaterThanOrEqual(0);
    expect(PICKUP_DISCOUNT_PERCENT).toBeLessThanOrEqual(100);
    const pagina = readFileSync(path.join(process.cwd(), 'app/checkout/page.tsx'), 'utf8');
    expect(pagina).toContain('PICKUP_DISCOUNT_PERCENT');
  });
});
