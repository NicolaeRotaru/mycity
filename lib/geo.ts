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

// Stima compenso rider: base + €/km, arrotondato a 0.10
export function riderFee(distanceKm: number): number {
  const BASE = 2.5;
  const PER_KM = 1.2;
  const fee = BASE + Math.max(0, distanceKm) * PER_KM;
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
