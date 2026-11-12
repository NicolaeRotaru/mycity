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

const ORA = /^\d{1,2}:\d{2}$/;

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
      if (typeof apre !== 'string' || typeof chiude !== 'string' || !ORA.test(apre) || !ORA.test(chiude)) continue;
      specifiche.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: GIORNO_SCHEMA[giorno], opens: apre, closes: chiude });
    }
  }
  return specifiche.length > 0 ? specifiche : undefined;
}
