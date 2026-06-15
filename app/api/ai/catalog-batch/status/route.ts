import { NextResponse } from 'next/server';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { pollBatch, streamBatchResults } from '@/lib/ai/batch';
import { parseCatalogBatchEntry, type CatalogJobResult, type CatalogOperation } from '@/lib/ai/catalogBatch';

/**
 * Stato di un job AI massivo. Se il batch è terminato, ne recupera i risultati
 * una volta sola, li parsa e li salva sul job (status 'ready'). Il venditore
 * legge solo i propri job (verifica seller_id). Best-effort sul polling: se
 * Anthropic non risponde, il job resta 'processing' e si riprova.
 */

export const runtime = 'nodejs';

type JobRow = {
  id: string;
  seller_id: string;
  operation: CatalogOperation;
  status: string;
  batch_id: string | null;
  target_lang: string | null;
  total: number;
  results: CatalogJobResult[] | null;
};

export const GET = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  const jobId = new URL(req.url).searchParams.get('jobId') ?? '';
  if (!jobId) return ApiErrors.invalidRequest('Job mancante.');

  const admin = getAdminSupabase();
  const { data } = await admin
    .from('catalog_ai_jobs')
    .select('id, seller_id, operation, status, batch_id, target_lang, total, results')
    .eq('id', jobId)
    .single();

  const job = data as JobRow | null;
  if (!job) return ApiErrors.notFound('Job non trovato.');
  if (job.seller_id !== user.id) return ApiErrors.forbidden('Non è un tuo job.');

  // Già pronto/applicato: ritorna lo stato salvato.
  if (job.status !== 'processing' || !job.batch_id) {
    return NextResponse.json(serialize(job));
  }

  // Polling del batch.
  let ended = false;
  try {
    const handle = await pollBatch(job.batch_id);
    ended = handle.processingStatus === 'ended';
  } catch {
    // Anthropic non raggiungibile ora: resta processing, si riprova.
    return NextResponse.json(serialize(job));
  }

  if (!ended) return NextResponse.json(serialize(job));

  // Terminato: recupera e parsa i risultati una volta sola.
  try {
    const results: CatalogJobResult[] = [];
    for await (const entry of streamBatchResults(job.batch_id)) {
      results.push(parseCatalogBatchEntry(job.operation, entry));
    }
    const { data: updated } = await admin
      .from('catalog_ai_jobs')
      .update({ status: 'ready', results, updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('seller_id', user.id)
      .select('id, seller_id, operation, status, batch_id, target_lang, total, results')
      .single();
    return NextResponse.json(serialize((updated as JobRow) ?? { ...job, status: 'ready', results }));
  } catch (err) {
    logger.error('catalog-batch status: fetch results failed', { jobId: job.id });
    return NextResponse.json(serialize(job));
  }
});

function serialize(job: JobRow) {
  const results = Array.isArray(job.results) ? job.results : [];
  const changed = results.filter((r) => (r.patch && Object.keys(r.patch).length > 0) || r.flagged).length;
  return {
    id: job.id,
    operation: job.operation,
    status: job.status,
    total: job.total,
    targetLang: job.target_lang,
    results,
    counts: { total: results.length, withChanges: changed },
  };
}
