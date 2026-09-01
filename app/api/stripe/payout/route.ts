import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isStripeConfigured } from '@/lib/stripe/client';
import { releaseOrderPayout } from '@/lib/stripe/payout';
import { withInternalAuth } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';

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
