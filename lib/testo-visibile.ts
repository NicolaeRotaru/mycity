/**
 * 12/11/2026 (R10-014) — Quanto e' lungo un testo come lo legge una persona: senza tag, e
 * un'entita' (`&lt;`, `&amp;`…) vale un carattere. Serve a contare il limite dei blocchi di
 * testo allo stesso modo prima e dopo la sanitizzazione, che aggiunge attributi ai link e
 * trasforma `<` in `&lt;` (lib/home-site.ts, RICHTEXT_MAX). Lo usano lo schema e il modulo.
 */
export function lunghezzaDelTesto(html: string | null | undefined): number {
  if (!html) return 0;
  return html.replace(/<[^>]*>/g, '').replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, '_').length;
}
