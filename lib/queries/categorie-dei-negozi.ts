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
    // Il tetto ai passi tiene fermo il giro se una categoria finisse per essere madre di sé stessa.
    for (let passi = 0; corrente && !tutte.has(corrente) && passi < 10; passi += 1) {
      tutte.add(corrente);
      corrente = madreDi.get(corrente) ?? null;
    }
  }
  return tutte;
}
