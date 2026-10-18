/**
 * Un finto database per le rotte dell'assistente che scrivono i prodotti
 * (`catalog-apply`, `catalog-apply-bulk`, `catalog-batch/apply`). Risponde come
 * Supabase alle catene che quelle rotte usano e si annota ogni scrittura.
 *
 * Si usa dentro `vi.mock('@/lib/supabase/server', ...)`, passandogli uno stato
 * creato con `vi.hoisted`.
 */
export type StatoCatalogo = {
  prodotti: Record<string, unknown>[];
  categorie: Record<string, unknown>[];
  /** Il lavoro massivo letto da `catalog_ai_jobs` (null = non c'e'). */
  lavoro: Record<string, unknown> | null;
  /** Quante volte il lavoro e' stato segnato come applicato. */
  lavoroApplicato: number;
  scritture: { id: unknown; valori: Record<string, unknown> }[];
  /**
   * Facoltativo: il rifiuto del database a ogni scrittura su `products` (per
   * esempio il guardiano degli allergeni, codice 23514). Assente = si scrive.
   */
  erroreDiScrittura?: { code: string; message: string } | null;
};

type Domanda = { op: 'select' | 'update'; valori: Record<string, unknown> | null; filtri: Record<string, unknown> };

export function fintoCatalogo(stato: StatoCatalogo) {
  const risolvi = (tabella: string, d: Domanda, una: boolean) => {
    if (tabella === 'categories') return { data: stato.categorie, error: null };
    if (tabella === 'catalog_ai_jobs') {
      if (d.op === 'update') {
        stato.lavoroApplicato += 1;
        return { data: null, error: null };
      }
      return { data: stato.lavoro, error: null };
    }
    const riga = stato.prodotti.find((p) => p.id === d.filtri.id) ?? null;
    if (d.op === 'update') {
      if (stato.erroreDiScrittura) return { data: null, error: stato.erroreDiScrittura };
      stato.scritture.push({ id: d.filtri.id, valori: d.valori ?? {} });
      return { data: una && riga ? { ...riga, ...d.valori } : null, error: null };
    }
    return { data: una ? riga : stato.prodotti, error: null };
  };
  const tabella = (nome: string) => {
    const d: Domanda = { op: 'select', valori: null, filtri: {} };
    const q = {
      select: () => q,
      order: () => q,
      in: () => q,
      limit: () => q,
      eq: (colonna: string, valore: unknown) => {
        d.filtri[colonna] = valore;
        return q;
      },
      update: (valori: Record<string, unknown>) => {
        d.op = 'update';
        d.valori = valori;
        return q;
      },
      single: async () => risolvi(nome, d, true),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(risolvi(nome, d, false)).then(ok, ko),
    };
    return q;
  };
  return { getAdminSupabase: () => ({ from: tabella }) };
}
