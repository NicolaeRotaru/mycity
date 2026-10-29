import { VELOCITA_MEDIA_BICI_KMH } from './constants';
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

// 27/10/2026 — Qui c'era `prezzoSpedizioneEuro(km)`: 2,50 € più 1,20 € al chilometro, la
// spedizione a distanza che il cliente pagava sotto i 30 euro, sopra i 3 euro di consegna. Non
// esiste più (scelta 8 della carta #209: si paga solo la consegna, `PLATFORM_DELIVERY_FEE_CENTS`
// per negozio). Tolta, non azzerata: una funzione di prezzo che resta in giro torna in un conto.

// Stima tempo consegna (minuti) dalla distanza: viaggio alla velocità media di
// chi consegna (`VELOCITA_MEDIA_BICI_KMH`, al lancio una bici) + tempo fisso di
// preparazione (15 min). Fino al 27/10/2026 qui c'era uno scooter a 25 km/h.
// Non è la promessa al cliente prima dell'ordine — quella è la fascia che sceglie in cassa, o la
// veloce quando `veloceSiPuo` dice sì — ma il «fra quanti minuti arriva» col fattorino già in strada.
// Al confine dei 5 km (`RAGGIO_CONSEGNA_KM`): 15 di preparazione + 20 in bici = 35 minuti; con
// l'andata del fattorino al negozio (altri 20 al massimo) fanno 55, dentro i 60 della veloce. Col
// vecchio confine di 10 km erano 95. Prova: tests/unit/la-consegna-si-promette-all-ora-che-scegli.test.tsx
export function deliveryEtaMinutes(distanceKm: number, prepMinutes = 15): number {
  const travel = (distanceKm / VELOCITA_MEDIA_BICI_KMH) * 60;
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
