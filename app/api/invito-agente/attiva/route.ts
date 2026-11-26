import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { getClientIp, rateLimitAsync } from '@/lib/rate-limit';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { VERSIONE_TESTI_LEGALI, eLaVersioneInVigore, ultimaVersioneAVerbale } from '@/lib/legal/versione';
import { AgenteSospeso, CODICE_INVITO, agenteDi, faiAgente, improntaCodice, leggiInvito, restituisciInvito, statoInvito, usaInvito } from '@/lib/agenti/inviti';

export const runtime = 'nodejs';

/**
 * SI DIVENTA AGENTE SOLO DA QUI: ACCOUNT MYCITY + LINK D'INVITO + «ATTIVA» — 26/11/2026 (migrazione 865).
 * L'account si crea con la registrazione normale (email confermata, anti-bot, condizioni a verbale); poi la
 * persona riapre il link e preme «Attiva»: il posto nel link si usa e lei diventa agente.
 * Un agente già attivo non consuma un altro link; un agente sospeso resta sospeso (lo riattiva solo Admin).
 * Se nel verbale manca il «sì» alla versione in vigore delle condizioni (es. chi è entrato con Google prima della
 * spunta), si mette a verbale qui, con la spunta della pagina.
 * Il codice arriva nel corpo, mai nell'indirizzo (perché: lib/agenti/codice.ts).
 */
const Richiesta = z.object({
  codice: z.string().regex(CODICE_INVITO, 'Link non valido'),
  accettoCondizioni: z.literal(true, { message: 'Per continuare accetta le condizioni e l’informativa privacy' }),
});
const NON_VALE = 'Questo link non vale più: chiedi a Nicola un link nuovo.';
const SOSPESO = 'Il tuo accesso da agente è sospeso: un link nuovo non lo riapre. Scrivi a Nicola.';

export const POST = withAuthRateLimit({ name: 'invito-agente-attiva', max: 8, windowMs: 10 * 60_000 }, async ({ user, req }) => {
  if (!user.email) return ApiErrors.invalidRequest('Il tuo account non ha un’email: scrivi a Nicola.');
  let corpo: unknown;
  try {
    corpo = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('Richiesta non leggibile');
  }
  const esito = Richiesta.safeParse(corpo);
  if (!esito.success) return ApiErrors.invalidRequest(esito.error.issues[0]?.message ?? 'Link non valido');
  const { codice } = esito.data;
  const perLink = await rateLimitAsync({ key: `invito-agente-link:${improntaCodice(codice).slice(0, 32)}`, max: 10, windowMs: 10 * 60_000 });
  if (!perLink.allowed) return ApiErrors.rateLimited(perLink.retryAfterSec);

  let invitoId: string | null = null;
  try {
    const gia = await agenteDi(user.id);
    if (gia?.attivo) return NextResponse.json({ ok: true, data: { gia: true } }, { status: 200 });
    if (gia) return ApiErrors.conflict(SOSPESO);
    const stato = statoInvito(await leggiInvito(codice));
    if (stato !== 'valido') return ApiErrors.conflict(stato === 'scaduto' ? 'Questo link è scaduto: chiedi a Nicola un link nuovo.' : NON_VALE);
    invitoId = await usaInvito(codice);
    if (!invitoId) return ApiErrors.conflict(NON_VALE);
    await faiAgente({ userId: user.id, email: user.email, invitoId });
    await mettiAVerbale(user.id, req);
    return NextResponse.json({ ok: true, data: { gia: false } }, { status: 200 });
  } catch (errore) {
    // Il posto preso e non usato torna libero, così il link vale ancora per riprovare.
    if (invitoId) await restituisciInvito(invitoId).catch((e) => logger.error('[invito-agente] posto non restituito', { errore: String(e), invito: invitoId }));
    if (errore instanceof AgenteSospeso) return ApiErrors.conflict(SOSPESO);
    logger.error('[invito-agente] attivazione non riuscita', { errore: String(errore) });
    return ApiErrors.unavailable('Non riesco ad attivarti in questo momento. Riprova fra poco.');
  }
});

/** Il «sì» alle condizioni, se nel verbale manca per la versione in vigore. Un guasto qui non toglie l'accesso: si annota. */
async function mettiAVerbale(userId: string, req: Request): Promise<void> {
  try {
    const admin = getAdminSupabase();
    if (eLaVersioneInVigore(await ultimaVersioneAVerbale(admin, userId))) return;
    const { error } = await admin.from('consent_log').insert({
      user_id: userId,
      categoria: 'privacy_terms',
      valore: true,
      versione_testo: VERSIONE_TESTI_LEGALI.slice(0, 60),
      ip: getClientIp(req),
      user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    });
    if (error) throw new Error(error.message);
    const { error: errProfilo } = await admin.from('profiles').update({ tos_accepted_at: new Date().toISOString() }).eq('id', userId);
    if (errProfilo) throw new Error(errProfilo.message);
  } catch (errore) {
    logger.error('[invito-agente] consenso non messo a verbale', { errore: String(errore), utente: userId });
  }
}
