/**
 * Logica consegna same-day — calcolo del "cutoff" giornaliero.
 *
 * Leva di conversione: urgenza ONESTA. Se ordini prima dell'orario limite
 * (default 18:00) la consegna è oggi; dopo, è domani. Niente countdown finti.
 */

export const DEFAULT_CUTOFF_HOUR = 18;

export type DeliveryWindow = {
  /** Sei ancora in tempo per la consegna di oggi? */
  beforeCutoff: boolean;
  /** ISO del prossimo istante limite (oggi alle cutoffHour, o domani). */
  targetIso: string;
  /** 'oggi' se in tempo, altrimenti 'domani'. */
  day: 'oggi' | 'domani';
};

/**
 * Dato un istante `now` (ms), calcola la finestra di consegna.
 * Funzione pura: testabile e condivisa server/client.
 */
export function deliveryWindow(nowMs: number, cutoffHour = DEFAULT_CUTOFF_HOUR): DeliveryWindow {
  const now = new Date(nowMs);
  const cutoffToday = new Date(now);
  cutoffToday.setHours(cutoffHour, 0, 0, 0);

  const beforeCutoff = nowMs < cutoffToday.getTime();

  if (beforeCutoff) {
    return { beforeCutoff: true, targetIso: cutoffToday.toISOString(), day: 'oggi' };
  }

  // Passato il cutoff: il prossimo limite è domani alla stessa ora.
  const cutoffTomorrow = new Date(cutoffToday);
  cutoffTomorrow.setDate(cutoffTomorrow.getDate() + 1);
  return { beforeCutoff: false, targetIso: cutoffTomorrow.toISOString(), day: 'domani' };
}

/** Scompone una distanza in ms in {h, m, s} (mai negativa). */
export function splitDuration(diffMs: number) {
  const diff = Math.max(0, diffMs);
  return {
    h: Math.floor(diff / 3_600_000),
    m: Math.floor((diff % 3_600_000) / 60_000),
    s: Math.floor((diff % 60_000) / 1000),
  };
}
