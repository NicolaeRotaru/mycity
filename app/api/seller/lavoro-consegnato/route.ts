import { withSellerAnchePendingRateLimit } from '@/lib/api/middleware';
import { apiSuccess } from '@/lib/api/responses';
import { lavoroConsegnatoDi } from '@/lib/agenzia/lavoro-consegnato/registro';

export const runtime = 'nodejs';

/**
 * IL LAVORO PREMIUM GIÀ CONSEGNATO — 27/11/2026.
 * Esiste per i negozi del registro (SDG Agenzia, Premium di se stessa; il Caffè di Piacenza, Business). Un venditore vede solo il SUO:
 * l'id viene dall'accesso, mai dalla richiesta. Per tutti gli altri `null` e la pagina resta il preventivo.
 */
export const GET = withSellerAnchePendingRateLimit({ name: 'seller-lavoro-consegnato', max: 30, windowMs: 60_000 }, async ({ user }) => {
  return apiSuccess({ lavoro: lavoroConsegnatoDi(user.id) }, { headers: { 'Cache-Control': 'no-store' } });
});
