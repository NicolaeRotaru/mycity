import { NextResponse } from 'next/server';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { rateLimit } from '@/lib/rate-limit';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { resolveAiPatch, type AiProductPatch, type CategoryRow } from '@/lib/products/aiPatch';
import {
  productSnapshot,
  PRODUCT_SNAPSHOT_COLS,
  type ProductRow,
} from '@/lib/products/aiSnapshot';

/**
 * Applica al prodotto un patch confermato dal venditore nella chat Assistenza.
 *
 * Separato dalla chat (/api/ai/catalog-chat) di proposito: la chat PROPONE, qui
 * si SCRIVE — ma solo dopo che il venditore ha premuto "Applica" sulla card di
 * riepilogo (human-in-the-loop). La risoluzione del patch è server-side e
 * validata (lib/products/aiPatch); la scrittura è sempre vincolata a
 * seller_id = utente (anche admin scrive solo prodotti propri qui).
 */

export const runtime = 'nodejs';

type ApplyBody = { productId?: string; patch?: AiProductPatch };

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  const rl = rateLimit({ key: `ai-catalog-apply:${user.id}`, max: 60, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let body: ApplyBody;
  try {
    body = await req.json();
  } catch {
    return ApiErrors.invalidRequest('JSON non valido');
  }

  const productId = typeof body.productId === 'string' ? body.productId : '';
  const patch = body.patch && typeof body.patch === 'object' ? body.patch : null;
  if (!productId) return ApiErrors.invalidRequest('Prodotto mancante.');
  if (!patch) return ApiErrors.invalidRequest('Nessuna modifica da applicare.');

  const admin = getAdminSupabase();

  const [{ data: row }, { data: categoriesData }] = await Promise.all([
    admin.from('products').select(`${PRODUCT_SNAPSHOT_COLS}, seller_id`).eq('id', productId).single(),
    admin.from('categories').select('id, name, slug, parent_id').order('name'),
  ]);

  if (!row) return ApiErrors.notFound('Prodotto non trovato.');
  if ((row as { seller_id?: string }).seller_id !== user.id) {
    return ApiErrors.forbidden('Non puoi modificare un prodotto che non è tuo.');
  }

  const categories = (categoriesData ?? []) as CategoryRow[];
  const current = row as unknown as ProductRow;

  const { update, changed } = resolveAiPatch({
    patch,
    current: {
      attributes: current.attributes ?? null,
      category_id: current.category_id,
      has_variants: current.has_variants,
    },
    categories,
  });

  if (Object.keys(update).length === 0) {
    return ApiErrors.invalidRequest('Nessuna modifica valida da applicare.');
  }

  const { data: updated, error } = await admin
    .from('products')
    .update(update)
    .eq('id', productId)
    .eq('seller_id', user.id)
    .select(PRODUCT_SNAPSHOT_COLS)
    .single();

  if (error || !updated) {
    logger.error('catalog-apply update failed', { productId, status: error?.code });
    return ApiErrors.badGateway('Non sono riuscito a salvare. Riprova.');
  }

  return NextResponse.json({
    ok: true,
    changed,
    product: productSnapshot(updated as unknown as ProductRow, categories),
  });
});
