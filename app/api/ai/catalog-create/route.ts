import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { rateLimitAsync } from '@/lib/rate-limit';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { getAttributesForCategory, AI_ATTR_TO_FIELD } from '@/lib/category-attributes';
import { normalizeCondition } from '@/lib/products/schema';
import type { CategoryRow } from '@/lib/products/aiPatch';
import {
  productSnapshot,
  PRODUCT_SNAPSHOT_COLS,
  type ProductRow,
} from '@/lib/products/aiSnapshot';

/**
 * Crea un nuovo prodotto (BOZZA) dalle sole foto: l'estrazione AI dei campi è
 * già stata fatta dal client via /api/vision/extract-product; qui validiamo la
 * bozza e la INSERIamo come prodotto del venditore con le foto come immagini.
 *
 * Nasce come 'draft' di proposito: l'inserimento è autonomo (l'AI compila
 * tutto), ma la bozza NON è pubblica finché il venditore non la pubblica — può
 * rivederla e pubblicarla dalla stessa chat o dall'editor. Le immagini e la
 * categoria sono validate/risolte server-side; la scrittura è vincolata a
 * seller_id = utente.
 */

export const runtime = 'nodejs';

const DraftSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  category_id: z.string().uuid().nullable().optional(),
  subcategory_id: z.string().uuid().nullable().optional(),
  category_slug: z.string().optional(),
  suggested_price: z.number().nullable().optional(),
  attributes: z.record(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  alt_text: z.string().nullable().optional(),
});

const BodySchema = z.object({
  imageUrls: z.array(z.string().url()).min(1).max(8),
  draft: DraftSchema,
});

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  const rl = await rateLimitAsync({ key: `ai-catalog-create:${user.id}`, max: 30, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return ApiErrors.invalidRequest('JSON non valido');
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return ApiErrors.invalidRequest('Dati prodotto non validi.');

  const imageUrls = parsed.data.imageUrls.filter((u) => /^https?:\/\//i.test(u)).slice(0, 4);
  if (imageUrls.length === 0) return ApiErrors.invalidRequest('Servono le foto del prodotto.');
  const draft = parsed.data.draft;

  const admin = getAdminSupabase();
  const { data: categoriesData } = await admin
    .from('categories')
    .select('id, name, slug, parent_id')
    .order('name');
  const categories = (categoriesData ?? []) as CategoryRow[];

  // Categoria: usa l'id risolto dalla vision se è una categoria reale; in
  // alternativa risolvi dallo slug. Mai fidarsi ciecamente del client.
  const byId = (id?: string | null) => (id ? categories.find((c) => c.id === id) ?? null : null);
  const bySlug = (slug?: string) => (slug ? categories.find((c) => !c.parent_id && c.slug === slug) ?? null : null);
  const resolvedCategory =
    byId(draft.subcategory_id) ?? byId(draft.category_id) ?? bySlug(draft.category_slug);
  const categoryId = resolvedCategory?.id ?? null;

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
        attributes[targetKey] = value;
      }
    }
  }
  if (draft.alt_text && draft.alt_text.trim()) attributes.alt_text = draft.alt_text.trim();

  // Tag: lowercase, dedup, max 15.
  const tags: string[] = [];
  if (Array.isArray(draft.tags)) {
    for (const raw of draft.tags) {
      const t = String(raw).trim().toLowerCase().replace(/,+$/, '');
      if (t && t.length <= 30 && !tags.includes(t) && tags.length < 15) tags.push(t);
    }
  }

  const name = (draft.name ?? '').trim().slice(0, 120) || 'Nuovo prodotto';
  const description = (draft.description ?? '').trim().slice(0, 4000);
  const price =
    typeof draft.suggested_price === 'number' && draft.suggested_price > 0
      ? Math.round(draft.suggested_price * 100) / 100
      : 1;

  const payload = {
    name,
    description,
    price,
    compare_at_price: null,
    unit: 'pezzo',
    condition,
    stock: 1,
    category_id: categoryId,
    images: imageUrls,
    attributes,
    tags,
    express_enabled: null,
    status: 'draft',
    seller_id: user.id,
  };

  const { data: created, error } = await admin
    .from('products')
    .insert(payload)
    .select(PRODUCT_SNAPSHOT_COLS)
    .single();

  if (error || !created) {
    logger.error('catalog-create insert failed', { sellerId: user.id, status: error?.code });
    return ApiErrors.badGateway('Non sono riuscito a creare il prodotto. Riprova.');
  }

  return NextResponse.json({
    ok: true,
    product: productSnapshot(created as unknown as ProductRow, categories),
  });
});
