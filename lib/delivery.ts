/**
 * Logica consegna same-day — calcolo del "cutoff" giornaliero.
 *
 * Leva di conversione: urgenza ONESTA. Se ordini prima dell'orario limite
 * (default 18:00) la consegna è oggi; dopo, è domani. Niente countdown finti.
 */

export const DEFAULT_CUTOFF_HOUR = 18;

/** Consegna Express (prodotto a inventario e pronto): stima rider locale. */
export const EXPRESS_ETA_MIN = 30;
export const EXPRESS_ETA_MAX = 60;
export const EXPRESS_ETA_LABEL = `${EXPRESS_ETA_MIN}-${EXPRESS_ETA_MAX} min`;
/** Consegna Standard (spedizione/su ordinazione): fallback onesto. */
export const STANDARD_ETA_LABEL = '2-3 giorni';

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

export type DeliverySpeed = 'express' | 'standard';

export type DeliveryEstimate = {
  /** 'express' = a inventario e pronto (~30-60 min); 'standard' = fallback 2-3 giorni. */
  speed: DeliverySpeed;
  /** 'oggi'/'domani' per Express (legato al cutoff); null per Standard. */
  day: 'oggi' | 'domani' | null;
  /** Etichetta breve: 'oggi' | 'domani' | '2-3 giorni'. */
  label: string;
  /** Dettaglio ETA (es. '30-60 min'); presente solo per Express in giornata. */
  etaLabel?: string;
};

/**
 * Consegna a due velocità — promessa ONESTA in base alla disponibilità.
 *
 * Se il prodotto è a inventario ed è pronto (`available`), il rider locale
 * consegna in giornata (Express, ~30-60 min) entro il cutoff, domani dopo.
 * Altrimenti la promessa è lo Standard 2-3 giorni. Funzione pura, testabile.
 */
export function deliveryEstimate({
  available,
  nowMs,
  cutoffHour = DEFAULT_CUTOFF_HOUR,
}: {
  available: boolean;
  nowMs: number;
  cutoffHour?: number;
}): DeliveryEstimate {
  if (!available) {
    return { speed: 'standard', day: null, label: STANDARD_ETA_LABEL };
  }
  const win = deliveryWindow(nowMs, cutoffHour);
  if (win.beforeCutoff) {
    return { speed: 'express', day: 'oggi', label: 'oggi', etaLabel: EXPRESS_ETA_LABEL };
  }
  return { speed: 'express', day: 'domani', label: 'domani' };
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
