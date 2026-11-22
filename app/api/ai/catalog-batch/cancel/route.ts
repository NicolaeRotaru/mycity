import { NextResponse } from 'next/server';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { rateLimitAsync } from '@/lib/rate-limit';
import { getAdminSupabase } from '@/lib/supabase/server';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { INVIO_SENZA_RISPOSTA } from '@/lib/ai/batch';
import { logger } from '@/lib/logger';

/**
 * 12/11/2026 (R04-025, revisione) — SCARTARE UN LAVORO PRONTO.
 *
 * Con un lavoro aperto la rotta di avvio rifiuta un secondo lavoro e dice
 * «applicalo o scartalo»: ma scartarlo non si poteva, e un lavoro pronto che
 * non si voleva costringeva ad applicarlo. Qui si scarta: solo un lavoro
 * PRONTO (i risultati ci sono, niente gira presso il fornitore) e solo del
 * venditore che lo chiede. Non si applica niente e non si spende niente.
 */
export const runtime = 'nodejs';

/**
 * 21/11/2026 (R02-002 · R02-003) — UN LAVORO «FORSE PARTITO» SI SCARTA.
 *
 * Dopo un invio rimasto senza risposta (timeout, connessione caduta, un
 * 500/502/504 del fornitore) la riga resta «in invio», senza lotto, col motivo
 * INVIO_SENZA_RISPOSTA: l'avvio risponde 409 e lo stato la tiene aperta fino a
 * 24 ore. Qui si scartava solo un lavoro pronto, e il negozio restava fermo.
 * Adesso si scarta anche quella riga, con tre cautele:
 *  - solo dopo INVIO_INCERTO_SCARTABILE_DOPO_MS dalla nascita. La rotta di avvio
 *    vive al massimo 120 secondi (vercel.json, rotte di app/api/ai): passati i 3
 *    minuti non puo' piu' agganciare un lotto, e lo scarto non la incrocia a meta';
 *  - solo se la riga e' ANCORA «in invio», senza lotto e con quel motivo, nello
 *    stesso passaggio che la chiude: un lotto agganciato nel frattempo, o un
 *    «partito ma non agganciato» col suo id (che lo stato aggancia), non si scarta;
 *  - la riga non si cancella: resta «annullato» con la sua data e un motivo che
 *    dice che il lotto potrebbe essere partito ed essere stato pagato (la stima
 *    e' gia' contata nel tetto di spesa alla partenza). Annullarlo presso il
 *    fornitore non si puo': il suo id non e' mai arrivato. Se il fornitore l'ha
 *    preso senza dirlo, si ritrova con l'assistenza da qui.
 */
const INVIO_INCERTO_SCARTABILE_DOPO_MS = 3 * 60_000;
const SCARTATO_FORSE_PARTITO =
  'scartato dal negozio dopo un invio senza risposta: il lotto potrebbe essere partito ed essere stato pagato; se serve, i risultati si recuperano con l\'assistenza';

export const POST = withSellerAuth(async ({ user, req }): Promise<NextResponse> => {
  const rl = await rateLimitAsync({ key: `ai-catalog-batch-cancel:${user.id}`, max: 30, windowMs: 60 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);

  let body: { jobId?: unknown };
  try {
    body = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('JSON non valido');
  }
  const jobId = typeof body.jobId === 'string' ? body.jobId : '';
  if (!jobId) return ApiErrors.invalidRequest('Job mancante.');

  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from('catalog_ai_jobs')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('seller_id', user.id)
    .eq('status', 'ready')
    .select('id');
  if (error) return ApiErrors.badGateway('Non sono riuscito a scartare il lavoro. Riprova.');
  if (data && data.length > 0) return NextResponse.json({ jobId, status: 'canceled' });

  // Non era pronto: forse e' un invio rimasto senza risposta (vedi sopra).
  // Si rilegge la riga solo se e' ancora incerta, riscrivendo lo stesso motivo
  // (nessun dato cambia), per sapere quando e' nata. La data di nascita non la
  // cambia nessuno, e chi aggancia un lotto cambia insieme stato e motivo
  // (start/route.ts «aggancia», status/route.ts): «in invio» col motivo
  // «invio senza risposta» vuol dire anche «senza lotto».
  const { data: incerte, error: errIncerte } = await admin
    .from('catalog_ai_jobs')
    .update({ error: INVIO_SENZA_RISPOSTA })
    .eq('id', jobId)
    .eq('seller_id', user.id)
    .eq('status', 'submitting')
    .eq('error', INVIO_SENZA_RISPOSTA)
    .select('id, batch_id, created_at');
  if (errIncerte) return ApiErrors.badGateway('Non sono riuscito a scartare il lavoro. Riprova.');
  const incerta = (incerte ?? [])[0] as { batch_id?: string | null; created_at?: string | null } | undefined;
  const nata = incerta?.created_at ? Date.parse(incerta.created_at) : NaN;
  const scartabile = !!incerta && !incerta.batch_id && Number.isFinite(nata) && Date.now() - nata > INVIO_INCERTO_SCARTABILE_DOPO_MS;
  const NON_SCARTABILE = 'Si può scartare solo un tuo lavoro pronto da rivedere, o un invio rimasto senza risposta da qualche minuto.';
  if (!scartabile) return ApiErrors.conflict(NON_SCARTABILE);

  // Lo scarto vale solo se la riga e' ANCORA in invio col motivo incerto: se nel
  // frattempo un lotto e' stato agganciato, o l'invio e' stato chiuso, non tocca niente.
  const { data: scartati, error: errScarto } = await admin
    .from('catalog_ai_jobs')
    .update({ status: 'canceled', error: SCARTATO_FORSE_PARTITO, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('seller_id', user.id)
    .eq('status', 'submitting')
    .eq('error', INVIO_SENZA_RISPOSTA)
    .select('id');
  if (errScarto) return ApiErrors.badGateway('Non sono riuscito a scartare il lavoro. Riprova.');
  if (!scartati || scartati.length === 0) return ApiErrors.conflict(NON_SCARTABILE);
  logger.warn('catalog-batch cancel: scartato un lavoro forse partito, da riconciliare col fornitore', { jobId, sellerId: user.id });
  return NextResponse.json({ jobId, status: 'canceled' });
});
