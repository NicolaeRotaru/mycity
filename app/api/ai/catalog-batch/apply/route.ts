import { NextResponse } from 'next/server';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { rateLimit } from '@/lib/rate-limit';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { resolveAiPatch, type CategoryRow } from '@/lib/products/aiPatch';
import { PRODUCT_SNAPSHOT_COLS, type ProductRow } from '@/lib/products/aiSnapshot';
import type { CatalogJobResult, CatalogOperation } from '@/lib/ai/catalogBatch';

/**
 * Applica i risultati di un job AI massivo, dopo che il venditore li ha rivisti.
 * Per le operazioni con patch (improve/redescribe/translate) risolve e scrive il
 * patch su ogni prodotto selezionato; per "moderate" mette in bozza i prodotti
 * segnalati. Scrittura sempre vincolata a seller_id = utente. Separato da
 * /status di proposito: lo /status PROPONE, qui si SCRIVE.
 */

export const runtime = 'nodejs';

type Body = { jobId?: string; productIds?: string[] };

type JobRow = {
  id: string;
  seller_id: string;
  operation: CatalogOperation;
  status: string;
  results: CatalogJobResult[] | null;
};

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  const rl = rateLimit({ key: `ai-catalog-batch-apply:${user.id}`, max: 20, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return ApiErrors.invalidRequest('JSON non valido');
  }
  const jobId = typeof body.jobId === 'string' ? body.jobId : '';
  if (!jobId) return ApiErrors.invalidRequest('Job mancante.');
  const onlyIds = Array.isArray(body.productIds)
    ? new Set(body.productIds.filter((s): s is string => typeof s === 'string'))
    : null;

  const admin = getAdminSupabase();
  const { data } = await admin
    .from('catalog_ai_jobs')
    .select('id, seller_id, operation, status, results')
    .eq('id', jobId)
    .single();

  const job = data as JobRow | null;
  if (!job) return ApiErrors.notFound('Job non trovato.');
  if (job.seller_id !== user.id) return ApiErrors.forbidden('Non è un tuo job.');
  if (job.status !== 'ready') return ApiErrors.invalidRequest('Il job non è pronto da applicare.');

  const results = (Array.isArray(job.results) ? job.results : []).filter(
    (r) => r.product_id && (!onlyIds || onlyIds.has(r.product_id)),
  );
  if (results.length === 0) return ApiErrors.invalidRequest('Nessun risultato da applicare.');

  const { data: categoriesData } = await admin
    .from('categories')
    .select('id, name, slug, parent_id')
    .order('name');
  const categories = (categoriesData ?? []) as CategoryRow[];

  let applied = 0;

  if (job.operation === 'moderate') {
    // "Applica" = metti in bozza i prodotti segnalati (de-pubblica).
    const flaggedIds = results.filter((r) => r.flagged).map((r) => r.product_id);
    if (flaggedIds.length > 0) {
      const { data: updated } = await admin
        .from('products')
        .update({ status: 'draft' })
        .eq('seller_id', user.id)
        .in('id', flaggedIds)
        .select('id');
      applied = (updated ?? []).length;
    }
  } else {
    // Patch: carica i prodotti correnti del venditore e applica uno per uno.
    const ids = results.filter((r) => r.patch && Object.keys(r.patch).length > 0).map((r) => r.product_id);
    if (ids.length > 0) {
      const { data: rows } = await admin
        .from('products')
        .select(`${PRODUCT_SNAPSHOT_COLS}, seller_id`)
        .eq('seller_id', user.id)
        .in('id', ids);
      const current = new Map((rows ?? []).map((r) => [(r as { id: string }).id, r as unknown as ProductRow]));

      for (const r of results) {
        if (!r.patch || Object.keys(r.patch).length === 0) continue;
        const row = current.get(r.product_id);
        if (!row) continue;
        const { update } = resolveAiPatch({
          patch: r.patch,
          current: { attributes: row.attributes ?? null, category_id: row.category_id, has_variants: row.has_variants },
          categories,
        });
        if (Object.keys(update).length === 0) continue;
        const { error } = await admin
          .from('products')
          .update(update)
          .eq('id', r.product_id)
          .eq('seller_id', user.id);
        if (!error) applied += 1;
      }
    }
  }

  await admin
    .from('catalog_ai_jobs')
    .update({ status: 'applied', updated_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('seller_id', user.id);

  logger.info('catalog-batch applied', { jobId: job.id, operation: job.operation, applied });
  return NextResponse.json({ ok: true, applied });
});
