/**
 * 28/11/2026 (R05-005, collaudo K03) — LA RICERCA DEI PRODOTTI DELL'ADMIN GUARDA ANCHE IL NEGOZIO.
 *
 * Il campo dice «Cerca prodotto o negozio», ma oltre i primi mille prodotti la ricerca nel
 * database guardava solo il nome del prodotto: cercando un negozio, i suoi prodotti più vecchi
 * non uscivano mai. Adesso al database si chiede il nome del prodotto OPPURE il negozio: prima
 * si trovano i negozi il cui nome contiene il testo, poi i prodotti che hanno quel testo nel
 * nome o che sono di uno di quei negozi.
 *
 * Il testo di chi cerca resta testo. `%` e `_` non fanno da jolly; virgole, punti, due punti e
 * parentesi — la punteggiatura della lingua dei filtri di PostgREST — non spezzano il filtro in
 * condizioni che nessuno ha chiesto: il valore viaggia tra virgolette.
 */

/** Il modello per `ilike`: il testo cercato, in qualunque punto del campo, lettera per lettera. */
export function modelloIlike(termine: string): string {
  // `\` è il segno di fuga di LIKE: si neutralizza insieme ai due jolly, in un passo solo.
  const letterale = termine.replace(/[\\%_]/g, (c) => `\\${c}`);
  // PostgREST legge `*` come `%` e non c'è modo di dirgli di no: diventa `_`, un carattere
  // qualsiasi (che comprende `*`). Il filtro nel browser poi tiene solo chi ha davvero `*`.
  return `%${letterale.replace(/\*/g, '_')}%`;
}

/** Un valore dentro `or=(…)`, tra virgolette: lì dentro solo `"` e `\` vanno preceduti da `\`. */
export function traVirgolette(valore: string): string {
  return `"${valore.replace(/["\\]/g, (c) => `\\${c}`)}"`;
}

/**
 * Il filtro per `.or()` di supabase-js: il nome del prodotto contiene il testo, oppure il
 * prodotto è di uno dei negozi trovati. Gli identificativi vengono dal database (uuid): non
 * hanno punteggiatura da proteggere.
 */
export function filtroNomeONegozio(termine: string, idsNegozi: readonly string[]): string {
  const perNome = `name.ilike.${traVirgolette(modelloIlike(termine))}`;
  if (idsNegozi.length === 0) return perNome;
  return `${perNome},seller_id.in.(${idsNegozi.join(',')})`;
}
