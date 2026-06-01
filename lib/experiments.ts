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
 * Sceglie una variante in modo uniforme. Edge-safe (Web Crypto, niente Node).
 * Se l'esperimento è disabilitato o ha una sola variante → controllo.
 */
export function assignVariant(exp: Experiment): string {
  const control = exp.variants[0];
  if (!exp.enabled || exp.variants.length < 2) return control;
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
