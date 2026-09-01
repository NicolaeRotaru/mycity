import { EXPERIMENT_LIST, expCookieName } from '@/lib/experiments';

/**
 * 27/8/2026 (R165) — LA VARIANTE DEL TEST A/B NON VIAGGIAVA CON L'ACQUISTO.
 *
 * L'esposizione all'esperimento attacca la variante a tutti gli eventi del
 * browser con una super-property di PostHog (`home_hero_variant`). Ma
 * l'acquisto NON parte dal browser: lo manda il server, con un elenco chiuso di
 * proprietà scritte a mano — e lì dentro la variante non c'era. Il commento
 * nell'esposizione («ogni evento successivo della sessione porta con sé la
 * variante») per l'evento che conta diceva il falso.
 *
 * Risultato: per sapere se la variante B vende di più bisognava legare le
 * persone una a una invece di filtrare una proprietà dell'evento. Un
 * esperimento che si può analizzare solo a mano, di fatto, non si analizza.
 *
 * L'assegnazione vive in un cookie (`mc_exp_<esperimento>`, scritto dal
 * middleware) che arriva col checkout: qui si legge e si porta fino all'evento.
 *
 * 🟢 Pura: legge una stringa. Una prova la ESEGUE.
 */
export function variantiDaiCookie(cookie: string | null | undefined): Record<string, string> {
  const testo = cookie ?? '';
  const trovate: Record<string, string> = {};
  for (const esperimento of EXPERIMENT_LIST) {
    const nome = expCookieName(esperimento.key);
    const valore = testo.match(new RegExp(`(?:^|;\\s*)${nome}=([^;]+)`))?.[1]?.trim();
    // Solo varianti dichiarate: un cookie scritto a mano non deve poter
    // inventare gruppi di esperimento che nei conti poi non esistono.
    if (valore && esperimento.variants.includes(valore)) trovate[esperimento.key] = valore;
  }
  return trovate;
}
