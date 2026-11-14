import type { StoreHours, HoursInterval } from '@/lib/store-hours';

export const DAYS: { key: keyof StoreHours; label: string }[] = [
  { key: 'mon', label: 'Lunedì' },
  { key: 'tue', label: 'Martedì' },
  { key: 'wed', label: 'Mercoledì' },
  { key: 'thu', label: 'Giovedì' },
  { key: 'fri', label: 'Venerdì' },
  { key: 'sat', label: 'Sabato' },
  { key: 'sun', label: 'Domenica' },
];

const minuti = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const orario = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * «00:00» in chiusura vuol dire mezzanotte di quel giorno (lo legge così anche lib/store-hours.ts):
 * un negozio aperto fino a mezzanotte scrive 18:00–00:00. Una regola sola per chi controlla le fasce
 * e per chi propone la prossima (R23-015 correzione: `prossimaFascia` leggeva ancora 00:00 come 0).
 */
const chiusuraInMinuti = (apre: number, chiude: number): number =>
  chiude === 0 && apre > 0 ? 24 * 60 : chiude;

/**
 * 175 — Che cosa non va nelle fasce di un giorno, detto per la riga. Un orario
 * vuoto, una chiusura prima dell'apertura o due fasce sovrapposte facevano
 * risultare il negozio chiuso agli ordini senza nessun avviso.
 */
export function erroreDelleFasce(fasce: HoursInterval[] | undefined): string | null {
  if (!fasce || fasce.length === 0) return null;
  // Un negozio aperto fino a mezzanotte scrive 18:00–00:00 e non deve sentirsi dire che è un errore.
  const lette = fasce.map(([a, c]) => {
    const apre = minuti(a);
    return [apre, chiusuraInMinuti(apre, minuti(c))] as const;
  });
  if (lette.some(([a, c]) => Number.isNaN(a) || Number.isNaN(c))) return 'Scrivi tutti e due gli orari.';
  if (lette.some(([a, c]) => c <= a)) return "L'orario di chiusura deve venire dopo quello di apertura (per chiudere a mezzanotte scrivi 00:00 o 23:59).";
  const ordinate = [...lette].sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < ordinate.length; i++) {
    if (ordinate[i][0] < ordinate[i - 1][1]) return 'Due fasce si sovrappongono.';
  }
  return null;
}

/** Il primo errore della settimana, col giorno: per fermare il salvataggio. */
export function erroreDegliOrari(settimana: StoreHours): string | null {
  for (const d of DAYS) {
    const e = erroreDelleFasce(settimana[d.key]);
    if (e) return `${d.label}: ${e}`;
  }
  return null;
}

/**
 * La fascia nuova parte dopo l'ultima (pausa di tre ore), non sempre dalle 9 alle 13.
 *
 * R23-015 correzione (14/11/2026) — Dopo 18:00–00:00 la chiusura «00:00» si leggeva come 0, e la
 * proposta era 03:00–06:00: una fascia che il controllo accettava, così il negozio risultava aperto e
 * ordinabile dalle 3 alle 6 di notte. Ora 00:00 è mezzanotte anche qui: la proposta resta in fondo
 * alla giornata (22:00–23:59) e il controllo la segnala come sovrapposta, come dopo un 23:00.
 */
export function prossimaFascia(fasce: HoursInterval[] | undefined): HoursInterval {
  const coda = fasce && fasce.length > 0 ? fasce[fasce.length - 1] : undefined;
  const ultima = coda ? chiusuraInMinuti(minuti(coda[0]), minuti(coda[1])) : NaN;
  if (Number.isNaN(ultima)) return ['09:00', '13:00'];
  const inizio = Math.min(ultima + 180, 22 * 60);
  return [orario(inizio), orario(Math.min(inizio + 180, 23 * 60 + 59))];
}

