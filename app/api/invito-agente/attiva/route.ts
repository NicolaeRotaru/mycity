import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { rateLimitAsync } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { AgenteSospeso, CODICE_INVITO, agenteDi, faiAgente, improntaCodice, leggiInvito, restituisciInvito, statoInvito, usaInvito } from '@/lib/agenti/inviti';

export const runtime = 'nodejs';

/**
 * CHI HA GIÀ UN ACCOUNT MYCITY SI ATTIVA COME AGENTE DAL LINK — 26/11/2026 (migrazione 865).
 * Entrato col suo account, riapre il link e preme «Attiva»: il posto nel link si usa e lui diventa agente.
 * Un agente già attivo non consuma un altro link; un agente sospeso resta sospeso (lo riattiva solo Admin).
 * Il codice arriva nel corpo, mai nell'indirizzo (perché: lib/agenti/codice.ts).
 */
const Richiesta = z.object({ codice: z.string().regex(CODICE_INVITO, 'Link non valido') });
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
  if (!esito.success) return ApiErrors.notFound('Link non valido');
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
    return NextResponse.json({ ok: true, data: { gia: false } }, { status: 200 });
  } catch (errore) {
    // Il posto preso e non usato torna libero, così il link vale ancora per riprovare.
    if (invitoId) await restituisciInvito(invitoId).catch((e) => logger.error('[invito-agente] posto non restituito', { errore: String(e), invito: invitoId }));
    if (errore instanceof AgenteSospeso) return ApiErrors.conflict(SOSPESO);
    logger.error('[invito-agente] attivazione non riuscita', { errore: String(errore) });
    return ApiErrors.unavailable('Non riesco ad attivarti in questo momento. Riprova fra poco.');
  }
});
