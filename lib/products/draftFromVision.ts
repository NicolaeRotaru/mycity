// lib/products/draftFromVision.ts
import { getAttributesForCategory, AI_ATTR_TO_FIELD } from '@/lib/category-attributes';
import { normalizeCondition } from '@/lib/products/schema';
import {
  MAX_NOME_PRODOTTO,
  MAX_DESCRIZIONE_PRODOTTO,
  type CategoryRow,
} from '@/lib/products/aiPatch';

/**
 * 6/9/2026 — IL TETTO CHE MANCAVA A TUTTO CIÒ CHE FINISCE IN `attributes`.
 *
 * Il 30/8 (R158) il nome e la descrizione hanno preso un tetto condiviso, 120 e
 * 4000 caratteri. Il testo alternativo della foto e i valori testuali degli
 * attributi no: arrivavano dal browser e venivano copiati interi dentro
 * `products.attributes`, che è una colonna JSONB. Con un corpo da un megabyte
 * una sola bozza poteva portarsi dietro un megabyte di JSON: pesa su ogni
 * lettura del catalogo del venditore e su ogni esportazione, e il giorno in cui
 * l'alt finisce nell'HTML pubblico — che è il suo mestiere — la pagina del
 * prodotto pesa un megabyte.
 *
 * Il tetto sta qui e non nello zod delle rotte perché questa è la porta unica:
 * le due rotte che creano bozze passano tutte e due da `buildDraftProductInsert`.
 * Nelle rotte c'è comunque un `.max()` gemello, così chi manda troppo lo sa
 * subito invece di vedersi tagliare il testo in silenzio.
 */
/** Il testo alternativo di una foto: una frase, non un romanzo. */
export const MAX_ALT_TEXT = 300;
/** Il valore testuale di un attributo di categoria (materiale, colore, ...). */
export const MAX_VALORE_ATTRIBUTO = 500;

/**
 * Costruisce il payload di INSERT (status='draft') di un prodotto a partire dai
 * dati estratti dalle foto (vision) + le immagini caricate. Sorgente unica
 * usata sia da /api/ai/catalog-create (un prodotto) sia da
 * /api/ai/catalog-create-bulk (più prodotti), così la validazione è identica:
 * categoria risolta server-side, attributi validati contro lo schema della
 * categoria, condizione estratta, tag normalizzati. Niente fiducia cieca nel
 * client: i valori che non passano la validazione vengono ignorati.
 */

export type VisionDraft = {
  name?: string;
  description?: string;
  category_id?: string | null;
  subcategory_id?: string | null;
  category_slug?: string;
  suggested_price?: number | null;
  attributes?: Record<string, string>;
  tags?: string[];
  alt_text?: string | null;
};

export type DraftProductInsert = {
  name: string;
  description: string;
  price: number;
  compare_at_price: null;
  unit: 'pezzo';
  condition: string | null;
  stock: number;
  category_id: string | null;
  images: string[];
  attributes: Record<string, string>;
  tags: string[];
  express_enabled: null;
  status: 'draft';
  seller_id: string;
};

/** Risolve la categoria effettiva: subcategory_id → category_id → slug. */
function resolveCategoryId(draft: VisionDraft, categories: CategoryRow[]): string | null {
  const byId = (id?: string | null) => (id ? categories.find((c) => c.id === id) ?? null : null);
  const bySlug = (slug?: string) =>
    slug ? categories.find((c) => !c.parent_id && c.slug === slug) ?? null : null;
  const resolved =
    byId(draft.subcategory_id) ?? byId(draft.category_id) ?? bySlug(draft.category_slug);
  return resolved?.id ?? null;
}

export function buildDraftProductInsert(opts: {
  draft: VisionDraft;
  imageUrls: string[];
  categories: CategoryRow[];
  sellerId: string;
}): DraftProductInsert {
  const { draft, imageUrls, categories, sellerId } = opts;
  const categoryId = resolveCategoryId(draft, categories);

  // Attributi: valida contro i campi della categoria; "condizione" → condition.
  const attributes: Record<string, string> = {};
  let condition: string | null = null;
  const { fields } = getAttributesForCategory(
    categories.map((c) => ({ id: c.id, slug: c.slug, parent_id: c.parent_id })),
    categoryId,
  );
  if (draft.attributes) {
    for (const [aiKey, rawValue] of Object.entries(draft.attributes)) {
      const value = typeof rawValue === 'string' ? rawValue.trim() : '';
      if (!value) continue;
      if (aiKey === 'condizione') {
        condition = normalizeCondition(value) || null;
        continue;
      }
      const targetKey = AI_ATTR_TO_FIELD[aiKey] ?? aiKey;
      const field = fields.find((f) => f.key === targetKey);
      if (!field) continue;
      if (field.type === 'select') {
        const opt = (field.options ?? []).find((o) => o.toLowerCase() === value.toLowerCase());
        if (!opt) continue;
        attributes[targetKey] = opt;
      } else {
        attributes[targetKey] = value.slice(0, MAX_VALORE_ATTRIBUTO);
      }
    }
  }
  if (draft.alt_text && draft.alt_text.trim()) {
    attributes.alt_text = draft.alt_text.trim().slice(0, MAX_ALT_TEXT);
  }

  // Tag: lowercase, dedup, max 15.
  const tags: string[] = [];
  if (Array.isArray(draft.tags)) {
    for (const raw of draft.tags) {
      const t = String(raw).trim().toLowerCase().replace(/,+$/, '');
      if (t && t.length <= 30 && !tags.includes(t) && tags.length < 15) tags.push(t);
    }
  }

  // 30/8/2026 (R158) — I due numeri erano scritti a mano qui, e la strada che
  // MODIFICA un prodotto non ne aveva nessuno. Adesso vengono dallo stesso
  // posto: se uno si sposta, si spostano tutti e due.
  const name = (draft.name ?? '').trim().slice(0, MAX_NOME_PRODOTTO) || 'Nuovo prodotto';
  const description = (draft.description ?? '').trim().slice(0, MAX_DESCRIZIONE_PRODOTTO);
  // #204 — Il prezzo mancante diventava silenziosamente 1 euro. Un prodotto da
  // quaranta euro nasceva a uno, e se il venditore pubblicava la bozza senza
  // accorgersene lo vendeva a uno: nessun avviso, nessuna traccia. Ora resta a
  // zero, che nella scheda si vede come «da compilare» e blocca la
  // pubblicazione, invece di sembrare una decisione.
  const price =
    typeof draft.suggested_price === 'number' && draft.suggested_price > 0
      ? Math.round(draft.suggested_price * 100) / 100
      : 0;

  return {
    name,
    description,
    price,
    compare_at_price: null,
    unit: 'pezzo',
    condition,
    stock: 1,
    category_id: categoryId,
    images: imageUrls.slice(0, 8),
    attributes,
    tags,
    express_enabled: null,
    status: 'draft',
    seller_id: sellerId,
  };
}
