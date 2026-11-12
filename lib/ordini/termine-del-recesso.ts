/**
 * 12/11/2026 (R07-005, R07-006) — IL TERMINE DEL RECESSO SI CONTA A GIORNI DI CALENDARIO.
 *
 * Il server contava blocchi di 24 ore dall'istante della consegna
 * (`(ora - consegna) / 86_400_000 > 14`): il quattordicesimo giorno il reso
 * si chiudeva all'ora esatta della consegna, e col cambio d'ora anche un'ora
 * prima. La pagina invece arrotondava per difetto e lasciava compilare tutto
 * il modulo, IBAN compreso, anche il quindicesimo giorno: poi il server lo
 * rifiutava come scaduto.
 *
 * Il Codice del Consumo dà 14 giorni: conta il giorno, non l'ora. Il reso resta
 * aperto fino alla fine del quattordicesimo giorno dopo quello della consegna,
 * a Piacenza. Pagina e server usano questa stessa funzione, così non possono
 * più dare due risposte diverse.
 */
import { giornoPiacenza } from '@/lib/tempo-piacenza';

export const GIORNI_DEL_RECESSO = 14;

/** L'ultimo giorno `AAAA-MM-GG` (a Piacenza) in cui il reso si può ancora chiedere. */
export function ultimoGiornoDelRecesso(base: Date | string | number): string {
  const [a, m, g] = giornoPiacenza(base).split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, g + GIORNI_DEL_RECESSO));
  return d.toISOString().slice(0, 10);
}

/** Vero finché oggi, a Piacenza, non ha superato l'ultimo giorno del recesso. */
export function recessoAperto(base: Date | string | number, ora: Date | string | number = new Date()): boolean {
  return giornoPiacenza(ora) <= ultimoGiornoDelRecesso(base);
}
