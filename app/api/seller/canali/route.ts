import { withSellerAnchePendingRateLimit } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta } from '@/lib/api/corpo';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { canaliCambiati, canaliDaiSocial, controllaCanali, haCanali } from '@/lib/agenzia/canali';

export const runtime = 'nodejs';

/**
 * «I TUOI CANALI» — 24/11/2026. GET li legge, POST li salva.
 *
 * Nicola: «ci deve essere un luogo dove l'imprenditore deve inserire l'id dei social e google e
 * quello che serve per analizzare anche il sito». Il modulo sta nella pagina dell'analisi e nel
 * Profilo; tutti e due passano da qui. Si salvano in `store_customization.socials` (dove la vetrina
 * li teneva già), toccando solo i cinque canali: WhatsApp, colori, motto e il resto restano come sono.
 *
 * Quando i canali cambiano, si chiede a n8n un'analisi nuova: `analisi_negozi.canali_richiesti_il`
 * (migrazione 711), che n8n legge da GET /api/agenzia/analisi-canali. Se la tabella non c'è ancora,
 * i canali si salvano lo stesso e la richiesta si rifà al prossimo salvataggio.
 */

const TETTO = 8 * 1024;

type Personalizzazione = { socials?: Record<string, unknown> } & Record<string, unknown>;

async function leggiPersonalizzazione(id: string) {
  const admin = getAdminSupabase();
  const r = await admin.from('profiles').select('role, store_customization').eq('id', id).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  return r.data as { role: string | null; store_customization: Personalizzazione | null } | null;
}

export const GET = withSellerAnchePendingRateLimit({ name: 'seller-canali-leggi', max: 60, windowMs: 60_000 }, async ({ user }) => {
  try {
    const p = await leggiPersonalizzazione(user.id);
    return apiSuccess({ canali: canaliDaiSocial(p?.store_customization?.socials as never) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (errore) {
    logger.error('[canali] non letti', { userId: user.id, errore: String(errore) });
    return ApiErrors.unavailable('Non sono riuscito a leggere i tuoi canali. Riprova fra poco.');
  }
});

export const POST = withSellerAnchePendingRateLimit({ name: 'seller-canali-salva', max: 10, windowMs: 60_000 }, async ({ user, req }) => {
  let corpo: unknown;
  try {
    corpo = await jsonRichiesta(req, TETTO);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('Richiesta non leggibile');
  }
  const esito = controllaCanali(corpo);
  if (!esito.ok) return ApiErrors.invalidRequest('Controlla i canali segnati', { errori: esito.errori });

  let p: Awaited<ReturnType<typeof leggiPersonalizzazione>>;
  try {
    p = await leggiPersonalizzazione(user.id);
  } catch (errore) {
    logger.error('[canali] profilo non letto', { userId: user.id, errore: String(errore) });
    return ApiErrors.unavailable('Non sono riuscito a salvare. Riprova fra poco.');
  }
  if (!p || p.role !== 'seller') return ApiErrors.forbidden('Solo un negozio ha i canali da analizzare.');

  const prima = canaliDaiSocial(p.store_customization?.socials as never);
  const personalizzazione: Personalizzazione = { ...(p.store_customization ?? {}) };
  personalizzazione.socials = { ...(personalizzazione.socials ?? {}), ...esito.canali };

  const admin = getAdminSupabase();
  const { error } = await admin.from('profiles').update({ store_customization: personalizzazione }).eq('id', user.id);
  if (error) {
    logger.error('[canali] non salvati', { userId: user.id, message: error.message });
    return ApiErrors.unavailable('Non sono riuscito a salvare. Riprova fra poco.');
  }

  let analisiChiesta = false;
  if (haCanali(esito.canali) && canaliCambiati(prima, esito.canali)) {
    const adesso = new Date().toISOString();
    const r = await admin.from('analisi_negozi').upsert({ id_attivita: user.id, canali_richiesti_il: adesso, aggiornata_il: adesso }, { onConflict: 'id_attivita' });
    if (r.error) logger.warn('[canali] richiesta di analisi non scritta', { userId: user.id, message: r.error.message });
    else analisiChiesta = true;
  }
  return apiSuccess({ canali: esito.canali, analisiChiesta }, { headers: { 'Cache-Control': 'no-store' } });
});
