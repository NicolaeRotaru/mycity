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
 * 28/10/2026, 08:30 — CORREZIONE DI NICOLA: 5 KM, NON 10. «Mi ero sbagliato,
 * la consegna va fatta in un'area di 5 km.» Con 10 la cassa accettava un
 * indirizzo a 8 km: il cliente pagava, e in bici non ci si arriva. Il file si
 * chiamava al-lancio-si-consegna-in-bici-fino-a-10-km: ha cambiato nome e
 * numero insieme alla decisione. Il sito misura in linea d'aria: 5 km in
 * linea d'aria sono circa 6-7 km di strada.
 *
 * Le altre prove della zona (in-cassa-si-sa-subito-fin-dove-consegniamo,
 * una-consegna-a-milano-non-passa-piu-in-cassa) provano il MECCANISMO e usano
 * la costante apposta, quindi restano verdi qualunque sia il numero. Questa
 * prova invece inchioda il NUMERO: se qualcuno riporta il confine a 10 (o a
 * 25) senza una nuova decisione, diventa rossa.
 */

const NEGOZIO_PIACENZA = { lat: 45.0526, lng: 9.6929 };
// Stessa latitudine, spostati verso est: un grado di longitudine a 45° N vale
// circa 78,6 km, quindi 0,0382° ≈ 3 km, 0,1016° ≈ 8 km e 0,1906° ≈ 15 km.
const CASA_A_3_KM = { lat: 45.0526, lng: 9.7311 };
const CASA_A_8_KM = { lat: 45.0526, lng: 9.7945 };
const CASA_A_15_KM = { lat: 45.0526, lng: 9.8835 };
// I punti vicini al confine. Con soli 3 e 8 km una tolleranza nascosta nel confronto (la cassa che
// accetta fino a 7,5) lascerebbe tutto verde. Questi tre stanno a 4,7 · 5,4 · 6,3 km: il primo deve
// passare, gli altri due no.
const CASA_A_4_7_KM = { lat: 45.0526, lng: 9.7527 };
const CASA_A_5_4_KM = { lat: 45.0526, lng: 9.7616 };
const CASA_A_6_3_KM = { lat: 45.0526, lng: 9.7731 };
const fuori = (casa: { lat: number; lng: number }) =>
  fuoriZonaDiConsegna({
    storeLat: NEGOZIO_PIACENZA.lat,
    storeLng: NEGOZIO_PIACENZA.lng,
    deliveryLat: casa.lat,
    deliveryLng: casa.lng,
  });
const km = (casa: { lat: number; lng: number }) =>
  haversineKm(NEGOZIO_PIACENZA.lat, NEGOZIO_PIACENZA.lng, casa.lat, casa.lng);
/** Il punto a `distanza` km dal negozio nella direzione `gradi` (0 = nord, 90 = est), sulla sfera. */
function puntoA(distanza: number, gradi: number): { lat: number; lng: number } {
  const rad = Math.PI / 180;
  const d = distanza / 6371;
  const verso = gradi * rad;
  const lat1 = NEGOZIO_PIACENZA.lat * rad;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(verso));
  const lng2 =
    NEGOZIO_PIACENZA.lng * rad +
    Math.atan2(Math.sin(verso) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 / rad, lng: lng2 / rad };
}

describe('al lancio si consegna in bici fino a 5 km', () => {
  it('il confine deciso è 5 km', () => {
    expect(RAGGIO_CONSEGNA_KM, 'la correzione di Nicola del 28/10 è 5 km (il 27/10 aveva detto 10)').toBe(5);
  });

  it('un indirizzo a 3 km passa', () => {
    expect(fuori(CASA_A_3_KM), 'un indirizzo a 3 km dal negozio risulta fuori zona').toBe(false);
  });

  it('IL CASO DEL 28/10 — un indirizzo a 8 km, che col confine a 10 passava, la cassa non lo accetta più', () => {
    expect(fuori(CASA_A_8_KM), `una consegna a 8 km risulta dentro la zona (raggio: ${RAGGIO_CONSEGNA_KM} km)`).toBe(true);
  });

  it('un indirizzo a 15 km resta fuori', () => {
    expect(fuori(CASA_A_15_KM), `una consegna a 15 km risulta dentro la zona (raggio: ${RAGGIO_CONSEGNA_KM} km)`).toBe(true);
  });

  it('i punti scelti stanno davvero dove dicono (se no la prova sotto non misura niente)', () => {
    expect(km(CASA_A_3_KM)).toBeGreaterThan(2.9);
    expect(km(CASA_A_3_KM)).toBeLessThan(3.1);
    expect(km(CASA_A_4_7_KM)).toBeGreaterThan(4.6);
    expect(km(CASA_A_4_7_KM)).toBeLessThan(4.8);
    expect(km(CASA_A_5_4_KM)).toBeGreaterThan(5.3);
    expect(km(CASA_A_5_4_KM)).toBeLessThan(5.5);
    expect(km(CASA_A_6_3_KM)).toBeGreaterThan(6.2);
    expect(km(CASA_A_6_3_KM)).toBeLessThan(6.5);
    expect(km(CASA_A_8_KM)).toBeGreaterThan(7.9);
    expect(km(CASA_A_8_KM)).toBeLessThan(8.1);
  });

  it('a 4,7 km si consegna ancora', () => {
    expect(fuori(CASA_A_4_7_KM), 'un indirizzo dentro i 5 km risulta fuori zona').toBe(false);
  });

  it('IL TRATTO VICINO AL CONFINE — a 5,4 e a 6,3 km la cassa dice no', () => {
    expect(fuori(CASA_A_5_4_KM), `a 5,4 km la cassa accetta (raggio: ${RAGGIO_CONSEGNA_KM} km)`).toBe(true);
    expect(fuori(CASA_A_6_3_KM), `a 6,3 km la cassa accetta (raggio: ${RAGGIO_CONSEGNA_KM} km)`).toBe(true);
  });

  /*
   * 27/10/2026 (terzo giro) — IL CONFINE VALE IN OGNI DIREZIONE, NON SOLO VERSO EST.
   *
   * Tutti i punti qui sopra stanno alla latitudine del negozio, spostati verso est. Il collaudo ha
   * passato al calcolo la latitudine del negozio al posto di quella della casa — un refuso di una
   * parola — e queste prove restavano verdi: verso est le due latitudini sono uguali. Con quel
   * refuso una casa a nord misurava 0 km, e la cassa la accettava. Qui la casa gira attorno al
   * negozio in otto direzioni, a distanze dentro e fuori dal confine; i punti li calcola la prova
   * sulla sfera, senza usare la funzione che misura la distanza. (28/10: le distanze seguono il
   * confine a 5 km.)
   */
  it('6,3 km a nord la cassa dice no', () => {
    const casa = puntoA(6.3, 0);
    expect(km(casa)).toBeGreaterThan(6.2);
    expect(km(casa)).toBeLessThan(6.4);
    expect(fuori(casa), `una casa 6,3 km a nord risulta dentro la zona (raggio: ${RAGGIO_CONSEGNA_KM} km)`).toBe(true);
  });

  it('in otto direzioni: dentro i 5 km si consegna, oltre no', () => {
    const sbagliati: string[] = [];
    for (const gradi of [0, 45, 90, 135, 180, 225, 270, 315]) {
      // 4,9 e 5,2 stanno a ridosso del confine: una tolleranza nascosta di 200 metri si vede.
      for (const distanza of [0.5, 2, 3.5, 4.6, 4.9, 5.2, 5.6, 8, 13, 60]) {
        const casa = puntoA(distanza, gradi);
        if (Math.abs(km(casa) - distanza) > 0.05) sbagliati.push(`il punto a ${distanza} km verso ${gradi}° ne misura ${km(casa)}`);
        if (fuori(casa) !== distanza > 5) {
          sbagliati.push(`${distanza} km verso ${gradi}°: ${fuori(casa) ? 'fuori zona' : 'dentro la zona'}`);
        }
      }
    }
    expect(sbagliati).toEqual([]);
  });

  it('la stima del viaggio va alla velocità di una bici, non di uno scooter', () => {
    // Una bici in città fa 12-18 km/h: 25 km/h è uno scooter.
    expect(VELOCITA_MEDIA_BICI_KMH).toBeLessThanOrEqual(18);
    // Fino al confine, alla bici più veloce (18 km/h), ci vogliono almeno 17 minuti: il conto a
    // 25 km/h (uno scooter) ne dà 12.
    expect(
      deliveryEtaMinutes(RAGGIO_CONSEGNA_KM, 0),
      'il tempo di viaggio fino al confine è calcolato come se si andasse in scooter',
    ).toBeGreaterThanOrEqual(Math.round((RAGGIO_CONSEGNA_KM / 18) * 60));
  });
});
