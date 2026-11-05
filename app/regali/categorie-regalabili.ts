/**
 * Le categorie della pagina «Regali», dalla tassonomia LIVE: match per slug, poi
 * per nome.
 *
 * 5/11/2026 — E LE LORO FIGLIE. Gli slug regalabili sono madri (alimentari,
 * casa, bellezza...), e la griglia usa gli id cosi' come arrivano, senza
 * allargarli: i prodotti di Panificio o Salumeria, figlie di Alimentari,
 * restavano fuori da Regali mentre su /category/alimentari comparivano.
 */
export type CategoriaDellaTassonomia = { id: string; slug: string | null; name: string | null; parent_id?: string | null };

export function categorieRegalabili(
  righe: CategoriaDellaTassonomia[],
  slugRegalabili: ReadonlySet<string>,
  indiziNelNome: readonly string[],
): string[] {
  const scelte = new Set(
    righe
      .filter((c) => {
        const slug = (c.slug ?? '').toLowerCase();
        const name = (c.name ?? '').toLowerCase();
        return slugRegalabili.has(slug) || indiziNelNome.some((h) => name.includes(h));
      })
      .map((c) => c.id),
  );
  // Le figlie (a ogni livello) delle categorie scelte.
  let aggiunte = true;
  while (aggiunte) {
    aggiunte = false;
    for (const c of righe) {
      if (c.parent_id && scelte.has(c.parent_id) && !scelte.has(c.id)) {
        scelte.add(c.id);
        aggiunte = true;
      }
    }
  }
  return [...scelte];
}
