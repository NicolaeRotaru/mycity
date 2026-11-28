/**
 * ARMONIA NASCOSTA — la magia (Nicola, 28/11/2026: «deve esserci magia»).
 *
 * I quadrati magici dei pianeti, quelli di Cornelio Agrippa (1531): ogni riga, colonna e diagonale
 * dà la stessa somma. Nel sito decidono l'ordine in cui le schede si accendono, e il sigillo
 * dell'intenzione si traccia sul quadrato di Saturno, come nella tradizione. Chi guarda vede solo
 * schede che compaiono una dopo l'altra e un segno sottile.
 *
 * Il quadrato del Sole (6×6) somma 666 in tutto: non si usa mai. Il Sole prende quello di Giove.
 */
import type { Pianeta } from './cielo';
import { lettereDi, valoreLettera } from './numeri';

/** Saturno, 3×3: il Lo Shu della tradizione cinese, lo stesso di Agrippa. Somma 15. */
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

/** Quadrato magico di ordine dispari col metodo siamese (de La Loubère). */
function dispari(n: number): number[][] {
  const q = Array.from({ length: n }, () => Array<number>(n).fill(0));
  let r = 0;
  let c = Math.floor(n / 2);
  for (let k = 1; k <= n * n; k++) {
    q[r][c] = k;
    const nr = (r - 1 + n) % n;
    const nc = (c + 1) % n;
    if (q[nr][nc]) r = (r + 1) % n;
    else { r = nr; c = nc; }
  }
  return q;
}

/** Quadrato magico di ordine multiplo di 4. */
function doppiamentePari(n: number): number[][] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      const v = i * n + j + 1;
      const a = i % 4;
      const b = j % 4;
      return a === b || a + b === 3 ? n * n + 1 - v : v;
    }),
  );
}

const QUADRATI: Readonly<Record<Pianeta, number[][]>> = {
  Saturno: SATURNO,
  Giove: GIOVE,
  Marte: MARTE,
  Sole: GIOVE, // il 6×6 del Sole somma 666: escluso
  Venere: dispari(7),
  Mercurio: doppiamentePari(8),
  Luna: dispari(9),
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
