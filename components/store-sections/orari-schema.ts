import { DAY_KEYS, orariImpostati, type HoursInterval } from '@/lib/store-hours';

/**
 * 12/11/2026 (R07-022) — GLI ORARI DEL NEGOZIO NELLO SCHEMA PER GOOGLE.
 *
 * Lo schema `Store` della vetrina non diceva quando il negozio è aperto, anche se gli orari
 * sono già nella prima lettura (store_hours, precaricato col negozio). Qui diventano
 * `openingHoursSpecification` di schema.org: una voce per ogni fascia (la pausa pranzo fa
 * due voci per lo stesso giorno), niente per i giorni chiusi, e niente del tutto quando il
 * negozio non ha mai scritto i suoi orari (meglio tacere che dire «sempre chiuso»).
 */
const GIORNO_SCHEMA: Record<string, string> = {
  mon: 'https://schema.org/Monday',
  tue: 'https://schema.org/Tuesday',
  wed: 'https://schema.org/Wednesday',
  thu: 'https://schema.org/Thursday',
  fri: 'https://schema.org/Friday',
  sat: 'https://schema.org/Saturday',
  sun: 'https://schema.org/Sunday',
};

/**
 * Un orario scritto dal negozio, ripulito: «8:00» → «08:00», «08:00:00» → «08:00».
 * `null` se non è un'ora vera (25:99, testo). «24:00» vale solo come chiusura, e diventa «00:00».
 */
function minuti(ora: unknown, chiusura: boolean): number | null {
  if (typeof ora !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(ora.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (h === 24 && min === 0 && chiusura) return 24 * 60;
  if (h > 23) return null;
  return h * 60 + min;
}
const testo = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

export type SpecificaOrario = {
  '@type': 'OpeningHoursSpecification';
  dayOfWeek: string;
  opens: string;
  closes: string;
};

export function orariPerLoSchema(storeHours: unknown): SpecificaOrario[] | undefined {
  const orari = orariImpostati(storeHours);
  if (!orari) return undefined;
  const specifiche: SpecificaOrario[] = [];
  for (const giorno of DAY_KEYS) {
    const fasce = orari[giorno];
    if (!Array.isArray(fasce)) continue;
    for (const fascia of fasce as HoursInterval[]) {
      const [apre, chiude] = Array.isArray(fascia) ? fascia : [];
      const o = minuti(apre, false);
      let c = minuti(chiude, true);
      if (o === null || c === null) continue;
      // Come l'app (lib/store-hours.ts, intervalloInMinuti): «00:00» in chiusura vuol dire
      // mezzanotte; una fascia invertita per errore (13:00–09:00) o «00:00–00:00» è vuota, e
      // per Google non deve diventare un negozio aperto la notte.
      if (c === 0 && o > 0) c = 24 * 60;
      if (c <= o) continue;
      specifiche.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: GIORNO_SCHEMA[giorno], opens: testo(o), closes: testo(c) });
    }
  }
  return specifiche.length > 0 ? specifiche : undefined;
}
