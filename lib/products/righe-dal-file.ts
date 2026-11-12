import { getAttributesForCategory } from '@/lib/category-attributes';
import { cosaMancaPerVendere } from '@/lib/products/prontoPerLaVendita';

/**
 * LE RIGHE DEL CARICAMENTO DA FILE, CON LE REGOLE DEL MODULO (12/11/2026, R09-006).
 *
 * Il caricamento da file scriveva i prodotti direttamente dal browser
 * (`supabase.from('products').insert`): non c'era una rotta in cui mettere il freno
 * `CARICAMENTO_DA_FILE_ACCESO`, e lo stato «in vendita / bozza» lo decideva il browser.
 * Adesso la pagina manda le righe a `POST /api/seller/products/import`, e la rotta
 * ricontrolla ogni riga con queste stesse funzioni: lo stato che arriva dal browser non
 * conta, si ricalcola qui.
 *
 * 🟢 Puro: niente rete, niente database. Le categorie le passa chi chiama.
 */

export type CategoriaDelFile = { id: string; slug: string; parent_id: string | null };

/** Una riga come la scrive il database (`products`), senza il venditore. */
export type RigaDalFile = {
  name: string;
  description: string;
  price: number;
  stock: number;
  category_id: string | null | undefined;
  attributes: Record<string, string>;
};

export const MASSIMO_RIGHE_DAL_FILE = 500;

/** Bozza o in vendita, e cosa manca: la stessa regola del modulo «Nuovo prodotto». */
export function statoDellaRiga(
  r: RigaDalFile,
  categorie: CategoriaDelFile[],
): { status: 'available' | 'draft'; mancanti: string[] } {
  const mancanti = cosaMancaPerVendere({
    name: r.name,
    description: r.description,
    price: r.price,
    haCategoria: Boolean(r.category_id) && categorie.some((c) => c.id === r.category_id),
    categoriaTop: getAttributesForCategory(categorie, r.category_id).topSlug,
    // Il file non porta foto: chi arriva da qui nasce bozza, e la foto si aggiunge dalla scheda.
    numeroFoto: 0,
    attributes: r.attributes,
  });
  return { status: mancanti.length > 0 ? 'draft' : 'available', mancanti };
}

/** I controlli di una riga che il database non deve mai ricevere. Vuoto = la riga va bene. */
export function erroriDellaRiga(r: Partial<RigaDalFile> | null | undefined): string[] {
  const errori: string[] = [];
  const nome = typeof r?.name === 'string' ? r.name.trim() : '';
  if (!nome) errori.push('Nome mancante');
  if (nome.length > 200) errori.push('Nome troppo lungo (max 200)');
  const prezzo = Number(r?.price);
  if (!Number.isFinite(prezzo) || prezzo <= 0) errori.push('Prezzo non valido');
  if (prezzo > 10000) errori.push('Prezzo eccessivo (max 10.000 €)');
  const pezzi = Number(r?.stock);
  if (!Number.isInteger(pezzi) || pezzi < 0 || pezzi > 99999) errori.push('Stock non valido');
  if (r?.description != null && typeof r.description !== 'string') errori.push('Descrizione non valida');
  if (r?.attributes != null && (typeof r.attributes !== 'object' || Array.isArray(r.attributes))) errori.push('Attributi non validi');
  return errori;
}

/** Una riga pulita, con solo le colonne che il file può scrivere. */
export function rigaPulita(r: RigaDalFile): RigaDalFile {
  const attributi: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.attributes ?? {})) {
    if (typeof v === 'string' && v.trim()) attributi[k] = v.trim().slice(0, 2000);
  }
  return {
    name: r.name.trim(),
    description: String(r.description ?? '').trim(),
    price: Number(r.price),
    stock: Number(r.stock),
    category_id: r.category_id || null,
    attributes: attributi,
  };
}
