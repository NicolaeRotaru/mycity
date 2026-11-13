import type { SupabaseClient } from '@supabase/supabase-js';
import { type ProductVariant } from '@/lib/products/variants';
import { DaCompletare } from '@/lib/products/salvataggio-tracciato';
import { scortaCambiata } from '@/lib/products/schema';

/**
 * Persistenza varianti con un SupabaseClient esplicito. La usano DUE porte:
 * l'admin (client service-role, prodotti di qualunque negozio) e il browser del
 * negoziante (il suo client, con le regole per riga) passando da
 * `persistVariants.ts`. Quindi niente codice solo-server qui dentro: il file
 * finisce anche nel pacchetto del browser.
 *
 * Il diff insert/update/delete mantiene stabili gli id delle varianti invariate
 * (riferimenti in order_items). Il trigger DB riallinea products.stock/has_variants.
 *
 * 28/10/2026 — `scorteViste` (id → pezzi, com'erano all'apertura del modulo):
 * la scorta di una variante gia' salvata si riscrive solo se e' diversa da
 * quella vista. Mentre il modulo resta aperto `reserve_stock` la abbassa a ogni
 * vendita: riscrivere il numero vecchio rimetterebbe in vetrina pezzi venduti.
 * Senza `scorteViste` si riscrive tutto, come prima.
 *
 * 31/10/2026 — E QUELLA CAMBIATA A MANO SI SCRIVE SOLO SE NESSUNO L'HA MOSSA.
 * La S vista a 2, venduta a 1 nel frattempo, riscritta a 4 dal negoziante: in
 * banca dati andava 4, e la vendita spariva. Adesso, se la scorta di una
 * variante cambiata non e' piu' quella vista, non si scrive niente (nessuna
 * variante, nessuna cancellazione) e un `DaCompletare` lo dice al negoziante.
 *
 * Il confronto e' col numero VISTO, mai con quello scritto: la S vista a 2,
 * venduta a 1 nel frattempo, portata a 1 dal negoziante che ne ha tolta una
 * difettosa e' un conflitto (la vera e' 0), anche se in banca dati c'e' gia'
 * il numero che chiede. E la condizione sta anche nella scrittura
 * (`.eq('stock', vista)`): una vendita arrivata fra la lettura e la scrittura
 * lascia la riga non trovata, e la scorta non si sovrascrive. Dal 12/11/2026
 * (R08-008) le scritture vanno tutte o nessuna: vedi `salva_varianti` più sotto.
 */
/**
 * Il controllo delle scorte, prima di scrivere qualunque cosa: se una taglia
 * cambiata a mano non ha più in banca dati la scorta vista all'apertura, lancia
 * lo stesso `DaCompletare` del salvataggio. La pagina di modifica lo chiama
 * PRIMA di salvare il prodotto: altrimenti nome e prezzo restavano scritti e le
 * varianti no, con un messaggio che diceva di riaprire.
 */
export async function controllaScorteVarianti(
  supabase: SupabaseClient,
  productId: string,
  variants: ProductVariant[],
  scorteViste?: Record<string, number>,
): Promise<void> {
  if (!scorteViste) return;
  const { data: existing, error } = await supabase
    .from('product_variants')
    .select('id, stock')
    .eq('product_id', productId);
  if (error) throw error;
  const scortaInBanca = new Map((existing ?? []).map((r) => [r.id as string, (r as { stock?: unknown }).stock]));
  for (const v of variants) {
    if (!v.id || !scortaInBanca.has(v.id)) continue;
    const vista = scorteViste[v.id];
    const scritta = Math.max(0, Math.trunc(v.stock || 0));
    if (vista === undefined || !scortaCambiata(scritta, vista)) continue;
    const adesso = scortaInBanca.get(v.id);
    if (typeof adesso === 'number' && adesso !== vista) throw scortaVarianteCambiata(v.label, vista, adesso);
  }
}

export async function saveProductVariantsServer(
  supabase: SupabaseClient,
  productId: string,
  variants: ProductVariant[],
  scorteViste?: Record<string, number>,
): Promise<void> {
  const { data: existing, error: loadErr } = await supabase
    .from('product_variants')
    .select('id, stock')
    .eq('product_id', productId);
  if (loadErr) throw loadErr;
  const existingIds = new Set((existing ?? []).map((r) => r.id as string));
  const scortaInBanca = new Map((existing ?? []).map((r) => [r.id as string, (r as { stock?: unknown }).stock]));

  const keepIds = new Set<string>();
  const toInsert: Array<Record<string, unknown>> = [];
  const toUpdate: Array<{ id: string; row: Record<string, unknown>; vista?: number; label: string }> = [];

  variants.forEach((v, i) => {
    const row: Record<string, unknown> = {
      product_id: productId,
      options: v.options,
      label: v.label,
      stock: Math.max(0, Math.trunc(v.stock || 0)),
      position: i,
    };
    if (v.id && existingIds.has(v.id)) {
      keepIds.add(v.id);
      const vista = scorteViste?.[v.id];
      // La stessa regola della scorta del prodotto (lib/products/schema.ts): una copia sola.
      if (vista !== undefined && !scortaCambiata(row.stock, vista)) delete row.stock;
      const adesso = scortaInBanca.get(v.id);
      if ('stock' in row && vista !== undefined && typeof adesso === 'number' && adesso !== vista) {
        throw scortaVarianteCambiata(v.label, vista, adesso);
      }
      // La condizione va nella scrittura solo se la lettura ha visto una scorta vera.
      const condizionata = 'stock' in row && vista !== undefined && typeof adesso === 'number';
      toUpdate.push({ id: v.id, row, label: v.label, ...(condizionata ? { vista } : {}) });
    } else {
      toInsert.push(row);
    }
  });

  /**
   * 31/10/2026 — SI CANCELLA SOLO LA VARIANTE CHE IL NEGOZIANTE HA VISTO E TOLTO.
   * Una pagina che apre il modulo con un ripiego vuoto (la lettura delle
   * varianti e' caduta) manda zero varianti: senza questo freno le cancellava
   * tutte, e negli ordini gia' fatti la riga perdeva la taglia
   * (order_items.variant_id a NULL). Esempio: «Maglietta» con M (3) e L (2), la
   * lettura cade, si corregge una parola e si salva: M e L restano. Con le
   * scorte viste (`scorteViste`) si sa cosa c'era davanti; una variante che li'
   * non c'e' (mai letta, o aggiunta da un'altra scheda nel frattempo) non si
   * tocca. Senza `scorteViste` (chi non le passa) resta il comportamento di prima.
   */
  const vista = (id: string) => scorteViste === undefined || Object.prototype.hasOwnProperty.call(scorteViste, id);
  const toDelete = [...existingIds].filter((id) => !keepIds.has(id) && vista(id));

  /**
   * 12/11/2026 (R08-008) — TUTTE O NESSUNA.
   *
   * Prima qui c'erano tre giri separati (cancella, aggiorna una riga alla volta,
   * inserisci): se a metà una scrittura condizionata trovava la scorta cambiata, le
   * cancellazioni e gli aggiornamenti già fatti restavano, e il prodotto finiva mezzo
   * salvato. Adesso i tre giri sono la funzione del database `salva_varianti`
   * (migrations/323), una transazione sola, con le regole per riga di chi chiama: al
   * primo conflitto torna indietro tutto. Se la funzione non c'è ancora (migrazione non
   * applicata: PGRST202) si fanno i tre giri di prima, così il salvataggio non si rompe.
   */
  const { error: errRpc } = await supabase.rpc('salva_varianti', {
    p_product_id: productId,
    p_delete: toDelete,
    p_update: toUpdate.map((u) => ({
      id: u.id,
      options: u.row.options,
      label: u.row.label,
      position: u.row.position,
      ...('stock' in u.row ? { stock: u.row.stock } : {}),
      ...(u.vista !== undefined ? { vista: u.vista } : {}),
    })),
    p_insert: toInsert.map((r) => ({ options: r.options, label: r.label, stock: r.stock, position: r.position })),
  });
  if (!errRpc) return;
  if (funzioneMancante(errRpc)) {
    await salvaInTreGiri(supabase, toDelete, toUpdate, toInsert);
    return;
  }
  if (errRpc.message === 'scorta_cambiata') {
    const u = toUpdate.find((x) => x.id === errRpc.details);
    throw scortaVarianteCambiata(u?.label ?? 'una variante', u?.vista ?? 0, undefined);
  }
  throw errRpc;
}

/** La funzione del database non c'è (ancora): PostgREST risponde PGRST202, Postgres 42883. */
function funzioneMancante(e: { code?: string; message?: string }): boolean {
  // Il 42883 può nascere anche da una funzione che manca DENTRO salva_varianti: lì non si ripiega
  // in silenzio sui tre giri non atomici, si dice l'errore.
  return e.code === 'PGRST202' || (e.code === '42883' && /salva_varianti/.test(e.message ?? ''));
}

/**
 * Il salvataggio di prima della migrazione 323, in tre giri: resta solo come ripiego.
 * Qui le righe già scritte prima di un conflitto non tornano indietro.
 */
async function salvaInTreGiri(
  supabase: SupabaseClient,
  toDelete: string[],
  toUpdate: Array<{ id: string; row: Record<string, unknown>; vista?: number; label: string }>,
  toInsert: Array<Record<string, unknown>>,
): Promise<void> {
  if (toDelete.length > 0) {
    const { error } = await supabase.from('product_variants').delete().in('id', toDelete);
    if (error) throw error;
  }
  for (const u of toUpdate) {
    if (u.vista === undefined) {
      const { error } = await supabase.from('product_variants').update(u.row).eq('id', u.id);
      if (error) throw error;
      continue;
    }
    const { data, error } = await supabase
      .from('product_variants')
      .update(u.row)
      .eq('id', u.id)
      .eq('stock', u.vista)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw scortaVarianteCambiata(u.label, u.vista, undefined);
  }
  if (toInsert.length > 0) {
    const { error } = await supabase.from('product_variants').insert(toInsert);
    if (error) throw error;
  }
}

/** Il messaggio per il negoziante: il motivo e cosa fare, non «Riprova». */
function scortaVarianteCambiata(label: string, vista: number, adesso: number | undefined): DaCompletare {
  const ora = typeof adesso === 'number' ? `ora sono ${adesso}` : 'nel frattempo è cambiata';
  return new DaCompletare(
    `La scorta di «${label}» è cambiata mentre modificavi: avevi davanti ${vista} pezzi, ${ora}. Riapri il prodotto, controlla il numero e salva di nuovo.`,
    ['scorta'],
  );
}
