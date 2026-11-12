/**
 * R08-008 (12/11/2026) — LA FUNZIONE `salva_varianti` FINTA, CHE FA DAVVERO IL LAVORO.
 *
 * Il salvataggio delle varianti (lib/products/persistVariantsServer.ts) passa dalla funzione
 * del database `salva_varianti` (migrations/323): il codice prepara cosa cancellare, cosa
 * aggiornare (con la scorta vista) e cosa inserire, e la funzione lo esegue in una volta.
 *
 * Le prove che hanno già una banca dati finta (`from('product_variants')…`) devono continuare
 * a guardare QUEL carico: una variante mai vista messa fra le cancellazioni, o una scorta
 * riscritta uguale a quella vista, devono finire nella loro banca dati e farle diventare rosse.
 * Una rpc che risponde «funzione mancante» le farebbe passare dal ripiego, e il carico vero non
 * lo guarderebbe più nessuno (collaudo K02).
 *
 * Qui il carico ricevuto si esegue sulla banca dati finta della prova, con le stesse scritture
 * della funzione vera: cancella per id, aggiorna (condizionato alla scorta vista se c'è: se non
 * tocca niente, errore «scorta_cambiata» con l'id, come la 323), inserisce. L'atomicità vera la
 * prova Postgres (tests/sql/rls/riparazione-r08-le-varianti-tutte-o-nessuna.test.sql); il
 * ripiego PGRST202 ha la sua prova (tests/unit/riparazione-r08-le-varianti-tutte-o-nessuna.test.ts).
 */

type Riga = Record<string, unknown>;
type Carico = {
  p_product_id: string;
  p_delete: string[];
  p_update: Array<Riga & { id: string; vista?: number }>;
  p_insert: Riga[];
};
type ClientFinto = { from: (tavola: string) => unknown };
type Esito = { data: null; error: null | { code: string; message: string; details?: string } };

/* eslint-disable @typescript-eslint/no-explicit-any */
export function salvaVariantiFinta(client: ClientFinto) {
  return async (nome: string, a: Carico): Promise<Esito> => {
    if (nome !== 'salva_varianti') throw new Error(`rpc inattesa nella prova: ${nome}`);
    const tavola = () => client.from('product_variants') as any;
    if (a.p_delete.length > 0) {
      const { error } = await tavola().delete().in('id', a.p_delete);
      if (error) return { data: null, error };
    }
    for (const u of a.p_update) {
      const { id, vista, ...campi } = u;
      const riga: Riga = { product_id: a.p_product_id, ...campi };
      if (vista === undefined) {
        const { error } = await tavola().update(riga).eq('id', id);
        if (error) return { data: null, error };
        continue;
      }
      const { data, error } = await tavola().update(riga).eq('id', id).eq('stock', vista).select('id');
      if (error) return { data: null, error };
      if (!data || data.length === 0) return { data: null, error: { code: 'P0001', message: 'scorta_cambiata', details: id } };
    }
    if (a.p_insert.length > 0) {
      const { error } = await tavola().insert(a.p_insert.map((r) => ({ product_id: a.p_product_id, ...r })));
      if (error) return { data: null, error };
    }
    return { data: null, error: null };
  };
}
