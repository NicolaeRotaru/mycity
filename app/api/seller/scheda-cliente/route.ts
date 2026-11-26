import { withSellerAnchePendingRateLimit } from '@/lib/api/middleware';
import { apiSuccess } from '@/lib/api/responses';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { leggiSchedaSalvata } from '@/lib/agenzia/scheda-cliente';
import { leggiSchedaEPagellaAperte, schedaPerIlSito } from '@/lib/agenzia/scheda-dopo-abbonamento';
import { analisiPerLaFascia } from '@/lib/agenzia/rapporto';
import { ABBONAMENTI, type Abbonamento } from '@/lib/agenzia/preventivo';

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
  const [letta, aperta, abbonamenti] = await Promise.all([
    admin.from('schede_clienti').select('scheda').eq('id_attivita', user.id).maybeSingle(),
    leggiSchedaEPagellaAperte(admin, user.id),
    admin.from('abbonamenti_servizi').select('fascia, stato').eq('seller_id', user.id).order('creato_il', { ascending: false }).limit(20),
  ]);
  if (letta.error) logger.warn('[seller-scheda] scheda non letta', { userId: user.id, message: letta.error.message });
  const intera = letta.error ? null : schedaPerIlSito(leggiSchedaSalvata((letta.data as { scheda?: unknown } | null)?.scheda), aperta);
  // 26/11/2026 — Dopo il pagamento, del rapporto dell'imprenditore escono solo le parti dell'abbonamento attivo
  // (lib/agenzia/rapporto.ts). Senza un abbonamento attivo leggibile vale il Base, il più prudente.
  const riga = abbonamenti.error ? null : ((abbonamenti.data as Array<{ fascia?: string; stato?: string }> | null) ?? []).find((r) => r.stato === 'active' || r.stato === 'past_due');
  const fascia = riga && (ABBONAMENTI as readonly string[]).includes(String(riga.fascia)) ? (riga.fascia as Abbonamento) : null;
  const scheda = intera && aperta ? { ...intera, analisi: analisiPerLaFascia(intera.analisi, fascia) } : intera;
  return apiSuccess({ scheda, aperta }, { headers: { 'Cache-Control': 'no-store' } });
});
