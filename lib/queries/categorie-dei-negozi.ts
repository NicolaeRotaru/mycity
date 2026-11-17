/**
 * 5/11/2026 — IL FILTRO PER CATEGORIA DI «NEGOZI» GUARDA ANCHE LE MADRI.
 *
 * Le opzioni del filtro sono le categorie principali; le categorie di un negozio sono quelle dei
 * suoi prodotti, che stanno quasi sempre in una sottocategoria (il pane in «Panificio», figlia di
 * «Alimentari»). Col filtro «Alimentari» il forno spariva. Qui all'insieme di ogni negozio si
 * aggiungono le madri, come fa già la ricerca.
 */
export function conLeMadri(
  categorieDelNegozio: Iterable<string>,
  madreDi: ReadonlyMap<string, string | null>,
): Set<string> {
  const tutte = new Set<string>();
  for (const id of categorieDelNegozio) {
    let corrente: string | null = id;
    // 17/11/2026 — Si risale fino alla radice, quanti che siano i livelli: prima un tetto di dieci
    // passi lasciava fuori le madri dall'undicesimo livello in su, e col loro filtro il negozio
    // spariva. Il giro si ferma lo stesso se una categoria finisse per essere madre di sé stessa
    // (anche passando da altre): una categoria già vista non si rivisita.
    while (corrente && !tutte.has(corrente)) {
      tutte.add(corrente);
      corrente = madreDi.get(corrente) ?? null;
    }
  }
  return tutte;
}
