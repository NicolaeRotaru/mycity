/**
 * L'orologio di casa: Piacenza, non Greenwich.
 *
 * Perché esiste questo file. Le pagine dei numeri costruivano le chiavi dei
 * giorni con `new Date().toISOString().slice(0, 10)`, che è sempre la data di
 * Greenwich. D'estate l'Italia è due ore avanti: un ordine delle 00:30 del 4
 * agosto, per quel calcolo, è del 3 agosto. Dalla mezzanotte alle due — che per
 * un marketplace di cibo non è una fascia vuota — le colonne del grafico e i
 * totali del giorno si spostavano di un giorno, e nessuno sapeva perché.
 *
 * La stessa cosa succedeva al voto per il negozio del mese: il browser scriveva
 * una chiave-mese calcolata a Greenwich e il database ne calcolava un'altra col
 * suo fuso. Il primo del mese, di notte, il voto finiva in un mese e la lettura
 * lo cercava nell'altro: non veniva contato.
 *
 * Regola: nessuna chiave di data si costruisce mai con `toISOString()` partendo
 * da un orario locale. Si passa da qui.
 */

export const FUSO_PIACENZA = 'Europe/Rome';

const FORMATO_GIORNO = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO_PIACENZA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const FORMATO_PARTI = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO_PIACENZA,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function aData(d: Date | string | number): Date {
  return d instanceof Date ? d : new Date(d);
}

/** La data `AAAA-MM-GG` di quell'istante a Piacenza. */
export function giornoPiacenza(d: Date | string | number = new Date()): string {
  return FORMATO_GIORNO.format(aData(d));
}

/** Il primo del mese `AAAA-MM-01` di quell'istante a Piacenza. */
export function primoDelMesePiacenza(d: Date | string | number = new Date()): string {
  return `${giornoPiacenza(d).slice(0, 7)}-01`;
}

/** L'ora del giorno (0-23) a Piacenza. */
export function oraPiacenza(d: Date | string | number = new Date()): number {
  const parti = FORMATO_PARTI.formatToParts(aData(d));
  const h = Number(parti.find((p) => p.type === 'hour')?.value ?? '0');
  return h % 24;
}

/** Lo scarto del fuso di Piacenza rispetto a UTC, in minuti, in quell'istante. */
export function scartoFusoMinuti(d: Date | string | number = new Date()): number {
  const istante = aData(d);
  const parti = FORMATO_PARTI.formatToParts(istante);
  const g = (t: string) => Number(parti.find((p) => p.type === t)?.value ?? '0');
  const locale = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
  return Math.round((locale - istante.getTime()) / 60_000);
}

/** Mezzanotte di quel giorno a Piacenza, espressa in UTC. */
export function inizioGiornoPiacenza(giorno: string): Date {
  const [a, m, g] = giorno.split('-').map(Number);
  const mezzanotteUtc = new Date(Date.UTC(a, (m ?? 1) - 1, g ?? 1, 0, 0, 0));
  return new Date(mezzanotteUtc.getTime() - scartoFusoMinuti(mezzanotteUtc) * 60_000);
}

/** Le ultime `n` giornate a Piacenza, dalla più vecchia a oggi. */
export function ultimiGiorniPiacenza(n: number, fine: Date = new Date()): string[] {
  const giorni: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    giorni.push(giornoPiacenza(new Date(fine.getTime() - i * 86_400_000)));
  }
  return giorni;
}
