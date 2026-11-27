import { withSellerAnchePendingRateLimit } from '@/lib/api/middleware';
import { apiSuccess } from '@/lib/api/responses';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * IL GIORNO IN CUI SDG PASSA, LETTO DAL NEGOZIO — 27/11/2026.
 *
 * Nicola, 27/11 verso le 17:40: il titolare sceglie nel link giorno e ora in cui il team creativo di SDG passa
 * da lui, e deve capire bene cosa succede dopo. Entrato nella sua pagina dell'abbonamento, la prima cosa che
 * legge è quel giorno (components/seller/VisitaSdg.tsx). Qui il server legge la visita del SUO preventivo
 * (preventivi_con_codice.visita_il, migrazione 999b): solo la sua, per id dell'utente. Senza la 999b, o
 * senza visita, risponde `visita: null` e la pagina non mostra niente.
 */
export const GET = withSellerAnchePendingRateLimit(
  { name: 'seller-visita-sdg', max: 30, windowMs: 60_000 },
  async ({ user }) => {
    let visita: string | null = null;
    try {
      const { data, error } = await getAdminSupabase()
        .from('preventivi_con_codice')
        .select('visita_il')
        .eq('seller_id', user.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const letta = (data as { visita_il?: string | null } | null)?.visita_il ?? null;
      // Una visita già passata non si annuncia più.
      visita = letta && new Date(letta).getTime() > Date.now() ? letta : null;
    } catch (errore) {
      logger.warn('[visita-sdg] non letta: la pagina non la mostra', { userId: user.id, errore: String(errore) });
    }
    return apiSuccess({ visita }, { headers: { 'Cache-Control': 'no-store' } });
  },
);
