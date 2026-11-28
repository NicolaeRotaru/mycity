/**
 * ARMONIA NASCOSTA — la magia (Nicola, 28/11/2026: «deve esserci magia»).
 *
 * I quadrati magici dei pianeti di Cornelio Agrippa (De occulta philosophia, libro II, 1533), cella per
 * cella come nelle edizioni moderne (ricerca del 28/11, docs/ricerca di ad-mycity): ogni riga, colonna e
 * diagonale dà la stessa somma. Nel sito decidono l'ordine in cui le schede si accendono, e il sigillo
 * dell'intenzione si traccia sul quadrato di Saturno, che è anche il Lo Shu cinese. Chi guarda vede solo
 * schede che compaiono una dopo l'altra e un segno sottile.
 *
 * Il quadrato del Sole (6×6) somma 666 in tutto: non si usa mai. Il Sole prende quello di Giove, che è
 * anche il quadrato di Dürer (Melencolia I, 1514) capovolto. I nomi degli spiriti e delle intelligenze
 * che Agrippa lega ai quadrati sono esclusi: qui ci sono solo i numeri.
 */
import type { Pianeta } from './cielo';
import { ammessoVicino, lettereDi, valoreLettera } from './numeri';

/** Saturno, 3×3: lo stesso del Lo Shu cinese. Somma 15. */
const SATURNO = [
  [4, 9, 2],
  [3, 5, 7],
  [8, 1, 6],
];
/** Giove, 4×4. Somma 34. */
const GIOVE = [
  [4, 14, 15, 1],
  [9, 7, 6, 12],
  [5, 11, 10, 8],
  [16, 2, 3, 13],
];
/** Marte, 5×5. Somma 65. */
const MARTE = [
  [11, 24, 7, 20, 3],
  [4, 12, 25, 8, 16],
  [17, 5, 13, 21, 9],
  [10, 18, 1, 14, 22],
  [23, 6, 19, 2, 15],
];
/** Venere, 7×7. Somma 175. */
const VENERE = [
  [22, 47, 16, 41, 10, 35, 4],
  [5, 23, 48, 17, 42, 11, 29],
  [30, 6, 24, 49, 18, 36, 12],
  [13, 31, 7, 25, 43, 19, 37],
  [38, 14, 32, 1, 26, 44, 20],
  [21, 39, 8, 33, 2, 27, 45],
  [46, 15, 40, 9, 34, 3, 28],
];
/** Mercurio, 8×8. Somma 260. */
const MERCURIO = [
  [8, 58, 59, 5, 4, 62, 63, 1],
  [49, 15, 14, 52, 53, 11, 10, 56],
  [41, 23, 22, 44, 45, 19, 18, 48],
  [32, 34, 35, 29, 28, 38, 39, 25],
  [40, 26, 27, 37, 36, 30, 31, 33],
  [17, 47, 46, 20, 21, 43, 42, 24],
  [9, 55, 54, 12, 13, 51, 50, 16],
  [64, 2, 3, 61, 60, 6, 7, 57],
];
/** Luna, 9×9. Somma 369. */
const LUNA = [
  [37, 78, 29, 70, 21, 62, 13, 54, 5],
  [6, 38, 79, 30, 71, 22, 63, 14, 46],
  [47, 7, 39, 80, 31, 72, 23, 55, 15],
  [16, 48, 8, 40, 81, 32, 64, 24, 56],
  [57, 17, 49, 9, 41, 73, 33, 65, 25],
  [26, 58, 18, 50, 1, 42, 74, 34, 66],
  [67, 27, 59, 10, 51, 2, 43, 75, 35],
  [36, 68, 19, 60, 11, 52, 3, 44, 76],
  [77, 28, 69, 20, 61, 12, 53, 4, 45],
];

const QUADRATI: Readonly<Record<Pianeta, number[][]>> = {
  Saturno: SATURNO,
  Giove: GIOVE,
  Marte: MARTE,
  Sole: GIOVE, // il 6×6 del Sole somma 666: escluso
  Venere: VENERE,
  Mercurio: MERCURIO,
  Luna: LUNA,
};

export const quadratoDi = (pianeta: Pianeta): number[][] => QUADRATI[pianeta].map((riga) => [...riga]);

/** La somma magica di un quadrato di ordine n: n(n²+1)/2. */
export const sommaMagica = (n: number): number => (n * (n * n + 1)) / 2;

/** Vero se righe, colonne e le due diagonali danno tutte la somma magica. */
export function eMagico(q: number[][]): boolean {
  const n = q.length;
  const s = sommaMagica(n);
  const somma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  if (q.some((r) => r.length !== n || somma(r) !== s)) return false;
  for (let j = 0; j < n; j++) if (somma(q.map((r) => r[j])) !== s) return false;
  return somma(q.map((r, i) => r[i])) === s && somma(q.map((r, i) => r[n - 1 - i])) === s;
}

/**
 * I ritardi in millisecondi con cui si accendono `quanti` elementi: il rango del quadrato per 89 ms
 * (numero di Fibonacci). Mai un numero vietato: per esempio 666 non può uscire.
 */
export function ritardiDiAccensione(pianeta: Pianeta, quanti: number, passo = 89): number[] {
  return ordineDiAccensione(pianeta, quanti).map((r) => (r === 0 ? 0 : ammessoVicino(r * passo)));
}

/**
 * L'ordine in cui si accendono `quanti` elementi, letti da sinistra a destra e dall'alto in basso:
 * l'elemento i si accende per `rango[i]`-esimo, seguendo i numeri del quadrato del pianeta.
 * Oltre la fine del quadrato si ricomincia, un giro dopo l'altro.
 */
export function ordineDiAccensione(pianeta: Pianeta, quanti: number): number[] {
  const piatto = QUADRATI[pianeta].flat();
  const giro = piatto.length;
  const chiavi = Array.from({ length: Math.max(0, quanti) }, (_, i) => piatto[i % giro] + giro * Math.floor(i / giro));
  const ordinati = [...chiavi].map((k, i) => [k, i] as const).sort((a, b) => a[0] - b[0]);
  const rango = Array<number>(chiavi.length).fill(0);
  ordinati.forEach(([, i], pos) => { rango[i] = pos; });
  return rango;
}

export type Sigillo = {
  /** Le lettere usate: senza vocali e senza ripetizioni, come nel metodo dei sigilli. */
  lettere: string;
  /** I punti del tracciato sul quadrato 3×3, in un riquadro da 0 a 100. */
  punti: Array<readonly [number, number]>;
  /** Il tracciato SVG (viewBox 0 0 100 100): un cerchietto all'inizio, la linea, una barra alla fine. */
  tracciato: string;
};

/**
 * Il sigillo di un'intenzione, tracciato sul quadrato di Saturno.
 * Ogni lettera diventa il suo numero (da 1 a 9), ogni numero è una casella del Lo Shu:
 * la linea passa da una casella all'altra. «Clienti felici ogni giorno» dà sempre lo stesso segno.
 */
export function sigillo(intenzione: string): Sigillo {
  const viste = new Set<string>();
  const lettere = [...lettereDi(intenzione)].filter((l) => !'AEIOU'.includes(l) && !viste.has(l) && viste.add(l)).join('');
  const casella = new Map<number, readonly [number, number]>();
  SATURNO.forEach((riga, r) => riga.forEach((v, c) => casella.set(v, [c * 40 + 10, r * 40 + 10] as const)));
  const punti: Array<readonly [number, number]> = [];
  for (const l of lettere) {
    const p = casella.get(valoreLettera(l))!;
    const ultimo = punti[punti.length - 1];
    if (!ultimo || ultimo[0] !== p[0] || ultimo[1] !== p[1]) punti.push(p);
  }
  if (punti.length === 0) return { lettere, punti, tracciato: '' };
  const [x0, y0] = punti[0];
  let tracciato = `M${x0 + 3} ${y0}A3 3 0 1 0 ${x0 - 3} ${y0}A3 3 0 1 0 ${x0 + 3} ${y0}M${x0} ${y0}`;
  for (const [x, y] of punti.slice(1)) tracciato += `L${x} ${y}`;
  if (punti.length > 1) {
    const [xa, ya] = punti[punti.length - 2];
    const [xb, yb] = punti[punti.length - 1];
    const len = Math.hypot(xb - xa, yb - ya) || 1;
    const nx = (-(yb - ya) / len) * 5;
    const ny = ((xb - xa) / len) * 5;
    const r = (v: number) => Math.round(v * 10) / 10;
    tracciato += `M${r(xb - nx)} ${r(yb - ny)}L${r(xb + nx)} ${r(yb + ny)}`;
  }
  return { lettere, punti, tracciato };
}
