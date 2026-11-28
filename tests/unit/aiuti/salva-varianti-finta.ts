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

/**
 * Onda 2 (R02-011) — Anche `salva_prodotto_e_varianti` (migrazioni 405 e 709), la funzione che
 * scrive prodotto e varianti in una transazione. Prima questo aiutante la rifiutava («rpc
 * inattesa»): una rotta che la chiamasse faceva cadere tutte le prove che lo usano, quindi
 * nessuno la chiamava. Qui fa quello che fa la funzione vera, sulla banca dati finta della prova:
 * prima tutti i controlli (scorta del prodotto vista, scorte delle varianti viste), poi il
 * prodotto e poi le varianti con lo stesso carico di `salva_varianti`.
 */
type CaricoInsieme = {
  p_product_id: string;
  p_prodotto?: Riga | null;
  p_scorta_vista?: number | null;
  p_varianti?: Riga[] | null;
  p_scorte_viste?: Record<string, unknown> | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export function salvaVariantiFinta(client: ClientFinto) {
  return async (nome: string, a: Carico): Promise<Esito> => {
    if (nome === 'salva_prodotto_e_varianti') return salvaProdottoEVariantiFinta(client, a as unknown as CaricoInsieme);
    if (nome !== 'salva_varianti') throw new Error(`rpc inattesa nella prova: ${nome}`);
    return eseguiSalvaVarianti(client, a);
  };
}

async function eseguiSalvaVarianti(client: ClientFinto, a: Carico): Promise<Esito> {
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
}

/** La scorta scritta di una variante, come la funzione vera: vuota = 0, intera, mai negativa. */
function scortaScritta(v: unknown): number | null {
  if (v === undefined || v === null) return 0;
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(Math.trunc(v), 0);
}

async function salvaProdottoEVariantiFinta(client: ClientFinto, a: CaricoInsieme): Promise<Esito> {
  const prodotti = () => client.from('products') as any;
  const patch = a.p_prodotto ?? {};
  const viste = a.p_scorte_viste ?? null;
  let carico: Carico | null = null;

  // 1. I controlli, prima di scrivere qualunque cosa.
  const { data: prodotto, error: errLettura } = await prodotti().select('id, stock').eq('id', a.p_product_id).maybeSingle();
  if (errLettura) return { data: null, error: errLettura };
  if (!prodotto) return { data: null, error: { code: 'P0002', message: 'prodotto_non_trovato' } };
  if ('stock' in patch && a.p_scorta_vista != null && prodotto.stock !== a.p_scorta_vista) {
    return {
      data: null,
      error: { code: 'P0001', message: 'scorta_prodotto_cambiata', details: JSON.stringify({ vista: a.p_scorta_vista, adesso: prodotto.stock }) },
    };
  }
  if (a.p_varianti != null) {
    const { data: esistenti, error } = await (client.from('product_variants') as any).select('id, stock').eq('product_id', a.p_product_id);
    if (error) return { data: null, error };
    const inBanca = new Map<string, unknown>(((esistenti ?? []) as Riga[]).map((r) => [String(r.id), r.stock]));
    const tenute = new Set<string>();
    carico = { p_product_id: a.p_product_id, p_delete: [], p_update: [], p_insert: [] };
    for (const [pos, v] of a.p_varianti.entries()) {
      const stock = scortaScritta(v.stock);
      if (stock === null) return { data: null, error: { code: '22023', message: 'variante_non_valida', details: String(v.label ?? '') } };
      const id = typeof v.id === 'string' && v.id ? v.id : null;
      if (id && inBanca.has(id)) {
        tenute.add(id);
        const vistaGrezza = viste?.[id];
        const vista = typeof vistaGrezza === 'number' ? vistaGrezza : undefined;
        const scrivi = vista === undefined || stock !== vista;
        const adesso = inBanca.get(id);
        if (scrivi && vista !== undefined && adesso !== vista) {
          return {
            data: null,
            error: { code: 'P0001', message: 'scorta_variante_cambiata', details: JSON.stringify({ id, label: v.label, vista, adesso }) },
          };
        }
        carico.p_update.push({
          id,
          options: v.options,
          label: v.label,
          position: pos,
          ...(scrivi ? { stock } : {}),
          // La funzione vera blocca le righe; qui la scorta vista fa da condizione.
          ...(scrivi && vista !== undefined ? { vista } : {}),
        });
      } else {
        carico.p_insert.push({ options: v.options, label: v.label, stock, position: pos });
      }
    }
    // Si cancella solo la variante che il negoziante ha visto e tolto.
    carico.p_delete = [...inBanca.keys()].filter((k) => !tenute.has(k) && (viste === null || Object.prototype.hasOwnProperty.call(viste, k)));
  }

  // 2. Le scritture: prima il prodotto, poi le varianti.
  if (Object.keys(patch).length > 0) {
    const { error } = await prodotti().update(patch).eq('id', a.p_product_id);
    if (error) return { data: null, error };
  }
  if (carico) return eseguiSalvaVarianti(client, carico);
  return { data: null, error: null };
}
