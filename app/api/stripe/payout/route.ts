import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isStripeConfigured } from '@/lib/stripe/client';
import { releaseOrderPayout } from '@/lib/stripe/payout';
import { withInternalAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

const Body = z.object({
  orderId: z.string().uuid(),
});

/**
 * Rilascia il payout al seller per un ordine DELIVERED.
 *
 * Trigger manuale/admin server-to-server (verifica x-internal-secret). La
 * logica vive in lib/stripe/payout.ts (`releaseOrderPayout`), condivisa col
 * cron automatico app/api/cron/release-payouts che paga a consegna +3gg.
 */
export const POST = withInternalAuth(async (req): Promise<NextResponse> => {
  if (!isStripeConfigured()) return ApiErrors.unavailable('Stripe non configurato');

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return ApiErrors.invalidRequest('Bad request', e instanceof Error ? e.message : undefined);
  }

  const result = await releaseOrderPayout(body.orderId);
  if (result.ok) {
    return NextResponse.json({ ok: true, transferId: result.transferId }, { status: 200 });
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
