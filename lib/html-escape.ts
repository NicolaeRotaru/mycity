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

/**
 * Serializza un oggetto JSON-LD per l'uso sicuro in <script type="application/ld+json">.
 *
 * JSON.stringify() non escapa < > & — se un dato controllato dall'utente (nome
 * prodotto, descrizione, indirizzo…) contiene queste sequenze, un attaccante può
 * iniettare HTML/script chiudendo il tag <script> prematuramente, e.g.:
 *   name: "</script><script>alert(1)</script>"
 *
 * La soluzione è sostituire i caratteri critici con le rispettive escape Unicode,
 * che i parser JSON interpretano correttamente ma i parser HTML trattano come
 * contenuto opaco (non come markup). È lo stesso approccio usato da Django,
 * Rails e Next.js stesso per i propri blocchi JSON-LD.
 *
 * Uso: dangerouslySetInnerHTML={{ __html: safeJsonLd(schema) }}
 */
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/'/g, '\\u0027');
}
