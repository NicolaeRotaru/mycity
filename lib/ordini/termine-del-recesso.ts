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

/** La domenica di Pasqua (calendario gregoriano), come [mese 1-12, giorno]. */
function pasqua(anno: number): [number, number] {
  const a = anno % 19;
  const b = Math.floor(anno / 100);
  const c = anno % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mese = Math.floor((h + l - 7 * m + 114) / 31);
  const giorno = ((h + l - 7 * m + 114) % 31) + 1;
  return [mese, giorno];
}

/**
 * I giorni festivi a Piacenza: le feste nazionali (legge 260/1949 e seguenti; dal 2026 anche il
 * 4 ottobre, legge 151/2025), il lunedì dell'Angelo e il patrono della città (Sant'Antonino, 4 luglio).
 */
function festivoAPiacenza(giorno: Date): boolean {
  const anno = giorno.getUTCFullYear();
  const mmgg = giorno.toISOString().slice(5, 10);
  const fisse = ['01-01', '01-06', '04-25', '05-01', '06-02', '07-04', '08-15', '11-01', '12-08', '12-25', '12-26'];
  if (fisse.includes(mmgg)) return true;
  if (anno >= 2026 && mmgg === '10-04') return true;
  const [mese, g] = pasqua(anno);
  const pasquetta = new Date(Date.UTC(anno, mese - 1, g + 1));
  return pasquetta.toISOString().slice(5, 10) === mmgg;
}

/**
 * L'ultimo giorno `AAAA-MM-GG` (a Piacenza) in cui il reso si può ancora chiedere.
 *
 * 21/11/2026 — SE IL QUATTORDICESIMO GIORNO E' SABATO, DOMENICA O FESTA, IL TERMINE SI SPOSTA.
 * Il termine si conta con le regole del regolamento (CEE, Euratom) 1182/71, come chiede la
 * direttiva 2011/83 (considerando 41) da cui viene il Codice del Consumo: se l'ultimo giorno cade
 * di sabato, di domenica o in un giorno festivo, il termine scade alla fine del primo giorno
 * lavorativo dopo. Prima il reso si chiudeva la domenica sera, e il lunedì il cliente lo trovava
 * scaduto.
 */
export function ultimoGiornoDelRecesso(base: Date | string | number): string {
  const [a, m, g] = giornoPiacenza(base).split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, g + GIORNI_DEL_RECESSO));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || festivoAPiacenza(d)) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Vero finché oggi, a Piacenza, non ha superato l'ultimo giorno del recesso. */
export function recessoAperto(base: Date | string | number, ora: Date | string | number = new Date()): boolean {
  return giornoPiacenza(ora) <= ultimoGiornoDelRecesso(base);
}
