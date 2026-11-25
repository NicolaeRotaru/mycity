import { withSellerAnchePendingRateLimit } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { indirizzoWebPubblico } from '@/lib/indirizzi-pubblici';
import { analizzaSitoConGoogle } from '@/lib/agenzia/sito-pagespeed';

export const runtime = 'nodejs';
// Google PageSpeed impiega anche 30–40 secondi a leggere un sito lento.
export const maxDuration = 60;

/**
 * L'ANALISI DEL SITO — 24/11/2026. Il titolare preme «Analizza il mio sito» nella pagina dell'analisi.
 *
 * Nicola: fonti «solo gratuite». Google PageSpeed Insights è gratuito: il nostro server gli chiede di
 * leggere il sito del negozio (quello scritto in «I tuoi canali», solo https e solo un indirizzo
 * pubblico) e tiene da parte il risultato in `analisi_negozi.sito` (migrazione 711), in parole
 * semplici: velocità, farsi trovare su Google, facile da usare per tutti.
 *
 * Tetto: un tentativo al giorno per negozio (giorno di Piacenza), riuscito o no. Prima si risponde col
 * risultato già tenuto da parte, senza richiamare Google. La chiave di Google è facoltativa
 * (`PAGESPEED_API_KEY`, anch'essa gratuita): senza, Google concede meno richieste al giorno.
 */

export const POST = withSellerAnchePendingRateLimit({ name: 'seller-analisi-sito', max: 3, windowMs: 60_000 }, async ({ user }) => {
  const admin = getAdminSupabase();
  const profilo = await admin.from('profiles').select('role, store_customization').eq('id', user.id).maybeSingle();
  if (profilo.error) {
    logger.error('[analisi-sito] lettura non riuscita', { userId: user.id, message: profilo.error.message });
    return ApiErrors.unavailable('Non sono riuscito a preparare l’analisi. Riprova fra poco.');
  }
  const p = profilo.data as { role: string | null; store_customization: { socials?: { website?: unknown } } | null } | null;
  if (!p || p.role !== 'seller') return ApiErrors.forbidden('Solo un negozio ha un sito da analizzare.');
  const scritto = typeof p.store_customization?.socials?.website === 'string' ? p.store_customization.socials.website : '';
  const sito = indirizzoWebPubblico(scritto);
  if (!sito) return ApiErrors.invalidRequest('Scrivi prima l’indirizzo pubblico del tuo sito in «I tuoi canali» (solo https).');

  // 25/11/2026 — La chiamata a Google, il tetto di un tentativo al giorno e il salvataggio stanno in
  // lib/agenzia/sito-pagespeed.ts: li usano anche le porte di n8n, appena conoscono il sito del cliente.
  const esito = await analizzaSitoConGoogle(admin, user.id, sito);
  if (esito.ok) return apiSuccess({ sito: esito.sito, giaFattaOggi: esito.giaFattaOggi }, { headers: { 'Cache-Control': 'no-store' } });
  switch (esito.motivo) {
    case 'gia-tentato-oggi':
      return ApiErrors.rateLimited(3600, 'Il sito si può analizzare una volta al giorno: riprova domani.');
    case 'google-male':
      return ApiErrors.badGateway('Google non è riuscito a leggere il tuo sito. Controlla che si apra, e riprova fra poco.');
    case 'google-lento':
      return ApiErrors.badGateway('Google ci sta mettendo troppo a leggere il tuo sito. Riprova fra qualche minuto.');
    case 'nessun-risultato':
      return ApiErrors.badGateway('Google non ha dato un risultato per il tuo sito. Riprova fra poco.');
    default:
      return ApiErrors.unavailable('Non sono riuscito a preparare l’analisi. Riprova fra poco.');
  }
});
