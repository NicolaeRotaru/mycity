/**
 * ARMONIA NASCOSTA — il cielo (Nicola, 28/11/2026).
 *
 * L'astrologia usata come regola di progetto e di calendario, mai come segno disegnato:
 * il segno della data dà l'elemento (forme e ritmo), il pianeta dà il materiale dei colori e il
 * giorno della settimana; la luna vera di oggi entra nel sito come un puntino. Dalla tradizione
 * cinese, l'elemento dell'anno (wu xing). Da Piacenza, i sedici settori del cielo degli aruspici
 * etruschi, quelli del Fegato di Piacenza a Palazzo Farnese.
 *
 * I calcoli seguono Jean Meeus, «Astronomical Algorithms» (ricerca del 28/11, docs/ricerca di
 * ad-mycity): il segno viene dalla longitudine vera del Sole (le date d'ingresso cambiano ogni anno),
 * la luna dall'elongazione vera Luna-Sole (il mese medio sbagliava fino a 14 ore), l'anno cinese dal
 * lichun, il Sole a 315 gradi. Di un negozio si sa il giorno, non l'ora: per convenzione dichiarata
 * si guarda il mezzogiorno di Piacenza, con l'ora legale.
 */

export type Elemento = 'fuoco' | 'terra' | 'aria' | 'acqua';
export type Pianeta = 'Sole' | 'Luna' | 'Mercurio' | 'Venere' | 'Marte' | 'Giove' | 'Saturno';
export type Segno =
  | 'Ariete' | 'Toro' | 'Gemelli' | 'Cancro' | 'Leone' | 'Vergine'
  | 'Bilancia' | 'Scorpione' | 'Sagittario' | 'Capricorno' | 'Acquario' | 'Pesci';

/** I segni in ordine dalla longitudine 0° (equinozio di primavera), trenta gradi ciascuno. */
export const ORDINE_SEGNI: readonly Segno[] = [
  'Ariete', 'Toro', 'Gemelli', 'Cancro', 'Leone', 'Vergine',
  'Bilancia', 'Scorpione', 'Sagittario', 'Capricorno', 'Acquario', 'Pesci',
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

const RAD = Math.PI / 180;
const GIORNO_MS = 86_400_000;
const norm360 = (x: number) => ((x % 360) + 360) % 360;
/** Secoli giuliani dal 1° gennaio 2000 alle 12 TT (Meeus 22.1; la differenza TT-UT, ~70 s, qui non conta). */
const secoliJ2000 = (t: number) => (t / GIORNO_MS + 2440587.5 - 2451545.0) / 36525;

/** Longitudine apparente del Sole in gradi (Meeus cap. 25, precisione ~0,01°). */
export function longitudineSole(t: number): number {
  const T = secoliJ2000(t);
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * RAD;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M)
    + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
  const omega = (125.04 - 1934.136 * T) * RAD;
  return norm360(L0 + C - 0.00569 - 0.00478 * Math.sin(omega));
}

/** Longitudine della Luna in gradi, coi termini maggiori di Meeus cap. 47 (errore sotto ~0,1°). */
export function longitudineLuna(t: number): number {
  const T = secoliJ2000(t);
  const L = 218.3164477 + 481267.88123421 * T;
  const D = (297.8501921 + 445267.1114034 * T) * RAD;
  const M = (357.5291092 + 35999.0502909 * T) * RAD;
  const Mp = (134.9633964 + 477198.8675055 * T) * RAD;
  const F = (93.272095 + 483202.0175233 * T) * RAD;
  return norm360(L
    + 6.288774 * Math.sin(Mp) + 1.274027 * Math.sin(2 * D - Mp) + 0.658314 * Math.sin(2 * D)
    + 0.213618 * Math.sin(2 * Mp) - 0.185116 * Math.sin(M) - 0.114332 * Math.sin(2 * F)
    + 0.058793 * Math.sin(2 * D - 2 * Mp) + 0.057066 * Math.sin(2 * D - M - Mp) + 0.053322 * Math.sin(2 * D + Mp)
    + 0.045758 * Math.sin(2 * D - M) - 0.040923 * Math.sin(M - Mp) - 0.03472 * Math.sin(D)
    - 0.030383 * Math.sin(M + Mp));
}

const oraDiRoma = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23' });
const giornoDiRoma = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });

/** L'istante del mezzogiorno di Piacenza (fuso Europe/Rome, con l'ora legale) di un giorno del calendario. */
export function mezzogiornoDiPiacenza(anno: number, mese: number, giorno: number): number {
  const t = Date.UTC(anno, mese - 1, giorno, 11);
  return t + (12 - Number(oraDiRoma.format(new Date(t)))) * 3_600_000;
}

/** Il giorno del calendario a Piacenza («AAAA-MM-GG») di un istante. */
export const giornoAPiacenza = (istante: Date | number): string => giornoDiRoma.format(new Date(istante));

/** L'istante da guardare per un giorno: il suo mezzogiorno a Piacenza. Il giorno si legge in UTC (le date «AAAA-MM-GG»). */
const istanteDelGiorno = (giorno: Date) => mezzogiornoDiPiacenza(giorno.getUTCFullYear(), giorno.getUTCMonth() + 1, giorno.getUTCDate());

/** Il segno del Sole di un giorno, a mezzogiorno di Piacenza, dalla longitudine vera del Sole. */
export function segnoDi(giorno: Date): Segno {
  return ORDINE_SEGNI[Math.floor(longitudineSole(istanteDelGiorno(giorno)) / 30) % 12];
}

/** Il wu xing, l'elemento cinese dell'anno. L'anno comincia al lichun (Sole a 315°), come nei Quattro Pilastri. */
export type ElementoCinese = 'legno' | 'fuoco' | 'terra' | 'metallo' | 'acqua';
export function elementoCinese(giorno: Date): ElementoCinese {
  const lambda = longitudineSole(istanteDelGiorno(giorno));
  const mese = giorno.getUTCMonth() + 1;
  const primaDelLichun = mese === 1 || (mese === 2 && lambda > 270 && lambda < 315);
  const anno = giorno.getUTCFullYear() - (primaDelLichun ? 1 : 0);
  const cifra = ((anno % 10) + 10) % 10;
  return (['metallo', 'metallo', 'acqua', 'acqua', 'legno', 'legno', 'fuoco', 'fuoco', 'terra', 'terra'] as const)[cifra];
}

/** I settori del cielo degli aruspici etruschi, incisi sul bordo del Fegato di Piacenza. */
export const SETTORI_ETRUSCHI = 16;

// ---------- la luna ----------
/** Il mese lunare medio, in giorni: serve solo per la prima stima delle fasi. */
export const MESE_LUNARE = 29.530588853;
/** Una luna nuova di riferimento: 6 gennaio 2000, 18:14 UTC. */
const LUNA_NUOVA_RIF = Date.UTC(2000, 0, 6, 18, 14);

/** La fase della luna da 0 a 1 (0 nuova, 0,5 piena): l'elongazione vera Luna-Sole divisa per 360°. */
export function faseLuna(istante: number | Date): number {
  const t = typeof istante === 'number' ? istante : istante.getTime();
  return norm360(longitudineLuna(t) - longitudineSole(t)) / 360;
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

/** La prossima luna nuova (0) o piena (0,5) dopo `da`: stima col mese medio, poi affinata sull'elongazione vera. */
export function prossimaLuna(fase: 0 | 0.5, da: number | Date = Date.now()): Date {
  const t0 = typeof da === 'number' ? da : da.getTime();
  const pMedia = (((t0 - LUNA_NUOVA_RIF) / GIORNO_MS / MESE_LUNARE) % 1 + 1) % 1;
  let d = fase - pMedia;
  if (d <= 0) d += 1;
  let t = t0 + d * MESE_LUNARE * GIORNO_MS;
  for (let giro = 0; giro < 3; giro++) {
    for (let k = 0; k < 6; k++) {
      let e = norm360(faseLuna(t) * 360 - fase * 360);
      if (e > 180) e -= 360;
      t -= (e / 12.190749) * GIORNO_MS; // la Luna guadagna ~12,19° al giorno sul Sole
    }
    if (t > t0) break;
    t += MESE_LUNARE * GIORNO_MS;
  }
  return new Date(t);
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
