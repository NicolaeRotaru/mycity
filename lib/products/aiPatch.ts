// lib/products/aiPatch.ts
import {
  getAttributesForCategory,
  AI_ATTR_TO_FIELD,
} from '@/lib/category-attributes';
import { PRODUCT_UNITS, SELLER_STATUSES, normalizeCondition } from '@/lib/products/schema';

/**
 * Risoluzione server-side del patch proposto dall'assistente AI in un payload
 * di UPDATE per la tabella `products`.
 *
 * È il gemello server di `applyPatch` in ProductForm: stesse regole (categoria
 * a due livelli, attributi validati contro lo schema della categoria effettiva,
 * tag come lista completa, condizione/compare_at_price annullabili), ma invece
 * di scrivere nello stato di un form produce l'oggetto `update` da passare a
 * Supabase. Vive qui — non in una route — così è testabile in isolamento e
 * condiviso tra la chat catalogo e l'eventuale apply.
 *
 * Sicurezza: NON tocca mai `seller_id`, `images` o colonne esterne; valida ogni
 * campo prima di includerlo. I valori liberi che non passano la validazione
 * vengono semplicemente ignorati (mai scritti).
 */

export type AiProductPatch = {
  name?: string;
  description?: string;
  price?: number;
  compare_at_price?: number | null;
  unit?: string;
  condition?: string | null;
  stock?: number;
  unlimited_stock?: boolean;
  category_slug?: string;
  subcategory_name?: string;
  tags?: string[];
  attributes?: Record<string, string>;
  attributes_remove?: string[];
  status?: string;
};

export type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
};

export type CurrentProduct = {
  attributes: Record<string, unknown> | null;
  category_id: string | null;
  has_variants?: boolean | null;
  /** 192 — serve alla banda di sicurezza sul prezzo: senza il valore attuale
   *  non si puo' dire se una proposta e' ragionevole o un errore di battitura
   *  del modello. Assente = nessuna banda, come prima. */
  price?: number | string | null;
};

export type ResolvedPatch = {
  /** Colonne da scrivere su `products` (vuoto = niente da cambiare). */
  update: Record<string, unknown>;
  /** Etichette in italiano dei campi modificati (feedback in chat). */
  changed: string[];
};

/** Risolve slug categoria (+ nome sottocategoria) → category_id a due livelli. */
function resolveCategoryId(
  categories: CategoryRow[],
  slug: string,
  subName?: string,
): string | null {
  const top = categories.find((c) => !c.parent_id && c.slug === slug);
  if (!top) return null;
  if (subName) {
    const norm = subName.trim().toLowerCase();
    const sub = categories.find(
      (c) => c.parent_id === top.id && c.name.toLowerCase() === norm,
    );
    if (sub) return sub.id;
  }
  return top.id;
}

/**
 * 27/8/2026 (R145) — LA BANDA SUL PREZZO, IN UN POSTO SOLO.
 *
 * Stava dentro `resolveAiPatch`, cioe' solo sulla strada del server: i
 * suggerimenti che tornano al browser (migliora tutto, diagnosi, chat sul
 * prodotto, testo per Google, traduzione, codice a barre) li applicava il
 * modulo del prodotto, che sul prezzo non guardava niente. Uno zero perso dal
 * modello — 20 € che diventano 2 € — entrava in vetrina.
 *
 * Sopra questa soglia la decisione e' del negoziante, non del modello: il
 * prezzo non si applica e non si tronca nemmeno. Troncare avrebbe scritto
 * comunque un prezzo che nessuno ha deciso.
 */
export const BANDA_PREZZO_AI = 0.30;

/**
 * 30/8/2026 (R158) — LA MISURA DEL NOME E DELLA DESCRIZIONE, IN UN POSTO SOLO.
 *
 * Chi CREA un prodotto dalle foto tronca da sempre (`draftFromVision`); chi lo
 * MODIFICA — questa funzione — accettava qualunque lunghezza col solo controllo
 * «stringa non vuota» e la scriveva nel database, dove le due colonne sono
 * `text` senza vincolo. Un nome di diecimila caratteri entrava in vetrina, nei
 * risultati di ricerca, nelle email di conferma e nella pagina pubblica del
 * negozio.
 *
 * I due numeri stavano scritti a mano dentro `draftFromVision`. Adesso stanno
 * qui e li leggono tutte e due le strade, piu' il vincolo sulla tabella
 * (migrazione 149) che copre anche la scrittura diretta dal browser.
 */
export const MAX_NOME_PRODOTTO = 120;
export const MAX_DESCRIZIONE_PRODOTTO = 4000;

/** Vero se il prezzo proposto si scosta dall'attuale piu' della banda. */
export function prezzoAiFuoriBanda(
  proposto: number,
  attuale: number | string | null | undefined,
): boolean {
  const partenza = Number(attuale ?? 0);
  if (!(partenza > 0)) return false; // prodotto nuovo: non c'e' niente da confrontare
  return Math.abs(proposto - partenza) / partenza > BANDA_PREZZO_AI;
}

/** Il motivo, scritto come lo legge il negoziante. */
export function motivoPrezzoRifiutato(proposto: number, attuale: number | string | null | undefined): string {
  const partenza = Number(attuale ?? 0);
  return `prezzo NON applicato (${partenza.toFixed(2)} → ${proposto.toFixed(2)} €: oltre il ${Math.round(
    BANDA_PREZZO_AI * 100,
  )}%, va deciso a mano)`;
}

/**
 * Il filtro che il MODULO del prodotto passa sopra ogni suggerimento prima di
 * scriverlo nei campi. Toglie quello che non deve entrare (oggi: il prezzo
 * fuori banda) e restituisce i motivi da mostrare, con le stesse parole del
 * server.
 */
export function patchAiPerIlForm<T extends { price?: number }>(
  patch: T,
  opts: { prezzoAttuale?: number | string | null },
): { patch: T; rifiutati: string[] } {
  const rifiutati: string[] = [];
  if (typeof patch.price === 'number' && patch.price > 0 && prezzoAiFuoriBanda(patch.price, opts.prezzoAttuale)) {
    rifiutati.push(motivoPrezzoRifiutato(patch.price, opts.prezzoAttuale));
    const { price: _scartato, ...resto } = patch;
    return { patch: resto as T, rifiutati };
  }
  return { patch, rifiutati };
}

export function resolveAiPatch(opts: {
  patch: AiProductPatch;
  current: CurrentProduct;
  categories: CategoryRow[];
}): ResolvedPatch {
  const { patch, current, categories } = opts;
  const update: Record<string, unknown> = {};
  const changed: string[] = [];

  if (typeof patch.name === 'string' && patch.name.trim()) {
    // R158 — Il taglio e' lo stesso che fa chi crea il prodotto dalle foto.
    update.name = patch.name.trim().slice(0, MAX_NOME_PRODOTTO);
    changed.push('nome');
  }
  if (typeof patch.description === 'string' && patch.description.trim()) {
    update.description = patch.description.trim().slice(0, MAX_DESCRIZIONE_PRODOTTO);
    changed.push('descrizione');
  }
  if (typeof patch.price === 'number' && patch.price > 0) {
    // 192 — Banda di sicurezza sul prezzo proposto dal modello. La regola sta
    // in `prezzoAiFuoriBanda`, e da li' la legge anche il modulo del prodotto
    // nel browser (R145): finche' era scritta solo qui, meta' dei suggerimenti
    // non ci passava.
    if (prezzoAiFuoriBanda(patch.price, current.price)) {
      changed.push(motivoPrezzoRifiutato(patch.price, current.price));
    } else {
      update.price = patch.price;
      changed.push('prezzo');
    }
  }
  if ('compare_at_price' in patch) {
    if (patch.compare_at_price == null) {
      update.compare_at_price = null;
      changed.push('prezzo pieno');
    } else if (typeof patch.compare_at_price === 'number' && patch.compare_at_price > 0) {
      update.compare_at_price = patch.compare_at_price;
      changed.push('prezzo pieno');
    }
  }
  if (patch.unit && (PRODUCT_UNITS as readonly string[]).includes(patch.unit)) {
    update.unit = patch.unit;
    changed.push('unità');
  }
  if ('condition' in patch) {
    if (patch.condition == null) {
      update.condition = null;
      changed.push('condizione');
    } else {
      const norm = normalizeCondition(String(patch.condition));
      update.condition = norm || null;
      changed.push('condizione');
    }
  }

  // Stock: ignorato sui prodotti con varianti (lo stock è la somma delle
  // varianti, riallineato dal trigger DB).
  if (!current.has_variants) {
    if (patch.unlimited_stock === true) {
      update.stock = null;
      changed.push('disponibilità');
    } else if (typeof patch.stock === 'number' && patch.stock >= 0) {
      update.stock = Math.trunc(patch.stock);
      changed.push('disponibilità');
    }
  }

  // Categoria → risolvi slug/sottocategoria su category_id. L'attributo
  // validation usa la categoria EFFETTIVA (post-cambio).
  let effectiveCategoryId = current.category_id ?? null;
  if (patch.category_slug) {
    const resolved = resolveCategoryId(categories, patch.category_slug, patch.subcategory_name);
    if (resolved) {
      update.category_id = resolved;
      effectiveCategoryId = resolved;
      changed.push('categoria');
    }
  }

  if (Array.isArray(patch.tags)) {
    const next: string[] = [];
    for (const raw of patch.tags) {
      const t = String(raw).trim().toLowerCase().replace(/,+$/, '');
      if (t && !next.includes(t) && next.length < 15) next.push(t);
    }
    update.tags = next;
    changed.push('tag');
  }

  // Attributi: parti dallo stato attuale e applica set/rimozioni, validando i
  // set contro i campi della categoria effettiva.
  const hasAttrSet = patch.attributes && typeof patch.attributes === 'object';
  const hasAttrRemove = Array.isArray(patch.attributes_remove) && patch.attributes_remove.length > 0;
  if (hasAttrSet || hasAttrRemove) {
    const merged: Record<string, unknown> = { ...(current.attributes ?? {}) };
    const { fields } = getAttributesForCategory(
      categories.map((c) => ({ id: c.id, slug: c.slug, parent_id: c.parent_id })),
      effectiveCategoryId,
    );
    if (hasAttrSet) {
      for (const [aiKey, rawValue] of Object.entries(patch.attributes!)) {
        const value = typeof rawValue === 'string' ? rawValue.trim() : '';
        if (!value) continue;
        const targetKey = AI_ATTR_TO_FIELD[aiKey] ?? aiKey;
        const field = fields.find((f) => f.key === targetKey);
        if (!field) continue;
        if (field.type === 'select' && !(field.options ?? []).includes(value)) continue;
        merged[targetKey] = value;
        changed.push(field.label);
      }
    }
    if (hasAttrRemove) {
      for (const key of patch.attributes_remove!) {
        const targetKey = AI_ATTR_TO_FIELD[key] ?? key;
        if (targetKey in merged) {
          delete merged[targetKey];
          changed.push(`rimosso ${targetKey}`);
        }
      }
    }
    update.attributes = merged;
  }

  if (patch.status && (SELLER_STATUSES as readonly string[]).includes(patch.status)) {
    update.status = patch.status;
    changed.push('stato');
  }

  return { update, changed };
}
