import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isStripeConfigured } from '@/lib/stripe/client';
import { releaseOrderPayout } from '@/lib/stripe/payout';
import { withInternalAuth } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { ORE_ATTESA_BONIFICO } from '@/lib/stripe/tempi-bonifico';

/** Gli stessi cancelli del giro dei bonifici (app/api/cron/release-payouts). */
const RESI_APERTI = ['REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED'];
const RECLAMI_APERTI = ['open', 'under_review'];

/**
 * 5/11/2026 — Perche' questo ordine NON si puo' pagare adesso, o null.
 * Il comando interno chiamava releaseOrderPayout direttamente, e i cancelli
 * stavano solo nella ricerca del giro: un reso aperto, un reclamo aperto, una
 * contestazione in banca o l'ora di attesa non fermavano niente.
 */
async function percheNonSiPaga(orderId: string): Promise<string | null> {
  const admin = getAdminSupabase();
  const [ordine, resi, reclami] = await Promise.all([
    admin.from('orders').select('dispute_status, internal_dispute_status, delivered_at').eq('id', orderId).maybeSingle(),
    admin.from('returns').select('id').eq('order_id', orderId).in('status', RESI_APERTI).limit(1),
    admin.from('disputes').select('id').eq('order_id', orderId).in('status', RECLAMI_APERTI).limit(1),
  ]);
  if (ordine.error || resi.error || reclami.error) return 'Non riesco a controllare resi e reclami dell ordine: riprova fra poco.';
  const o = ordine.data as { dispute_status?: string | null; internal_dispute_status?: string | null; delivered_at?: string | null } | null;
  if (!o) return null; // ci pensa releaseOrderPayout (NOT_FOUND)
  if (o.dispute_status && o.dispute_status !== 'WON') return 'C e una contestazione in banca aperta su questo ordine.';
  if (o.internal_dispute_status && o.internal_dispute_status !== 'RESOLVED') return 'C e un reclamo aperto su questo ordine.';
  if ((reclami.data ?? []).length > 0) return 'C e un reclamo aperto su questo ordine.';
  if ((resi.data ?? []).length > 0) return 'C e un reso aperto su questo ordine.';
  if (o.delivered_at && Date.now() - new Date(o.delivered_at).getTime() < ORE_ATTESA_BONIFICO * 3_600_000) {
    return 'Il bonifico parte dopo l ora di attesa dalla consegna.';
  }
  return null;
}

export const runtime = 'nodejs';

const Body = z.object({
  orderId: z.string().uuid(),
});

/**
 * Rilascia il payout al seller per un ordine DELIVERED.
 *
 * Trigger manuale/admin server-to-server (verifica x-internal-secret). La
 * logica vive in lib/stripe/payout.ts (`releaseOrderPayout`), condivisa col
 * cron automatico app/api/cron/release-payouts, che paga un'ora dopo la
 * consegna (R051 — qui c'era scritto «+3gg», che non e' mai stato vero da
 * quando il giro esiste: il numero vero sta in lib/stripe/tempi-bonifico.ts).
 */
export const POST = withInternalAuth(async (req): Promise<NextResponse> => {
  if (!isStripeConfigured()) return ApiErrors.unavailable('Stripe non configurato');

  let body;
  try {
    body = Body.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch (e) {
    return ApiErrors.invalidRequest('Bad request', e instanceof Error ? e.message : undefined);
  }

  const fermo = await percheNonSiPaga(body.orderId);
  if (fermo) {
    logger.warn('[stripe/payout] bonifico a mano fermato dai cancelli del giro', { orderId: body.orderId, motivo: fermo });
    return ApiErrors.conflict(fermo);
  }

  const result = await releaseOrderPayout(body.orderId);
  if (result.ok) {
    // 046 — Un ordine rimborsato per intero prima del pagamento non ha niente da
    // versare: è un esito buono, non un trasferimento.
    // 22/8/2026 — la risposta di successo non rispettava il contratto che
    // questo stesso file usa per gli errori: `{ ok: true, transferId }` invece
    // di `{ ok: true, data: { … } }`. Due contratti dentro un file solo sono
    // due contratti che qualcuno prima o poi confonde.
    if ('code' in result) {
      return apiSuccess({ transferId: null, nota: result.reason });
    }
    return apiSuccess({ transferId: result.transferId });
  }

  switch (result.code) {
    case 'NOT_FOUND':
      return ApiErrors.notFound(result.reason);
    case 'INVALID_AMOUNT':
      return ApiErrors.invalidRequest(result.reason);
    case 'NOT_DELIVERED':
    case 'BAD_STATE':
    case 'SELLER_NOT_READY':
      return ApiErrors.conflict(result.reason);
    case 'TRANSFER_FAILED':
    default:
      return ApiErrors.internal(result.reason);
  }
});
