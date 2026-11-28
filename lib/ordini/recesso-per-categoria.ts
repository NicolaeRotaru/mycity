import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 26/11/2026 — IL PANE È ESCLUSO DAL RECESSO ANCHE SE IL NEGOZIO NON L'HA SPUNTATO.
 * La spunta `non_recedibile` (migrazione 180) parte spenta: un pane creato senza
 * toccarla accettava «Cambio idea» (HTTP 201). Il fatto `legale.recesso-esclusi`
 * dice che pane, dolci, salumi, latticini e gli altri freschi sono esclusi: la
 * categoria del prodotto lo sa già. Vale la categoria o uno dei suoi padri (una
 * sottocategoria del Panificio creata dal pannello resta pane). La spunta del
 * negozio resta e si somma: serve per le ordinazioni e i freschi fuori da queste.
 *
 * 27/11/2026 (R09-015) — La regola stava dentro la rotta dei resi (app/api/returns/create), e la
 * scheda prodotto e il carrello, PRIMA dell'acquisto (art. 49 c.1 lett. m Cod. Cons.), dicevano
 * «escluso dal recesso» solo con la spunta. Ora vive qui, una volta sola, e la leggono tutti e tre.
 *
 * 🟢 Pura: nessuna rete, nessun orologio.
 */
export const CATEGORIE_DEPERIBILI = new Set([
  'panificio',
  'alimentari-dolci',
  'salumeria',
  'alimentari-latticini',
  'alimentari-pasta-fresca',
  'frutta-verdura',
]);
export type CategoriaPerIlRecesso = { id: string; slug: string; parent_id: string | null };

/**
 * 27/11/2026 — UN FRESCO DA FRIGORIFERO È FRESCO ANCHE FUORI DALLE CATEGORIE DEI FRESCHI.
 * Il campo «Conservazione» del modulo alimentari (lib/category-attributes.ts) ha la voce
 * «Frigorifero»: è il negozio stesso a dire che il prodotto va tenuto in frigo, cioè che si
 * deteriora in fretta. Una mozzarella salvata sulla sola radice «Alimentari», senza
 * sottocategoria e senza spunta, accettava il ripensamento. «Freezer»
 * (surgelati) e «Luogo fresco e asciutto» non sono «freschi» nel fatto `legale.recesso-esclusi`.
 * 28/11/2026 (R09-015, onda 2) — Stava solo nella copia della rotta dei resi: la scheda prodotto e il
 * carrello non lo sapevano. Ora la regola è una sola, qui.
 *
 * 28/11/2026 (R04-001, onda 2) — NON SOLO LA VOCE ESATTA DEL MENU.
 * Il caricamento da file (lib/products/righe-dal-file.ts) scrive gli attributi come testo libero,
 * con la chiave com'è scritta nel file: «Conservazione: In frigorifero» o «conservazione: Frigo»
 * passavano come ripensamento (201). Ora la chiave si cerca senza badare a maiuscole e spazi, e
 * vale ogni valore che dice frigo. Resta fuori «in frigorifero dopo l'apertura»: è la dispensa
 * (il vasetto di miele), che il recesso ce l'ha.
 */
const DICE_FRIGO = /\bfrigo/i;
const SOLO_DOPO_APERTO = /\b(dopo|una volta)\s+(l['’]\s*)?apert/i;
function daFrigorifero(attributi: unknown): boolean {
  if (!attributi || typeof attributi !== 'object' || Array.isArray(attributi)) return false;
  return Object.entries(attributi as Record<string, unknown>).some(([chiave, valore]) => {
    if (chiave.trim().toLowerCase() !== 'conservazione' || typeof valore !== 'string') return false;
    return DICE_FRIGO.test(valore) && !SOLO_DOPO_APERTO.test(valore);
  });
}

export function segnaIDeperibili<P extends { category_id?: unknown; attributes?: unknown }>(
  prodotti: P[],
  categorie: CategoriaPerIlRecesso[],
): P[] {
  const perId = new Map(categorie.map((c) => [c.id, c]));
  const deperibile = (id: unknown): boolean => {
    let cur = typeof id === 'string' ? perId.get(id) : undefined;
    for (let passi = 0; cur && passi < 20; passi++) {
      if (CATEGORIE_DEPERIBILI.has(cur.slug)) return true;
      cur = cur.parent_id ? perId.get(cur.parent_id) : undefined;
    }
    return false;
  };
  return prodotti.map((p) => (deperibile(p.category_id) || daFrigorifero(p.attributes) ? { ...p, non_recedibile: true } : p));
}

/**
 * Per la scheda prodotto e il carrello (nel browser): i prodotti letti con `*` diventano esclusi
 * anche per la categoria e per la conservazione in frigorifero. Le categorie si leggono solo se serve
 * (un prodotto ha `category_id`). Se la lettura cade, vale la spunta e il frigorifero, e altrimenti la
 * frase generale del reso, che nomina già i freschi.
 */
export async function esclusiAncheDallaCategoria<P extends { category_id?: unknown; attributes?: unknown }>(
  supabase: SupabaseClient,
  prodotti: P[],
): Promise<P[]> {
  // Senza categorie da leggere (o se la lettura cade) vale comunque la conservazione in frigorifero.
  if (!prodotti.some((p) => typeof p.category_id === 'string')) return segnaIDeperibili(prodotti, []);
  try {
    const { data, error } = await supabase.from('categories').select('id, slug, parent_id');
    if (error || !Array.isArray(data)) return segnaIDeperibili(prodotti, []);
    return segnaIDeperibili(prodotti, data as CategoriaPerIlRecesso[]);
  } catch {
    return segnaIDeperibili(prodotti, []);
  }
}
