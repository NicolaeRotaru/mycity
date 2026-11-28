/**
 * ARMONIA NASCOSTA — il cielo (Nicola, 28/11/2026).
 *
 * L'astrologia usata come regola di progetto e di calendario, mai come segno disegnato:
 * il segno della data dà l'elemento (forme e ritmo), il pianeta dà il materiale dei colori e il
 * giorno della settimana; la luna vera di oggi entra nel sito come un puntino. Dalla tradizione
 * cinese, l'elemento dell'anno (wu xing). Da Piacenza, i sedici settori del cielo degli aruspici
 * etruschi, quelli del Fegato di Piacenza a Palazzo Farnese.
 */

export type Elemento = 'fuoco' | 'terra' | 'aria' | 'acqua';
export type Pianeta = 'Sole' | 'Luna' | 'Mercurio' | 'Venere' | 'Marte' | 'Giove' | 'Saturno';
export type Segno =
  | 'Ariete' | 'Toro' | 'Gemelli' | 'Cancro' | 'Leone' | 'Vergine'
  | 'Bilancia' | 'Scorpione' | 'Sagittario' | 'Capricorno' | 'Acquario' | 'Pesci';

/** Il giorno (mese·100 + giorno) in cui comincia ogni segno, in ordine di calendario. */
const INIZI: ReadonlyArray<readonly [number, Segno]> = [
  [120, 'Acquario'], [219, 'Pesci'], [321, 'Ariete'], [420, 'Toro'], [521, 'Gemelli'], [621, 'Cancro'],
  [723, 'Leone'], [823, 'Vergine'], [923, 'Bilancia'], [1023, 'Scorpione'], [1122, 'Sagittario'], [1222, 'Capricorno'],
];

/** Elemento e pianeta di ogni segno (i reggenti della tradizione classica). */
export const SEGNI: Readonly<Record<Segno, { elemento: Elemento; pianeta: Pianeta }>> = {
  Ariete: { elemento: 'fuoco', pianeta: 'Marte' },
  Toro: { elemento: 'terra', pianeta: 'Venere' },
  Gemelli: { elemento: 'aria', pianeta: 'Mercurio' },
  Cancro: { elemento: 'acqua', pianeta: 'Luna' },
  Leone: { elemento: 'fuoco', pianeta: 'Sole' },
  Vergine: { elemento: 'terra', pianeta: 'Mercurio' },
  Bilancia: { elemento: 'aria', pianeta: 'Venere' },
  Scorpione: { elemento: 'acqua', pianeta: 'Marte' },
  Sagittario: { elemento: 'fuoco', pianeta: 'Giove' },
  Capricorno: { elemento: 'terra', pianeta: 'Saturno' },
  Acquario: { elemento: 'aria', pianeta: 'Saturno' },
  Pesci: { elemento: 'acqua', pianeta: 'Giove' },
};

/** Il pianeta: il suo giorno della settimana (0 = domenica), il metallo e il colore del metallo. */
export const PIANETI: Readonly<Record<Pianeta, { giorno: number; metallo: string; colore: string }>> = {
  Sole: { giorno: 0, metallo: 'oro', colore: '#c9a24a' },
  Luna: { giorno: 1, metallo: 'argento', colore: '#aeb4bf' },
  Marte: { giorno: 2, metallo: 'ferro', colore: '#9a5b45' },
  Mercurio: { giorno: 3, metallo: 'argento vivo', colore: '#8fa9c4' },
  Giove: { giorno: 4, metallo: 'stagno', colore: '#98a090' },
  Venere: { giorno: 5, metallo: 'rame', colore: '#b87333' },
  Saturno: { giorno: 6, metallo: 'piombo', colore: '#6d727d' },
};

/** L'elemento decide il linguaggio delle forme e il ritmo. */
export const ELEMENTI: Readonly<Record<Elemento, { raggio: string; fattoreTempo: number; peso: number; forme: string; ritmo: string }>> = {
  fuoco: { raggio: '2px', fattoreTempo: 0.618, peso: 700, forme: 'angoli e triangoli', ritmo: 'veloce' },
  terra: { raggio: '4px', fattoreTempo: 1.618, peso: 600, forme: 'forme piene e quadrate', ritmo: 'lento' },
  aria: { raggio: '10px', fattoreTempo: 1, peso: 500, forme: 'linee sottili e cerchi', ritmo: 'leggero' },
  acqua: { raggio: '999px', fattoreTempo: 1.272, peso: 500, forme: 'curve e onde', ritmo: 'morbido' },
};

export const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'] as const;

/** Il segno del sole per una data (si guarda il giorno del calendario, non l'ora). */
export function segnoDi(data: Date): Segno {
  const md = (data.getUTCMonth() + 1) * 100 + data.getUTCDate();
  let segno: Segno = 'Capricorno';
  for (const [inizio, s] of INIZI) if (md >= inizio) segno = s;
  return segno;
}

/** Il wu xing, l'elemento cinese dell'anno. L'anno comincia il 4 febbraio (lichun), come nei Quattro Pilastri. */
export type ElementoCinese = 'legno' | 'fuoco' | 'terra' | 'metallo' | 'acqua';
export function elementoCinese(data: Date): ElementoCinese {
  const md = (data.getUTCMonth() + 1) * 100 + data.getUTCDate();
  const anno = md < 204 ? data.getUTCFullYear() - 1 : data.getUTCFullYear();
  const cifra = ((anno % 10) + 10) % 10;
  return (['metallo', 'metallo', 'acqua', 'acqua', 'legno', 'legno', 'fuoco', 'fuoco', 'terra', 'terra'] as const)[cifra];
}

/** I settori del cielo degli aruspici etruschi, incisi sul bordo del Fegato di Piacenza. */
export const SETTORI_ETRUSCHI = 16;

// ---------- la luna ----------
/** Il mese lunare medio, in giorni. */
export const MESE_LUNARE = 29.530588853;
/** Una luna nuova di riferimento: 6 gennaio 2000, 18:14 UTC. */
const LUNA_NUOVA_RIF = Date.UTC(2000, 0, 6, 18, 14);
const GIORNO_MS = 86_400_000;

/** La fase della luna da 0 a 1: 0 nuova, 0,5 piena. Col mese medio: può sbagliare di qualche ora. */
export function faseLuna(istante: number | Date): number {
  const t = typeof istante === 'number' ? istante : istante.getTime();
  const p = ((t - LUNA_NUOVA_RIF) / GIORNO_MS / MESE_LUNARE) % 1;
  return p < 0 ? p + 1 : p;
}

/** Quanta parte del disco è illuminata, da 0 a 1. */
export const luceLuna = (fase: number): number => (1 - Math.cos(2 * Math.PI * fase)) / 2;

export function nomeFase(fase: number): string {
  if (fase < 0.03 || fase > 0.97) return 'luna nuova';
  if (fase < 0.22) return 'falce crescente';
  if (fase < 0.28) return 'primo quarto';
  if (fase < 0.47) return 'gibbosa crescente';
  if (fase < 0.53) return 'luna piena';
  if (fase < 0.72) return 'gibbosa calante';
  if (fase < 0.78) return 'ultimo quarto';
  return 'falce calante';
}

/** La prossima luna nuova (0) o piena (0,5) dopo `da`. */
export function prossimaLuna(fase: 0 | 0.5, da: number | Date = Date.now()): Date {
  const t = typeof da === 'number' ? da : da.getTime();
  let d = fase - faseLuna(t);
  if (d <= 0) d += 1;
  return new Date(t + d * MESE_LUNARE * GIORNO_MS);
}

/**
 * La parte illuminata della luna come tracciato SVG, centrata in 0,0 con raggio `r`.
 * Crescente: luce a destra; calante: luce a sinistra (come la vediamo da Piacenza).
 */
export function tracciatoLuna(fase: number, r: number): string {
  const k = Math.abs(Math.cos(2 * Math.PI * fase)) * r;
  const n = (x: number) => Math.round(x * 100) / 100;
  if (fase < 0.5) return `M0 ${-r}A${r} ${r} 0 0 1 0 ${r}A${n(k)} ${r} 0 0 ${fase < 0.25 ? 0 : 1} 0 ${-r}Z`;
  return `M0 ${-r}A${r} ${r} 0 0 0 0 ${r}A${n(k)} ${r} 0 0 ${fase < 0.75 ? 0 : 1} 0 ${-r}Z`;
}
