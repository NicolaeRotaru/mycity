// lib/products/draftFromVision.ts
import { getAttributesForCategory, type AttributeField } from '@/lib/category-attributes';
import { condizioneDalSuggerimento } from '@/lib/products/schema';
import {
  MAX_NOME_PRODOTTO,
  MAX_DESCRIZIONE_PRODOTTO,
  chiaveCampo,
  eCampoDichiarativo,
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
  /**
   * R36 — Il negoziante ha visto allergeni, ingredienti e le altre
   * dichiarazioni lette dalle foto, e ha spuntato «le ho controllate».
   */
  dichiarazioni_confermate?: boolean;
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

/**
 * La regola della porta su UN attributo letto dalle foto: la chiave del campo
 * della categoria e il valore che entra nella bozza, oppure `null` se resta
 * fuori (valore vuoto, campo che la categoria non ha, scelta non fra quelle
 * ammesse). La legge anche la scheda della bozza nella chat, per mostrare solo
 * le caratteristiche che entreranno davvero (16/10/2026): prima mostrava
 * «Tipo di confezione: Vaschetta» e «Colore: Verde» su un barattolo di olive,
 * e nella bozza entrava solo il peso.
 */
export function attributoCheEntra(
  fields: AttributeField[],
  aiKey: string,
  rawValue: unknown,
): { chiave: string; valore: string } | null {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) return null;
  const chiave = chiaveCampo(aiKey);
  const field = fields.find((f) => f.key === chiave);
  if (!field) return null;
  if (field.type === 'select') {
    const opt = (field.options ?? []).find((o) => o.toLowerCase() === value.toLowerCase());
    return opt ? { chiave, valore: opt } : null;
  }
  return { chiave, valore: value.slice(0, MAX_VALORE_ATTRIBUTO) };
}

/**
 * 15/10/2026 (R36) — LE DICHIARAZIONI LETTE DAL MODELLO ENTRAVANO NELLA BOZZA
 * SENZA CHE NESSUNO LE AVESSE VISTE.
 *
 * Il fornaio crea la focaccia con «Crea più prodotti dalle foto». Il modello
 * compila da solo `allergeni: Glutine` e gli ingredienti; il riepilogo mostra
 * nome e prezzo, non quelli. La bozza nasce con i campi obbligatori pieni, e
 * dalla chat o dal Copilot un «pubblica» la mette in vendita: il controllo dei
 * campi obbligatori vede valori non vuoti e passa. Una dichiarazione che il
 * negoziante non ha mai letto finisce davanti a un cliente allergico.
 *
 * La porta e' questa, l'unica da cui nasce una bozza dalle foto: allergeni,
 * ingredienti e le altre dichiarazioni (`CAMPI_DICHIARATIVI`) entrano SOLO se
 * chi chiama dice che il negoziante le ha confermate. Nel dubbio restano fuori:
 * la bozza nasce senza, i campi obbligatori vuoti fermano la pubblicazione da
 * ogni strada, e il negoziante li scrive nella scheda. Una schermata nuova che
 * dimentica la spunta crea bozze senza dichiarazioni, non bozze con
 * dichiarazioni mai viste.
 */
export function buildDraftProductInsert(opts: {
  draft: VisionDraft;
  imageUrls: string[];
  categories: CategoryRow[];
  sellerId: string;
}): DraftProductInsert {
  const { draft, imageUrls, categories, sellerId } = opts;
  const dichiarazioniConfermate = draft.dichiarazioni_confermate === true;
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
      // 16/10/2026 — La chiave si legge come la legge il riquadro della bozza
      // (`chiaveCampo`): «Allergeni» con la maiuscola o «valori nutrizionali»
      // con lo spazio venivano scartate qui, mentre il riquadro le dava per
      // entrate. Il negoziante leggeva «Entrate nella bozza» e, sotto,
      // «Manca: Allergeni».
      const targetKey = chiaveCampo(aiKey);
      if (targetKey === 'condizione') {
        // «usato» e «ricondizionato» non entrano nella bozza: MyCity non vende l'usato.
        condition = condizioneDalSuggerimento(value) || null;
        continue;
      }
      if (!dichiarazioniConfermate && eCampoDichiarativo(targetKey)) continue;
      const entra = attributoCheEntra(fields, aiKey, value);
      if (entra) attributes[entra.chiave] = entra.valore;
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
