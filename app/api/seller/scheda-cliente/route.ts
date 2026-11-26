import { withSellerAnchePendingRateLimit } from '@/lib/api/middleware';
import { apiSuccess } from '@/lib/api/responses';
import { getAdminSupabase } from '@/lib/supabase/server';
import { schedaPerIlNegozio } from '@/lib/agenzia/scheda-del-negozio';

export const runtime = 'nodejs';

/**
 * LA SCHEDA DEL LOCALE PER LA DASHBOARD DEL NEGOZIO — 25/11/2026.
 *
 * Prima la pagina la leggeva dal browser, direttamente dalla tabella. Da quando la scheda vale solo
 * dopo l'abbonamento (Nicola, 25/11: lib/agenzia/scheda-dopo-abbonamento.ts) passa da qui: il server
 * sa se il negozio è abbonato e, se non lo è, manda solo l'analisi (che vale subito), senza i campi.
 * 26/11/2026 — Dopo il pagamento, del rapporto dell'imprenditore escono solo le parti dell'abbonamento attivo.
 * Le regole stanno in lib/agenzia/scheda-del-negozio.ts, le stesse di «Scarica i miei dati».
 * Senza scheda, o se la lettura non riesce, `scheda: null`: la pagina resta quella generica.
 */
export const GET = withSellerAnchePendingRateLimit({ name: 'seller-scheda-cliente', max: 30, windowMs: 60_000 }, async ({ user }) => {
  const { scheda, aperta } = await schedaPerIlNegozio(getAdminSupabase(), user.id);
  return apiSuccess({ scheda, aperta }, { headers: { 'Cache-Control': 'no-store' } });
});
