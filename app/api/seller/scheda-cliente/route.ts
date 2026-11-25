import { withSellerAnchePendingRateLimit } from '@/lib/api/middleware';
import { apiSuccess } from '@/lib/api/responses';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { leggiSchedaSalvata } from '@/lib/agenzia/scheda-cliente';
import { leggiSchedaEPagellaAperte, schedaPerIlSito } from '@/lib/agenzia/scheda-dopo-abbonamento';

export const runtime = 'nodejs';

/**
 * LA SCHEDA DEL LOCALE PER LA DASHBOARD DEL NEGOZIO — 25/11/2026.
 *
 * Prima la pagina la leggeva dal browser, direttamente dalla tabella. Da quando la scheda vale solo
 * dopo l'abbonamento (Nicola, 25/11: lib/agenzia/scheda-dopo-abbonamento.ts) passa da qui: il server
 * sa se il negozio è abbonato e, se non lo è, manda solo l'analisi (che vale subito), senza i campi.
 * Senza scheda, o se la lettura non riesce, `scheda: null`: la pagina resta quella generica.
 */
export const GET = withSellerAnchePendingRateLimit({ name: 'seller-scheda-cliente', max: 30, windowMs: 60_000 }, async ({ user }) => {
  const admin = getAdminSupabase();
  const [letta, aperta] = await Promise.all([
    admin.from('schede_clienti').select('scheda').eq('id_attivita', user.id).maybeSingle(),
    leggiSchedaEPagellaAperte(admin, user.id),
  ]);
  if (letta.error) logger.warn('[seller-scheda] scheda non letta', { userId: user.id, message: letta.error.message });
  const scheda = letta.error ? null : schedaPerIlSito(leggiSchedaSalvata((letta.data as { scheda?: unknown } | null)?.scheda), aperta);
  return apiSuccess({ scheda, aperta }, { headers: { 'Cache-Control': 'no-store' } });
});
