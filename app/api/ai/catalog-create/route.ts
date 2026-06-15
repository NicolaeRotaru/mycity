import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { rateLimit } from '@/lib/rate-limit';
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
  const rl = rateLimit({ key: `ai-catalog-create:${user.id}`, max: 30, windowMs: 60 * 60_000 });
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

  // Categoria, attributi, condizione, tag, prezzo: risolti e validati dalla
  // sorgente unica condivisa con la creazione multi-prodotto. Mai fidarsi
  // ciecamente del client.
  const payload = buildDraftProductInsert({ draft, imageUrls, categories, sellerId: user.id });

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
