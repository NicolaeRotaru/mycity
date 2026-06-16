// lib/products/visionShared.ts
import { CATEGORY_ATTRIBUTES } from '@/lib/category-attributes';
import type { CategoryRow } from '@/lib/products/aiPatch';

/**
 * Pezzi condivisi tra le route di estrazione-da-foto (vision): l'elenco degli
 * slug di categoria ammessi, il riferimento attributi per categoria iniettato
 * nel prompt e la risoluzione categoria/sottocategoria da testo libero. Vivono
 * qui per essere riusati dall'estrazione singola e da quella multi-prodotto
 * senza divergenze.
 */

export const CATEGORY_SLUGS = [
  'alimentari',
  'abbigliamento',
  'casa',
  'elettronica',
  'libri',
  'giardino',
  'bellezza',
  'sport',
] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

/**
 * Riferimento chiavi attributo per categoria, derivato dallo schema condiviso:
 * il modello compila gli stessi campi del form (incluse le tendine) usando
 * esattamente le chiavi e i valori ammessi.
 */
export const ATTR_REFERENCE = Object.entries(CATEGORY_ATTRIBUTES)
  .map(([slug, fields]) => {
    const parts = fields.map((f) => {
      if (f.type === 'select' && f.options?.length) return `${f.key} (uno tra: ${f.options.join(' | ')})`;
      if (f.type === 'checkbox') return `${f.key} (true/false)`;
      if (f.type === 'number') return `${f.key} (numero)`;
      if (f.type === 'date') return `${f.key} (data AAAA-MM-GG)`;
      return f.key;
    });
    return `- ${slug}: ${parts.join(', ')}`;
  })
  .join('\n');

/**
 * Normalizza un'etichetta per il confronto: minuscolo, senza accenti,
 * punteggiatura ridotta a spazi e spazi collassati.
 */
export function normalizeLabel(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type ResolvedVisionCategory = {
  categoryId: string | null;
  subcategoryId: string | null;
  categoryName: string | null;
};

/**
 * Risolve, da una lista di categorie già caricata, la categoria di primo
 * livello dallo slug e — se il testo libero combacia — la sottocategoria figlia.
 * In-memory: nessuna query per prodotto (chiave per il flusso multi-prodotto).
 */
export function resolveVisionCategory(
  categories: CategoryRow[],
  slug: string | undefined,
  subText: string | undefined,
): ResolvedVisionCategory {
  const top = slug ? categories.find((c) => !c.parent_id && c.slug === slug) ?? null : null;
  if (!top) return { categoryId: null, subcategoryId: null, categoryName: null };

  let subcategoryId: string | null = null;
  let subName: string | null = null;
  const wanted = typeof subText === 'string' ? normalizeLabel(subText) : '';
  if (wanted) {
    const match = categories.find((c) => {
      if (c.parent_id !== top.id) return false;
      const name = normalizeLabel(c.name ?? '');
      const sslug = normalizeLabel((c.slug ?? '').replace(/-/g, ' '));
      return name === wanted || sslug === wanted || name.includes(wanted) || wanted.includes(name);
    });
    if (match) {
      subcategoryId = match.id;
      subName = match.name;
    }
  }

  return { categoryId: top.id, subcategoryId, categoryName: subName ?? top.name };
}
