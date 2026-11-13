/**
 * LE CATEGORIE «PIENE»: quelle con almeno un prodotto disponibile di un negozio approvato.
 *
 * 13/11/2026 — Stavano dentro `components/CategoryShowcase.tsx`, che è un componente del browser
 * ('use client'): da lì il server non le poteva chiamare (Next le trasforma in un riferimento al
 * browser), e il precarico della home non poteva chiedere quali categorie sono piene. Qui vivono
 * in un modulo senza direttiva, che usano tutti e due. `CategoryShowcase` le riesporta con gli
 * stessi nomi, quindi chi le importava da lì non cambia.
 */

/**
 * 1/11/2026 — IN VETRINA SOLO LE CATEGORIE CON QUALCOSA DENTRO.
 *
 * Delle nove categorie principali solo Alimentari aveva prodotti: la home ne mostrava sei, cinque
 * vuote, e il piede ne elencava nove, otto vuote. Ogni tessera vuota è un clic che porta a una
 * pagina senza niente. Adesso una categoria si mostra se ha almeno un prodotto disponibile, suo o
 * di una sua sottocategoria (lo stesso conto della mappa del sito, `app/sitemap.ts`).
 *
 * La risposta è l'elenco degli id «pieni». La chiave è condivisa tra la home e il piede: sulla
 * stessa pagina la lettura parte una volta sola. Se la lettura fallisce si mostrano tutte, come
 * prima: un errore di rete non deve far sparire le categorie vere.
 */
export const CHIAVE_CATEGORIE_PIENE = ['categories', 'con-prodotti'] as const;

/**
 * Quanti prodotti si guardano al massimo per sapere quali categorie sono piene, e in pagine da
 * quante righe: il database ne restituisce al massimo mille per domanda (`max_rows`), quindi un
 * `limit(5000)` secco ne portava mille, in un ordine qualunque, e oltre una categoria vera poteva
 * sparire. Ora si sfoglia per id, mille alla volta.
 */
const PRODOTTI_LETTI_PER_LE_CATEGORIE = 5000;
const RIGHE_PER_PAGINA = 1000;

/** Le categorie che hanno un prodotto: la sua e tutte quelle sopra di lei. */
export function categorieConProdotti(
  categorie: ReadonlyArray<{ id: string; parent_id?: string | null }>,
  prodotti: ReadonlyArray<{ category_id?: string | null }>,
): string[] {
  const madreDi = new Map(categorie.map((c) => [c.id, c.parent_id ?? null]));
  const piene = new Set<string>();
  for (const p of prodotti) {
    let id = p.category_id ?? null;
    // Il tetto ai passi tiene fermo il giro se una categoria finisse per essere madre di sé stessa.
    for (let passi = 0; id && !piene.has(id) && passi < 10; passi += 1) {
      piene.add(id);
      id = madreDi.get(id) ?? null;
    }
  }
  return [...piene];
}

type ClientPiene = { from: (tabella: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export function domandaCategoriePiene(supa: ClientPiene) {
  return {
    queryKey: CHIAVE_CATEGORIE_PIENE,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<string[]> => {
      // 5/11/2026 — Contano solo i prodotti dei negozi approvati, come nella mappa del sito: un
      // venditore collegato vede anche i suoi prodotti per le regole del database, e per lui una
      // categoria con soli prodotti di un negozio non approvato risultava piena.
      const [cat, negozi] = await Promise.all([
        supa.from('categories').select('id, parent_id'),
        supa.from('seller_public_profiles').select('id').limit(2000),
      ]);
      if (cat.error) throw cat.error;
      if (negozi.error) throw negozi.error;
      const approvati = new Set(((negozi.data ?? []) as { id: string }[]).map((n) => n.id));
      const prodotti: { id: string; category_id: string | null; seller_id: string | null }[] = [];
      let ultimo: string | null = null;
      while (prodotti.length < PRODOTTI_LETTI_PER_LE_CATEGORIE) {
        let q = supa
          .from('products')
          .select('id, category_id, seller_id')
          .eq('status', 'available')
          .order('id', { ascending: true })
          .limit(RIGHE_PER_PAGINA);
        if (ultimo) q = q.gt('id', ultimo);
        const pagina = await q;
        if (pagina.error) throw pagina.error;
        const righe = (pagina.data ?? []) as typeof prodotti;
        prodotti.push(...righe);
        if (righe.length < RIGHE_PER_PAGINA) break;
        ultimo = righe[righe.length - 1].id;
      }
      return categorieConProdotti(cat.data ?? [], prodotti.filter((p) => !!p.seller_id && approvati.has(p.seller_id)));
    },
  };
}

/**
 * Tiene solo le categorie piene. `piene` assente (lettura fallita) = tutte, come prima.
 * Una categoria senza id (la riserva scritta nel codice) non si può controllare: resta.
 */
export function soloLePiene<T extends { id?: string }>(categorie: T[], piene: ReadonlyArray<string> | null | undefined): T[] {
  if (!piene) return categorie;
  const insieme = new Set(piene);
  return categorie.filter((c) => !c.id || insieme.has(c.id));
}
