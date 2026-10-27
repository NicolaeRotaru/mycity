import { describe, it, expect } from 'vitest';
import { RAGGIO_CONSEGNA_KM, VELOCITA_MEDIA_BICI_KMH } from '@/lib/constants';
import { fuoriZonaDiConsegna } from '@/lib/ordini/zona-di-consegna';
import { deliveryEtaMinutes, haversineKm } from '@/lib/geo';

/**
 * 27/10/2026 — LA CASSA ACCETTAVA CONSEGNE FINO A 25 KM, MA AL LANCIO SI
 * CONSEGNA IN BICI FINO A 10.
 *
 * Decisione di Nicola del 27/10: al lancio le consegne le fa lui, in bici,
 * fino a 10 km dal negozio. Il confine scritto nel codice era ancora 25 km:
 * un cliente a 15-20 km poteva ordinare, pagare in contanti alla consegna e
 * aspettare un fattorino che non sarebbe mai partito. Il primo cliente perso,
 * e un negozio che prepara la merce per niente.
 *
 * Le altre prove della zona (in-cassa-si-sa-subito-fin-dove-consegniamo,
 * una-consegna-a-milano-non-passa-piu-in-cassa) provano il MECCANISMO e usano
 * la costante apposta, quindi restano verdi qualunque sia il numero. Questa
 * prova invece inchioda il NUMERO: se qualcuno riporta il confine a 25 senza
 * una nuova decisione, diventa rossa.
 */

const NEGOZIO_PIACENZA = { lat: 45.0526, lng: 9.6929 };
// Stessa latitudine, spostati verso est: un grado di longitudine a 45° N vale
// circa 78,7 km, quindi 0,1016° ≈ 8 km e 0,1906° ≈ 15 km.
const CASA_A_8_KM = { lat: 45.0526, lng: 9.7945 };
const CASA_A_15_KM = { lat: 45.0526, lng: 9.8835 };
// 27/10 (secondo giro) — I punti vicini al confine. Con soli 8 e 15 km una tolleranza nascosta di
// +4,5 km nel confronto (la cassa che accetta fino a 14,5) lasciava tutto verde. Questi tre stanno
// a 9,6 · 10,6 · 13 km: il primo deve passare, gli altri due no.
const CASA_A_9_6_KM = { lat: 45.0526, lng: 9.8150 };
const CASA_A_10_6_KM = { lat: 45.0526, lng: 9.8277 };
const CASA_A_13_KM = { lat: 45.0526, lng: 9.8582 };
const fuori = (casa: { lat: number; lng: number }) =>
  fuoriZonaDiConsegna({
    storeLat: NEGOZIO_PIACENZA.lat,
    storeLng: NEGOZIO_PIACENZA.lng,
    deliveryLat: casa.lat,
    deliveryLng: casa.lng,
  });
const km = (casa: { lat: number; lng: number }) =>
  haversineKm(NEGOZIO_PIACENZA.lat, NEGOZIO_PIACENZA.lng, casa.lat, casa.lng);

describe('al lancio si consegna in bici fino a 10 km', () => {
  it('il confine deciso è 10 km', () => {
    expect(RAGGIO_CONSEGNA_KM, 'la decisione del 27/10 è 10 km in bici').toBe(10);
  });

  it('un indirizzo a 8 km passa', () => {
    expect(
      fuoriZonaDiConsegna({
        storeLat: NEGOZIO_PIACENZA.lat,
        storeLng: NEGOZIO_PIACENZA.lng,
        deliveryLat: CASA_A_8_KM.lat,
        deliveryLng: CASA_A_8_KM.lng,
      }),
    ).toBe(false);
  });

  it('IL CASO CHE ROMPEVA — un indirizzo a 15 km la cassa non lo accetta più', () => {
    expect(
      fuoriZonaDiConsegna({
        storeLat: NEGOZIO_PIACENZA.lat,
        storeLng: NEGOZIO_PIACENZA.lng,
        deliveryLat: CASA_A_15_KM.lat,
        deliveryLng: CASA_A_15_KM.lng,
      }),
      `una consegna a 15 km risulta dentro la zona (raggio: ${RAGGIO_CONSEGNA_KM} km)`,
    ).toBe(true);
  });

  it('i punti scelti stanno davvero dove dicono (se no la prova sotto non misura niente)', () => {
    expect(km(CASA_A_9_6_KM)).toBeGreaterThan(9.3);
    expect(km(CASA_A_9_6_KM)).toBeLessThan(9.9);
    expect(km(CASA_A_10_6_KM)).toBeGreaterThan(10.3);
    expect(km(CASA_A_10_6_KM)).toBeLessThan(10.9);
    expect(km(CASA_A_13_KM)).toBeGreaterThan(12.7);
    expect(km(CASA_A_13_KM)).toBeLessThan(13.3);
  });

  it('a 9,6 km si consegna ancora', () => {
    expect(fuori(CASA_A_9_6_KM), 'un indirizzo dentro i 10 km risulta fuori zona').toBe(false);
  });

  it('IL TRATTO CHE NESSUNO GUARDAVA — a 10,6 e a 13 km la cassa dice no', () => {
    expect(fuori(CASA_A_10_6_KM), `a 10,6 km la cassa accetta (raggio: ${RAGGIO_CONSEGNA_KM} km)`).toBe(true);
    expect(fuori(CASA_A_13_KM), `a 13 km la cassa accetta (raggio: ${RAGGIO_CONSEGNA_KM} km)`).toBe(true);
  });

  it('la stima del viaggio va alla velocità di una bici, non di uno scooter', () => {
    // Una bici in città fa 12-18 km/h: 25 km/h è uno scooter.
    expect(VELOCITA_MEDIA_BICI_KMH).toBeLessThanOrEqual(18);
    // 10 km in bici non si fanno in 24 minuti (che è il conto a 25 km/h).
    expect(
      deliveryEtaMinutes(RAGGIO_CONSEGNA_KM, 0),
      'il tempo di viaggio fino al confine è calcolato come se si andasse in scooter',
    ).toBeGreaterThanOrEqual(30);
  });
});
