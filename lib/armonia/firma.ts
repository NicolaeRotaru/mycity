/**
 * ARMONIA NASCOSTA — la firma di un'attività (Nicola, 28/11/2026).
 *
 * Dal nome e dalla data nasce la firma: il numero, il segno, l'elemento, il pianeta, il colore
 * secondario, la forma, i tempi, il motivo di sfondo e il sigillo. È sempre la stessa per lo stesso
 * nome e la stessa data, e due attività diverse hanno quasi sempre firme diverse.
 *
 * La data: quella di apertura se la conosciamo, altrimenti il giorno in cui l'attività si è iscritta a
 * MyCity (non cambia mai: mai «oggi», o la bozza cambierebbe faccia ogni giorno). Senza nessuna data si
 * usa Mercurio, il dio del commercio e dei viaggiatori: è la scelta ragionata per un mercato che consegna.
 * Il numero è quello della tabella detta pitagorica (A=1 … I=9), che in realtà è moderna (scuola di
 * L. Dow Balliett, primi del Novecento): lo dichiariamo, e non lo spacciamo per antico.
 *
 * Il colore principale del marchio NON lo decide la firma: la firma dà solo il secondo tono.
 */
import { numerologia, ammessoVicino, seme as semeDi } from './numeri';
import { ELEMENTI, PIANETI, SEGNI, elementoCinese, giornoAPiacenza, segnoDi, type Elemento, type ElementoCinese, type Pianeta, type Segno } from './cielo';
import { motivoPerFirma } from './simboli';
import { sigillo } from './quadrati';
import type { Motivo } from './forme';
import type { CSSProperties } from 'react';

/** Il colore di ogni numero, dall'1 rosso al 9 oro, e la sua parola. */
export const TONI: Readonly<Record<number, { h: number; s: number; parola: string }>> = {
  1: { h: 4, s: 68, parola: 'inizio e guida' },
  2: { h: 26, s: 72, parola: 'accordo e coppia' },
  3: { h: 50, s: 78, parola: 'creatività e parola' },
  4: { h: 142, s: 45, parola: 'stabilità e mestiere' },
  5: { h: 198, s: 65, parola: 'movimento e scambio' },
  6: { h: 228, s: 55, parola: 'cura e casa' },
  7: { h: 272, s: 45, parola: 'ricerca e qualità' },
  8: { h: 330, s: 55, parola: 'abbondanza e lavoro' },
  9: { h: 42, s: 58, parola: 'compimento e comunità' },
};

export type Firma = {
  nome: string;
  numero: number;
  maestro: 11 | 22 | 33 | null;
  calcolo: number[];
  segno: Segno | null;
  elemento: Elemento;
  pianeta: Pianeta;
  metallo: string;
  coloreMetallo: string;
  /** Il giorno della settimana del pianeta: 0 domenica … 6 sabato. Il giorno dei lanci e del post fisso. */
  giorno: number;
  elementoCinese: ElementoCinese | null;
  tono: { h: number; s: number };
  parola: string;
  /** I lati della forma accanto al nome: 1 cerchio col punto, 2 mandorla, da 3 a 9 un poligono. */
  lati: number;
  /** La durata base delle animazioni, in millisecondi: numero × 111, mosso dall'elemento. */
  durata: number;
  raggio: string;
  peso: number;
  ritmo: string;
  motivo: Motivo;
  seme: number;
  /** Il sigillo dell'intenzione, tracciato SVG in viewBox 0 0 100 100. */
  sigillo: string;
};

/** Una data «AAAA-MM-GG» o un Date, portata a mezzogiorno UTC. Null se non è una data. */
function dataDi(d?: string | Date | null): Date | null {
  if (!d) return null;
  // Un Date è un istante: conta il giorno che era a Piacenza in quell'istante, non quello in UTC.
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : dataDi(giornoAPiacenza(d));
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return null;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return Number.isNaN(t.getTime()) || t.getUTCMonth() !== Number(m[2]) - 1 ? null : t;
}

export function firmaDi({ nome, data, intenzione }: { nome: string; data?: string | Date | null; intenzione?: string }): Firma {
  const num = numerologia(nome);
  const numero = num.numero || 9;
  const giornoNascita = dataDi(data);
  const segno = giornoNascita ? segnoDi(giornoNascita) : null;
  const { elemento, pianeta } = segno ? SEGNI[segno] : { elemento: 'aria' as const, pianeta: 'Mercurio' as const };
  const E = ELEMENTI[elemento];
  const P = PIANETI[pianeta];
  const T = TONI[numero];
  return {
    nome,
    numero,
    maestro: num.maestro,
    calcolo: num.passi,
    segno,
    elemento,
    pianeta,
    metallo: P.metallo,
    coloreMetallo: P.colore,
    giorno: P.giorno,
    elementoCinese: giornoNascita ? elementoCinese(giornoNascita) : null,
    tono: { h: T.h, s: T.s },
    parola: T.parola,
    lati: numero,
    durata: ammessoVicino(numero * 111 * E.fattoreTempo),
    raggio: E.raggio,
    peso: E.peso,
    ritmo: E.ritmo,
    motivo: motivoPerFirma(elemento, numero),
    seme: semeDi(`${num.lettere}|${giornoNascita ? giornoNascita.toISOString().slice(0, 10) : ''}`),
    sigillo: sigillo(intenzione ?? `${nome} cresce ogni giorno`).tracciato,
  };
}

/** Le variabili CSS della firma, da mettere nello `style` del contenitore del sito. */
export function tokenCss(f: Firma): CSSProperties {
  const token: Record<`--armonia-${string}`, string> = {
    '--armonia-tono': `hsl(${f.tono.h} ${f.tono.s}% 45%)`,
    '--armonia-metallo': f.coloreMetallo,
    '--armonia-durata': `${f.durata}ms`,
    '--armonia-raggio': f.raggio,
    '--armonia-peso': String(f.peso),
    '--armonia-lati': String(f.lati),
  };
  return token as CSSProperties;
}

/** La firma di MyCity: numero 5 (movimento e scambio). La data di nascita la sceglie Nicola: finché manca, Mercurio. */
export const FIRMA_MYCITY: Firma = firmaDi({ nome: 'MyCity', data: null, intenzione: 'Piacenza compra dai suoi negozi' });
