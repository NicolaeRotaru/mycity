/**
 * I tetti sulla LUNGHEZZA dei testi che arrivano dal browser e finiscono nel
 * prompt (S10, 5/11/2026). Gli elenchi si tagliavano gia' a 40 attributi e 30
 * categorie, ma ogni voce entrava intera: una sola opzione da un megabyte
 * riempiva la finestra del modello. Qui si taglia anche la voce.
 */
export const MAX_OPZIONI_PER_CAMPO = 30;
export const MAX_CARATTERI_VOCE = 80;

/** Una voce come testo, tagliata al tetto. Non lancia mai. */
export function voceCorta(v: unknown, max = MAX_CARATTERI_VOCE): string {
  let s: string;
  try {
    s = String(v ?? '');
  } catch {
    return '';
  }
  return s.length > max ? s.slice(0, max) : s;
}

/** Le opzioni di un campo, al massimo 30 e ciascuna al massimo 80 caratteri. */
export function opzioniCorte(options: unknown): string[] {
  return (Array.isArray(options) ? options : []).slice(0, MAX_OPZIONI_PER_CAMPO).map((o) => voceCorta(o));
}
