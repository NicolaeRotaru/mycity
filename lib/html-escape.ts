/**
 * Escape dei caratteri HTML speciali, per interpolare in modo sicuro stringhe
 * controllate dall'utente (nomi prodotto, nomi cliente, ecc.) dentro corpi HTML
 * — in particolare nelle email. Evita injection di markup/contenuto ingannevole.
 *
 * Implementazione condivisa: prima era duplicata inline in più route
 * (contact, email/templates). Usare questa per ogni nuova interpolazione HTML.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
