import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { rateLimitAsync } from '@/lib/rate-limit';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { buildDraftProductInsert } from '@/lib/products/draftFromVision';
import type { CategoryRow } from '@/lib/products/aiPatch';
import {
  productSnapshot,
  PRODUCT_SNAPSHOT_COLS,
  type ProductRow,
} from '@/lib/products/aiSnapshot';

/**
 * Crea PIÙ prodotti (BOZZE) in un colpo solo dalle foto, dopo che il venditore
 * ha rivisto la lista proposta da /api/vision/extract-products. Gemello massivo
 * di /api/ai/catalog-create: stessa validazione per-prodotto (sorgente unica
 * buildDraftProductInsert), ma un solo insert in batch. Nasce tutto come
 * 'draft': autonomo nell'inserimento, non pubblico finché il venditore non
 * pubblica. Scrittura sempre vincolata a seller_id = utente.
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
  items: z
    .array(
      z.object({
        imageUrls: z.array(z.string().url()).min(1).max(8),
        draft: DraftSchema,
      }),
    )
    .min(1)
    .max(12),
});

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  // Ogni call crea fino a 12 prodotti: rate limit per evitare flood.
  const rl = rateLimit({ key: `ai-catalog-create-bulk:${user.id}`, max: 10, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return ApiErrors.invalidRequest('JSON non valido');
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return ApiErrors.invalidRequest('Dati prodotti non validi.');

  const admin = getAdminSupabase();
  const { data: categoriesData } = await admin
    .from('categories')
    .select('id, name, slug, parent_id')
    .order('name');
  const categories = (categoriesData ?? []) as CategoryRow[];

  // Costruisci un insert validato per ogni item con almeno una foto valida.
  const payloads = parsed.data.items
    .map((item) => {
      const imageUrls = item.imageUrls.filter((u) => /^https?:\/\//i.test(u));
      if (imageUrls.length === 0) return null;
      return buildDraftProductInsert({ draft: item.draft, imageUrls, categories, sellerId: user.id });
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (payloads.length === 0) {
    return ApiErrors.invalidRequest('Nessun prodotto con foto valide da creare.');
  }

  const { data: created, error } = await admin
    .from('products')
    .insert(payloads)
    .select(PRODUCT_SNAPSHOT_COLS);

  if (error || !created) {
    logger.error('catalog-create-bulk insert failed', {
      sellerId: user.id,
      count: payloads.length,
      status: error?.code,
    });
    return ApiErrors.badGateway('Non sono riuscito a creare i prodotti. Riprova.');
  }

  return NextResponse.json({
    ok: true,
    count: created.length,
    products: (created as unknown as ProductRow[]).map((row) => productSnapshot(row, categories)),
  });
});
