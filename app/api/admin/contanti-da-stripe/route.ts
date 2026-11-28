import { withAdminAuth } from '@/lib/api/middleware';
import { apiSuccess } from '@/lib/api/responses';
import { inizioContantiDaStripe } from '@/lib/stripe/payout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Quello che risponde: l'istante (millisecondi) da cui i contanti li paga Stripe, o `null`. */
export type ContantiDaStripe = { dal: number | null };

/**
 * GET /api/admin/contanti-da-stripe — da quando i bonifici dei contanti li fa Stripe?
 *
 * R05-002 — PAGAMENTI_CONTANTI_DA_STRIPE_DAL vive sul server e il pannello dei bonifici non la vede:
 * con la variabile accesa i contanti consegnati da quel giorno restavano «Da versare» il lunedì, e
 * il giro li pagava anche con Stripe. Qui si dice solo l'istante letto da `inizioContantiDaStripe()`
 * (`null` = vuota o storta: i contanti li versa Nicola). Solo admin (withAdminAuth).
 */
export const GET = withAdminAuth(async () => {
  const corpo: ContantiDaStripe = { dal: inizioContantiDaStripe() };
  return apiSuccess(corpo, { headers: { 'Cache-Control': 'no-store' } });
});
