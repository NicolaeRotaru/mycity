import { describe, it, expect } from 'vitest';
import { RAGGIO_CONSEGNA_KM, VELOCITA_MEDIA_BICI_KMH } from '@/lib/constants';
import { fuoriZonaDiConsegna } from '@/lib/ordini/zona-di-consegna';
import { deliveryEtaMinutes } from '@/lib/geo';

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
