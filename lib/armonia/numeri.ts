/**
 * ARMONIA NASCOSTA — i numeri (Nicola, 28/11/2026).
 *
 * Ogni sito che facciamo, e il marketplace, è costruito su proporzioni e numeri che chi visita non
 * vede: sente solo che il sito è ordinato. Qui stanno la sezione aurea, Fibonacci e la numerologia
 * pitagorica del nome. La regola completa è la skill `armonia` di ad-mycity.
 *
 * Mai sui prezzi, mai nei testi legali: questi numeri decidono misure, quantità e tempi, nient'altro.
 */

/** La sezione aurea: 1,6180339887… */
export const PHI = (1 + Math.sqrt(5)) / 2;

/** I numeri di Fibonacci che usiamo come misure, in pixel. */
export const FIBONACCI = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597] as const;

/** Gli spazi fra gli elementi: 8, 13, 21, 34, 55, 89 px. */
export const SPAZI = [8, 13, 21, 34, 55, 89] as const;

/** I caratteri crescono di PHI: 16, 26, 42, 68 px. */
export const CARATTERI = [0, 1, 2, 3].map((k) => Math.round(16 * PHI ** k)) as readonly number[];

/** La colonna di lettura più larga: 987 px, numero di Fibonacci. */
export const LARGHEZZA_MASSIMA = 987;

/** Testo e foto divisi in sezione aurea, in percento. */
export const COLONNE_AUREE = { grande: 100 / PHI, piccola: 100 - 100 / PHI } as const;

/**
 * Numeri che non compaiono mai in quantità, durate, misure o indirizzi.
 * 14, 18, 88 e 1488 sono codici neonazisti; 666 lo riconoscono tutti; 17 in Italia porta sfortuna.
 */
export const NUMERI_VIETATI: Readonly<Record<number, string>> = {
  14: 'codice neonazista',
  17: 'in Italia porta sfortuna',
  18: 'codice neonazista',
  88: 'codice neonazista',
  666: 'il numero della bestia: lo riconoscono tutti',
  1488: 'codice neonazista',
};

export const numeroAmmesso = (n: number): boolean => !(Math.round(n) in NUMERI_VIETATI);

/** Il primo numero ammesso a partire da `n`, salendo di uno. */
export function ammessoVicino(n: number): number {
  let v = Math.round(n);
  while (!numeroAmmesso(v)) v += 1;
  return v;
}

const sommaCifre = (n: number) => String(n).split('').reduce((a, c) => a + Number(c), 0);

/** Riduce un numero intero positivo a una cifra sola, da 1 a 9. Zero resta zero. */
export function riduci(n: number): number {
  let v = Math.abs(Math.trunc(n));
  while (v > 9) v = sommaCifre(v);
  return v;
}

/** Le lettere che contano: senza accenti, senza spazi, senza segni. «Caffè d'Oro» → «CAFFEDORO». */
export const lettereDi = (testo: string): string =>
  testo.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');

/** Il valore pitagorico di una lettera: A=1 … I=9, J=1 … R=9, S=1 … Z=8. */
export const valoreLettera = (lettera: string): number => ((lettera.charCodeAt(0) - 65) % 9) + 1;

export type Numerologia = {
  lettere: string;
  valori: number[];
  totale: number;
  /** I passaggi della riduzione: 48 → 12 → 3. */
  passi: number[];
  /** 11, 22 o 33 se la riduzione si ferma su un numero maestro, altrimenti null. */
  maestro: 11 | 22 | 33 | null;
  /** Il numero da 1 a 9; 0 se il nome non ha lettere. */
  numero: number;
};

/** La numerologia pitagorica di un nome. «SDG Agenzia» = 48 → 12 → 3; «MyCity» = 32 → 5. */
export function numerologia(nome: string): Numerologia {
  const lettere = lettereDi(nome);
  const valori = [...lettere].map(valoreLettera);
  const totale = valori.reduce((a, b) => a + b, 0);
  const passi = [totale];
  let n = totale;
  while (n > 9 && n !== 11 && n !== 22 && n !== 33) {
    n = sommaCifre(n);
    passi.push(n);
  }
  const maestro = n === 11 || n === 22 || n === 33 ? n : null;
  return { lettere, valori, totale, passi, maestro, numero: riduci(n) };
}

/** Un numero intero stabile da un testo (FNV-1a a 32 bit): lo stesso nome dà sempre lo stesso seme. */
export function seme(testo: string): number {
  let h = 0x811c9dc5;
  for (const c of testo) {
    h ^= c.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
