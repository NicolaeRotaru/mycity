import { withSellerAnchePendingRateLimit } from '@/lib/api/middleware';
import { apiSuccess } from '@/lib/api/responses';
import { lavoroConsegnatoDi } from '@/lib/agenzia/lavoro-consegnato/registro';
import { lavoroDallOrdine } from '@/lib/agenzia/lavoro-dell-ordine';

export const runtime = 'nodejs';

/**
 * IL LAVORO PREMIUM GIÀ CONSEGNATO — 27/11/2026.
 * Esiste per i negozi del registro (SDG Agenzia, Premium di se stessa; il Caffè di Piacenza, Business). Un venditore vede solo il SUO:
 * l'id viene dall'accesso, mai dalla richiesta. Per tutti gli altri `null` e la pagina resta il preventivo.
 *
 * 28/11/2026 — Chi non è nel registro ma ha accettato il preventivo ha l'ordine di SDG (999c, 999h): `ordine` porta
 * la bozza del sito, il piano e l'analisi nati all'accettazione (lib/agenzia/lavoro-dell-ordine.ts), sempre e solo
 * del negozio entrato. Manca, e la risposta resta com'era, se il negozio non ha un ordine o la lettura non riesce.
 */
export const GET = withSellerAnchePendingRateLimit({ name: 'seller-lavoro-consegnato', max: 30, windowMs: 60_000 }, async ({ user }) => {
  const lavoro = lavoroConsegnatoDi(user.id);
  // I due clienti scritti a mano restano come sono: per loro l'ordine non si legge nemmeno.
  const ordine = lavoro ? null : await lavoroDallOrdine(user.id);
  return apiSuccess({ lavoro, ...(ordine ? { ordine } : {}) }, { headers: { 'Cache-Control': 'no-store' } });
});
