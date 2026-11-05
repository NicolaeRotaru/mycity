import { romeNow, type HoursInterval } from '@/lib/store-hours';

type Intervallo = HoursInterval;

const minuti = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * 5/11/2026 — «CHIUSO» E «CONSEGNA OGGI» INSIEME, SENZA DIRE QUANDO RIAPRE.
 *
 * Il bollino della consegna segue la cassa (una fascia di oggi ancora possibile), quindi alle 14 un
 * forno aperto 8-13 e 16-19 è «Chiuso» e «Consegna oggi» nello stesso momento: tutte e due vere,
 * ma lette insieme sembrano una contraddizione. Si dice l'ora in cui riapre oggi, se riapre.
 */
export function riapreOggiAlle(intervalli: Intervallo[] | undefined, adesso: Date = romeNow()): string | null {
  if (!Array.isArray(intervalli)) return null;
  const ora = adesso.getHours() * 60 + adesso.getMinutes();
  const prossimo = intervalli
    .filter((i) => Array.isArray(i) && typeof i[0] === 'string' && minuti(i[0]) > ora)
    .sort((a, b) => minuti(a[0]) - minuti(b[0]))[0];
  return prossimo ? prossimo[0] : null;
}

/** La scritta della pillola: «Aperto ora», «Chiuso · riapre alle 16:00», o «Chiuso». */
export function scrittaApertura(aperto: boolean, intervalliDiOggi: Intervallo[] | undefined, adesso?: Date): string {
  if (aperto) return 'Aperto ora';
  const riapre = riapreOggiAlle(intervalliDiOggi, adesso);
  return riapre ? `Chiuso · riapre alle ${riapre}` : 'Chiuso';
}
