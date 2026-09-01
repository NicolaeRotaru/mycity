/**
 * Nascondere un prodotto, non cancellarlo.
 *
 * 27/8/2026 (R029) — IL TASTO «ELIMINA» CANCELLAVA DAVVERO.
 *
 * Due pagine del pannello venditore facevano `.delete()` sul catalogo. Con il
 * prodotto se ne andavano le recensioni (erano agganciate con ON DELETE
 * CASCADE: chi prendeva una stella cancellava e ripubblicava pulito) e il nome
 * di quello che il cliente aveva comprato spariva dal suo storico.
 *
 * Quello che il negoziante vuole quasi sempre è toglierlo dalla vetrina, non
 * cancellare la storia: qui il prodotto va in bozza. Il database, dalla
 * migrazione 140, rifiuta comunque la cancellazione di un prodotto venduto o
 * recensito — perché la regola vale anche per chi non passa di qui.
 */

export const STATO_NASCOSTO = 'draft';

type CatenaScrittura = {
  eq: (colonna: string, valore: string) => CatenaScrittura;
} & PromiseLike<{ error: { message?: string } | null }>;

type ClientDelCatalogo = {
  from: (tabella: string) => { update: (valori: Record<string, unknown>) => CatenaScrittura };
};

export async function nascondiProdotto(
  client: ClientDelCatalogo,
  opts: { id: string; sellerId?: string },
): Promise<void> {
  let scrittura = client.from('products').update({ status: STATO_NASCOSTO }).eq('id', opts.id);
  // Il filtro sul negozio resta dov'era: non ci si fida della sola regola del
  // database per decidere di chi è il prodotto.
  if (opts.sellerId) scrittura = scrittura.eq('seller_id', opts.sellerId);
  const { error } = await scrittura;
  if (error) throw error;
}
