import { NextResponse } from 'next/server';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { rateLimit } from '@/lib/rate-limit';
import { env } from '@/lib/env';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { AiConfigError } from '@/lib/ai/client';
import { submitBatch } from '@/lib/ai/batch';
import {
  buildCatalogBatchRequests,
  isCatalogOperation,
  isSupportedLang,
  type CatalogOperation,
} from '@/lib/ai/catalogBatch';
import { PRODUCT_SNAPSHOT_COLS, type ProductRow } from '@/lib/products/aiSnapshot';
import type { CategoryRow } from '@/lib/products/aiPatch';

/**
 * Avvia un job AI massivo sul catalogo (Batch API). Costruisce una richiesta per
 * prodotto, invia il batch ad Anthropic e crea la riga di tracciamento. NON
 * applica nulla: i risultati si recuperano via /status e si applicano via
 * /apply (human-in-the-loop). Scrittura vincolata a seller_id = utente.
 */

export const runtime = 'nodejs';

const MAX_PRODUCTS = 200;

type Body = { operation?: string; targetLang?: string };

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  if (!env.anthropicKey()) return ApiErrors.unavailable('Servizio AI non configurato.');
  // Job pesante: pochi avvii per ora.
  const rl = rateLimit({ key: `ai-catalog-batch-start:${user.id}`, max: 5, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return ApiErrors.invalidRequest('JSON non valido');
  }
  if (!isCatalogOperation(body.operation)) {
    return ApiErrors.invalidRequest('Operazione non valida.');
  }
  const operation: CatalogOperation = body.operation;
  const targetLang = operation === 'translate' ? body.targetLang : undefined;
  if (operation === 'translate' && !isSupportedLang(targetLang)) {
    return ApiErrors.invalidRequest('Lingua di destinazione non supportata.');
  }

  const admin = getAdminSupabase();
  const [{ data: productsData }, { data: categoriesData }] = await Promise.all([
    admin
      .from('products')
      .select(PRODUCT_SNAPSHOT_COLS)
      .eq('seller_id', user.id)
      .in('status', ['available', 'draft'])
      .order('created_at', { ascending: false })
      .limit(MAX_PRODUCTS),
    admin.from('categories').select('id, name, slug, parent_id').order('name'),
  ]);

  const products = (productsData ?? []) as ProductRow[];
  const categories = (categoriesData ?? []) as CategoryRow[];
  if (products.length === 0) {
    return ApiErrors.invalidRequest('Non hai prodotti pubblicati o in bozza su cui lavorare.');
  }

  const requests = buildCatalogBatchRequests({ operation, products, categories, targetLang });

  try {
    const handle = await submitBatch(requests);
    const { data: job, error } = await admin
      .from('catalog_ai_jobs')
      .insert({
        seller_id: user.id,
        operation,
        status: 'processing',
        batch_id: handle.id,
        target_lang: targetLang ?? null,
        total: products.length,
      })
      .select('id')
      .single();

    if (error || !job) {
      logger.error('catalog-batch start: insert job failed', { sellerId: user.id, status: error?.code });
      return ApiErrors.badGateway('Job avviato ma non tracciato. Riprova.');
    }

    return NextResponse.json({ jobId: job.id, total: products.length, status: 'processing' });
  } catch (err) {
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    logger.error('catalog-batch start: submit failed', { sellerId: user.id });
    return ApiErrors.badGateway('Non sono riuscito ad avviare il job. Riprova.');
  }
});
