import { NextResponse } from 'next/server';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { rateLimitAsync } from '@/lib/rate-limit';
import { getAdminSupabase } from '@/lib/supabase/server';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';

/**
 * 12/11/2026 (R04-025, revisione) — SCARTARE UN LAVORO PRONTO.
 *
 * Con un lavoro aperto la rotta di avvio rifiuta un secondo lavoro e dice
 * «applicalo o scartalo»: ma scartarlo non si poteva, e un lavoro pronto che
 * non si voleva costringeva ad applicarlo. Qui si scarta: solo un lavoro
 * PRONTO (i risultati ci sono, niente gira presso il fornitore) e solo del
 * venditore che lo chiede. Non si applica niente e non si spende niente.
 */
export const runtime = 'nodejs';

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  const rl = await rateLimitAsync({ key: `ai-catalog-batch-cancel:${user.id}`, max: 30, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let body: { jobId?: unknown };
  try {
    body = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('JSON non valido');
  }
  const jobId = typeof body.jobId === 'string' ? body.jobId : '';
  if (!jobId) return ApiErrors.invalidRequest('Job mancante.');

  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from('catalog_ai_jobs')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('seller_id', user.id)
    .eq('status', 'ready')
    .select('id');
  if (error) return ApiErrors.badGateway('Non sono riuscito a scartare il lavoro. Riprova.');
  if (!data || data.length === 0) {
    return ApiErrors.conflict('Si può scartare solo un tuo lavoro pronto da rivedere.');
  }
  return NextResponse.json({ jobId, status: 'canceled' });
});
