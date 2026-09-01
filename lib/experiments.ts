/**
 * A/B testing leggero, cookie-based e SSR-safe.
 *
 * Perché così e non una libreria:
 * - PostHog è già integrato (lib/analytics) e riceve gli eventi di esposizione
 *   e di conversione: l'analisi del test si fa lì. Qui gestiamo solo
 *   l'ASSEGNAZIONE stabile della variante.
 * - Il progetto è già cookie-based (i18n next-intl, checkout draft): un cookie
 *   per esperimento è coerente con l'architettura esistente.
 * - L'assegnazione avviene nel middleware (edge runtime) e viene propagata al
 *   render della pagina via header `x-exp-<key>`, così la variante è corretta
 *   già al PRIMO render server (niente flicker, niente layout shift).
 *
 * Aggiungere un esperimento = una entry in EXPERIMENTS. Disattivarlo = enabled:false
 * (tutti tornano alla variante di controllo, la prima dell'array).
 */

export type ExperimentKey = 'home_hero';

export type Experiment = {
  /** Identificatore stabile (usato in PostHog e nei nomi cookie/header). */
  key: ExperimentKey;
  /** Varianti: la PRIMA è sempre il controllo. */
  variants: readonly string[];
  /** Se false, tutti ricevono il controllo e non viene assegnato nulla. */
  enabled: boolean;
};

export const EXPERIMENTS: Record<ExperimentKey, Experiment> = {
  home_hero: {
    key: 'home_hero',
    variants: ['a', 'b'] as const,
    enabled: true,
  },
};

export const EXPERIMENT_LIST: Experiment[] = Object.values(EXPERIMENTS);

/** Nome del cookie persistente per un esperimento. */
export const expCookieName = (key: string) => `mc_exp_${key}`;
/** Nome dell'header request usato per propagare la variante al render. */
export const expHeaderName = (key: string) => `x-exp-${key}`;

/** Validità del cookie di assegnazione: 90 giorni. */
export const EXP_COOKIE_MAX_AGE = 60 * 60 * 24 * 90;

/**
 * Un numero stabile a partire da un testo (FNV-1a a 32 bit + rimescolata
 * finale). Non è crittografia: serve solo a distribuire in modo ripetibile, ed
 * è edge-safe.
 *
 * La rimescolata NON è un ornamento. Con due varianti la scelta è `% 2`, cioè
 * l'ultimo bit — e l'ultimo bit del solo FNV-1a è la parità dei caratteri del
 * testo: quaranta visitatori con user-agent simili finivano tutti nello stesso
 * gruppo. Il test A/B non avrebbe più diviso nessuno. Il finalizzatore sparge
 * l'informazione su tutti i bit; la prova che conta è quella dei quaranta semi
 * diversi in `senza-cookie-la-home-non-cambia-faccia-a-ogni-pagina`.
 */
function numeroStabile(testo: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < testo.length; i++) {
    h ^= testo.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Sceglie una variante. Edge-safe (Web Crypto, niente Node).
 * Se l'esperimento è disabilitato o ha una sola variante → controllo.
 *
 * 30/8/2026 (R173) — SENZA CONSENSO LA HOME CAMBIAVA FACCIA A OGNI PAGINA.
 *
 * L'assegnazione si scrive in un cookie, e il cookie si scrive solo con il
 * consenso analitico: giusto. Ma senza cookie qui si rifaceva un SORTEGGIO a
 * ogni richiesta, quindi chi rifiuta i cookie — o non risponde al banner —
 * vedeva la variante cambiare a ogni navigazione: la home si comportava come
 * due siti diversi a seconda della pagina da cui tornava. E la variante
 * registrata dopo il consenso poteva essere diversa da quella che quella
 * persona aveva visto fino a un attimo prima.
 *
 * Col `seme` la variante si CALCOLA da un valore che c'è già nella richiesta
 * (l'impronta della sessione, o indirizzo di rete + browser): stessa persona,
 * stessa variante, prima e dopo il consenso, senza scrivere niente sul
 * dispositivo. Senza seme resta il sorteggio di prima.
 */
export function assignVariant(exp: Experiment, seme?: string | null): string {
  const control = exp.variants[0];
  if (!exp.enabled || exp.variants.length < 2) return control;
  if (seme) return exp.variants[numeroStabile(`${exp.key}:${seme}`) % exp.variants.length] ?? control;
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  const idx = arr[0] % exp.variants.length;
  return exp.variants[idx] ?? control;
}

/**
 * Normalizza una variante ricevuta (da header o cookie) a un valore valido
 * per l'esperimento; altrimenti torna il controllo.
 */
export function resolveVariant(exp: Experiment, raw: string | null | undefined): string {
  const control = exp.variants[0];
  if (!raw) return control;
  return exp.variants.includes(raw) ? raw : control;
}
