// lib/products/aiSnapshot.ts
import type { CategoryRow } from '@/lib/products/aiPatch';

/**
 * Snapshot leggibile di un prodotto, condiviso tra la chat catalogo
 * (/api/ai/catalog-chat), l'apply (/api/ai/catalog-apply) e il client. È il
 * "DATO prodotto" che l'AI legge e che la UI mostra nella card di conferma.
 */

export type ProductRow = {
  id: string;
  name: string | null;
  description: string | null;
  price: number | string | null;
  compare_at_price: number | string | null;
  unit: string | null;
  condition: string | null;
  stock: number | null;
  status: string | null;
  category_id: string | null;
  images: string[] | null;
  attributes: Record<string, unknown> | null;
  tags: string[] | null;
  has_variants: boolean | null;
};

/** Colonne `products` da selezionare per costruire lo snapshot. */
export const PRODUCT_SNAPSHOT_COLS =
  'id, name, description, price, compare_at_price, unit, condition, stock, status, category_id, images, attributes, tags, has_variants';

export type ProductSnapshot = {
  id: string;
  name: string;
  description: string;
  price: number | null;
  compareAtPrice: number | null;
  unit: string;
  condition: string | null;
  stock: number | null;
  status: string;
  categorySlug: string | null;
  subcategoryName: string | null;
  categoryName: string | null;
  tags: string[];
  attributes: Record<string, unknown>;
  image: string | null;
  hasVariants: boolean;
};

export function productSnapshot(row: ProductRow, categories: CategoryRow[]): ProductSnapshot {
  const node = categories.find((c) => c.id === row.category_id);
  const parent = node?.parent_id ? categories.find((c) => c.id === node.parent_id) : null;
  const topSlug = (parent ?? node)?.slug ?? null;
  const subName = parent ? node?.name ?? null : null;
  return {
    id: row.id,
    name: row.name ?? '',
    description: row.description ?? '',
    price: row.price != null ? Number(row.price) : null,
    compareAtPrice: row.compare_at_price != null ? Number(row.compare_at_price) : null,
    unit: row.unit ?? 'pezzo',
    condition: row.condition ?? null,
    stock: row.stock,
    status: row.status ?? 'available',
    categorySlug: topSlug,
    subcategoryName: subName,
    categoryName: node?.name ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    attributes: row.attributes ?? {},
    image: Array.isArray(row.images) && row.images[0] ? row.images[0] : null,
    hasVariants: Boolean(row.has_variants),
  };
}
