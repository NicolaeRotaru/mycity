import { SPEDIZIONE_BASE_EUR, SPEDIZIONE_PER_KM_EUR } from './constants';
// Distanza haversine tra due coordinate (km)
export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371; // raggio terrestre km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Prezzo della spedizione a distanza: base + €/km, arrotondato a 0,10.
 *
 * 22/8/2026 — SI CHIAMAVA `prezzoSpedizioneEuro`, ED È IL NOME CHE HA FATTO IL DANNO.
 *
 * Questo non è mai stato il compenso del fattorino: è quanto paga il CLIENTE
 * per la spedizione. Il compenso del fattorino è fisso
 * (`COMPENSO_RIDER_CENTS`) e non dipende dalla distanza. Finché le due cose
 * hanno avuto lo stesso nome sono state trattate come la stessa cosa, ed è
 * così che sopra i trenta euro — dove la spedizione è gratis — il fattorino
 * consegnava e non veniva pagato (la storia per esteso in lib/shipping.ts).
 *
 * Un commento che avverte «attenzione al nome» è una toppa: chi legge il nome
 * in fondo a una riga altrove il commento non ce l'ha davanti. Adesso il nome
 * dice quello che la funzione fa.
 */
export function prezzoSpedizioneEuro(distanceKm: number): number {
  const fee = SPEDIZIONE_BASE_EUR + Math.max(0, distanceKm) * SPEDIZIONE_PER_KM_EUR;
  return Math.round(fee * 10) / 10;
}

// Stima tempo consegna (minuti) dalla distanza, considerando velocità media
// urbana di scooter (~25 km/h) + tempo fisso di preparazione (15 min).
export function deliveryEtaMinutes(distanceKm: number, prepMinutes = 15): number {
  const avgKmh = 25;
  const travel = (distanceKm / avgKmh) * 60;
  return Math.round(prepMinutes + travel);
}

// Formatta minuti in "tra X min" o "ore HH:MM"
export function formatEtaWindow(etaMinutes: number, base: Date = new Date()): string {
  const arrival = new Date(base.getTime() + etaMinutes * 60_000);
  const hh = arrival.getHours().toString().padStart(2, '0');
  const mm = arrival.getMinutes().toString().padStart(2, '0');
  if (etaMinutes < 60) return `~${etaMinutes} min (entro le ${hh}:${mm})`;
  return `entro le ${hh}:${mm}`;
}
